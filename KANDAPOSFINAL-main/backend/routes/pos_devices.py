"""Unlocked POS tills ("devices").

A till has to be unlocked once by one of the restaurant's dashboard users
(owner / area manager / manager, email + password) before staff PINs work on
it. Unlocking returns a long-lived random device token that the till keeps
in localStorage and sends as `X-Device-Token`; only its SHA-256 is stored
here. Staff PIN sign-in (/auth/login) and the time clock (/timeclock/punch)
call `require_pos_device` and refuse a request with no live token for that
restaurant. The token stays valid until a manager removes the till from the
dashboard (Devices page). The public demo tenant is exempt so /demo/login
keeps working for anyone.
"""
import hashlib
import os
import secrets
import uuid
from datetime import timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from db import get_db
from auth import require_role
from tenants import resolve_tenant_from_request, DEFAULT_TENANT_SLUG
from ratelimit import peek as rate_limit_peek, hit as rate_limit_hit, client_ip
from cache import cache_get, cache_set, cache_delete
from routes.dash_auth import _verify_pw
from tz import now_ist

router = APIRouter()

DEVICE_HEADER = "X-Device-Token"
UNLOCK_MAX_FAILURES = 6
# Per-account cap on top of the per-source one: the source IP comes from the
# caller-controlled first X-Forwarded-For value, so it alone can't stop
# password guessing against one dashboard account.
UNLOCK_MAX_FAILURES_PER_ACCOUNT = 10
UNLOCK_WINDOW_SECONDS = 15 * 60
LAST_SEEN_RESOLUTION = timedelta(minutes=5)
DEVICE_CACHE_TTL = 60


def _lock_enforced() -> bool:
    """Kill switch for rollout: POS_DEVICE_LOCK=off lets staff PINs work on
    tills that aren't unlocked (e.g. while installed Windows/Android apps
    that predate the unlock screen are being updated). Default: enforced."""
    return os.environ.get("POS_DEVICE_LOCK", "on").strip().lower() not in ("off", "0", "false")


class DeviceRegisterRequest(BaseModel):
    email: str
    password: str
    name: Optional[str] = None


class PosDevice(BaseModel):
    id: str
    name: str
    created_at: str
    created_by: str
    last_seen_at: Optional[str] = None


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _public(d: dict) -> dict:
    return {k: d.get(k) for k in ("id", "name", "created_at", "created_by", "last_seen_at")}


def _device_cache_key(device_id: str) -> str:
    return f"posdev:{device_id}"


async def require_pos_device(request: Request, tenant: dict, db) -> Optional[str]:
    """Return the id of the unlocked till this request comes from, or raise
    403 {code: device_not_registered}. 403 rather than 401 on purpose: the
    POS client treats 401 as "staff session expired" and signs the till out.
    Returns None for the demo tenant and when the lock is switched off."""
    if tenant.get("slug") == DEFAULT_TENANT_SLUG:
        return None
    token = (request.headers.get(DEVICE_HEADER) or "").strip()
    if token:
        dev = await db.pos_devices.find_one(
            {"tenant_id": tenant["id"], "token_hash": _hash(token), "revoked_at": None},
            {"_id": 0, "id": 1, "last_seen_at": 1},
        )
        if dev:
            now = now_ist()
            last = dev.get("last_seen_at")
            if not last or last < (now - LAST_SEEN_RESOLUTION).isoformat():
                await db.pos_devices.update_one({"id": dev["id"]}, {"$set": {"last_seen_at": now.isoformat()}})
            return dev["id"]
    if not _lock_enforced():
        return None
    raise HTTPException(
        status_code=403,
        detail={"code": "device_not_registered",
                "message": "This till isn't unlocked. A manager needs to sign in on it once."},
    )


