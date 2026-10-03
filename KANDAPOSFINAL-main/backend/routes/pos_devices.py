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
import secrets
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from db import get_db
from auth import require_role
from tenants import resolve_tenant_from_request, DEFAULT_TENANT_SLUG
from ratelimit import peek as rate_limit_peek, hit as rate_limit_hit
from routes.dash_auth import _verify_pw
from tz import now_ist

router = APIRouter()

DEVICE_HEADER = "X-Device-Token"
UNLOCK_MAX_FAILURES = 6
UNLOCK_WINDOW_SECONDS = 15 * 60


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


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _public(d: dict) -> dict:
    return {k: d.get(k) for k in ("id", "name", "created_at", "created_by", "last_seen_at")}


async def require_pos_device(request: Request, tenant: dict, db) -> None:
    """Raise 403 {code: device_not_registered} unless the request carries a
    live device token for `tenant`. 403 rather than 401 on purpose: the POS
    client treats 401 as "staff session expired" and signs the till out."""
    if tenant.get("slug") == DEFAULT_TENANT_SLUG:
        return
    token = (request.headers.get(DEVICE_HEADER) or "").strip()
    if token:
        dev = await db.pos_devices.find_one(
            {"tenant_id": tenant["id"], "token_hash": _hash(token), "revoked_at": None},
            {"_id": 0, "id": 1},
        )
        if dev:
            await db.pos_devices.update_one({"id": dev["id"]}, {"$set": {"last_seen_at": now_ist().isoformat()}})
            return
    raise HTTPException(
        status_code=403,
        detail={"code": "device_not_registered",
                "message": "This till isn't unlocked. A manager needs to sign in on it once."},
    )


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
    rl_key = f"devunlockrl:{tenant['id']}:{_client_ip(request)}"
    if await rate_limit_peek(rl_key) >= UNLOCK_MAX_FAILURES:
        raise HTTPException(status_code=429, detail="Too many failed attempts. Please wait a few minutes and try again.")

    email = (payload.email or "").strip().lower()
    u = await db.dashboard_users.find_one({"email": email}, {"_id": 0}) if email else None
    if not u or not payload.password or not _verify_pw(payload.password, u.get("password_hash", "")):
        await rate_limit_hit(rl_key, UNLOCK_WINDOW_SECONDS)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if u.get("active") is False:
        raise HTTPException(status_code=403, detail="Account is disabled")
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
    ).sort("created_at", -1).to_list(200)
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
    return {"ok": True}