async def check_bound_device(device_id: str, device_token: str, db) -> None:
    """For staff JWTs minted on an unlocked till (the `dev` claim): the till
    must still be unlocked, and the request must carry that till's own device
    token. Removing a till therefore ends sessions already open on it (within
    DEVICE_CACHE_TTL at worst, immediately with the cache cleared), and a
    leaked staff JWT on its own (e.g. in a log line) is useless. It
    does not stop someone who can read the till's whole browser storage —
    the device token lives there too."""
    key = _device_cache_key(device_id)
    dev = await cache_get(key)
    if dev is None:
        dev = await db.pos_devices.find_one({"id": device_id}, {"_id": 0, "token_hash": 1, "revoked_at": 1}) or {}
        await cache_set(key, dev, ttl=DEVICE_CACHE_TTL)
    token = (device_token or "").strip()
    if not dev or dev.get("revoked_at") or not token or _hash(token) != dev.get("token_hash"):
        raise HTTPException(status_code=401, detail="This till was removed or isn't unlocked")


def _can_unlock(u: dict, tenant: dict) -> bool:
    if u.get("tenant_id") == tenant["id"]:
        return True
    # A brand owner can unlock a till at any store under their brand — the
    # same rule the dashboard's store switcher uses.
    return bool(u.get("dash_role") == "owner" and u.get("brand_id")
                and u.get("brand_id") == tenant.get("brand_id"))


@router.post("/pos-devices/register")
async def register_pos_device(payload: DeviceRegisterRequest, request: Request):
    db = get_db()
    tenant = await resolve_tenant_from_request(request, db)
    email = (payload.email or "").strip().lower()
    rl_key = f"devunlockrl:{tenant['id']}:{client_ip(request)}"
    acct_key = f"devunlockrl:acct:{email}"
    if (await rate_limit_peek(rl_key) >= UNLOCK_MAX_FAILURES
            or await rate_limit_peek(acct_key) >= UNLOCK_MAX_FAILURES_PER_ACCOUNT):
        raise HTTPException(status_code=429, detail="Too many failed attempts. Please wait a few minutes and try again.")

    u = await db.dashboard_users.find_one({"email": email}, {"_id": 0}) if email else None
    if not u or not payload.password or not _verify_pw(payload.password, u.get("password_hash", "")):
        await rate_limit_hit(rl_key, UNLOCK_WINDOW_SECONDS)
        if email:
            await rate_limit_hit(acct_key, UNLOCK_WINDOW_SECONDS)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if u.get("active") is False:
        raise HTTPException(status_code=403, detail="Account is disabled")
    if u.get("must_change_password"):
        # Auto-provisioned temporary passwords must be changed in the
        # dashboard before they can unlock anything long-lived.
        raise HTTPException(status_code=403, detail="Sign in to the dashboard and change your temporary password first")
    if not _can_unlock(u, tenant):
        raise HTTPException(status_code=403, detail="That account can't unlock tills for this restaurant")

    token = f"posdev_{secrets.token_urlsafe(32)}"
    doc = {
        "id": f"dev_{uuid.uuid4().hex[:10]}",
        "tenant_id": tenant["id"],
        "name": (payload.name or "").strip()[:60] or "POS till",
        "token_hash": _hash(token),
        "created_at": now_ist().isoformat(),
        "created_by": u.get("name") or email,
        "created_by_id": u["id"],
        "last_seen_at": None,
        "revoked_at": None,
    }
    await db.pos_devices.insert_one(doc)
    return {"device_token": token, "device": _public(doc)}


@router.get("/pos-devices", response_model=List[PosDevice])
async def list_pos_devices(user: dict = Depends(require_role("Manager"))):
    db = get_db()
    rows = await db.pos_devices.find(
        {"tenant_id": user["tenant_id"], "revoked_at": None}, {"_id": 0, "token_hash": 0},
    ).sort("created_at", -1).to_list(1000)
    return [_public(r) for r in rows]


@router.delete("/pos-devices/{device_id}")
async def remove_pos_device(device_id: str, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    res = await db.pos_devices.update_one(
        {"id": device_id, "tenant_id": user["tenant_id"], "revoked_at": None},
        {"$set": {"revoked_at": now_ist().isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Till not found")
    await cache_delete(_device_cache_key(device_id))
    return {"ok": True}
