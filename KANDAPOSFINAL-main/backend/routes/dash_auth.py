"""Restaurant Dashboard auth — email + password login for Owner / Manager / Area Manager.

Three roles share the same `/dashboard/login` page; the JWT carries `dash_role` so the
frontend can render the right scope of nav, and `location_ids` to scope what
data they can see. The JWT also still carries `role: "Manager"` so the existing
POS endpoints (which all gate on `require_role("Manager")`) accept dashboard
tokens transparently — no widespread route changes needed.
"""
import os
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from tz import now_ist
from typing import Dict, List, Literal, Optional

import bcrypt
import jwt
from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel, ConfigDict

from models import BrandInvite
from routes._shared import clean
from dash_access import (
    OWNER, AREA_MANAGER, MANAGER, PERMISSIONS,
    accessible_store_ids, assert_store_access, assigned_store_ids,
    clean_permissions, effective_permissions, owner_store_ids,
)

from db import get_db

DASH_TOKEN_HOURS = 12
JWT_ALG = "HS256"

DashRole = Literal["owner", "manager", "area_manager"]

router = APIRouter()


# ---------- Models ----------
class DashLoginRequest(BaseModel):
    email: str
    password: str
    tenant_slug: Optional[str] = None  # optional explicit tenant; otherwise resolved from email


class DashLoginResponse(BaseModel):
    token: str
    must_change_password: bool
    user: "DashUserPublic"


class DashUserPublic(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    email: str
    name: str
    dash_role: DashRole
    tenant_id: str
    tenant_slug: Optional[str] = None
    location_ids: List[str] = []  # empty list = all locations (owner)
    brand_id: Optional[str] = None  # set only for owners who manage multiple stores under one brand
    must_change_password: bool = False
    store_ids: List[str] = []  # stores (tenants) this person can switch between
    permissions: Dict[str, bool] = {}  # dashboard sections they can use — see dash_access.PERMISSIONS


class DashChangePassword(BaseModel):
    current_password: Optional[str] = None
    new_password: str


# ---------- Helpers ----------
def _secret() -> str:
    return os.environ["JWT_SECRET"]


def _hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_pw(pw: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), h.encode("utf-8"))
    except Exception:
        return False


def _create_dash_token(u: dict, tenant_id: Optional[str] = None) -> str:
    """`tenant_id` overrides the dashboard user's home tenant — used by the
    brand store switcher so a multi-store owner can act on a different store
    under their brand without a separate login per store. `get_current_user`
    (auth.py) already anchors tenant scoping to this JWT claim rather than
    the DB row, so every existing tenant-scoped endpoint picks this up for
    free with no further changes."""
    payload = {
        "sub": u["id"],
        "tenant_id": tenant_id or u["tenant_id"],
        # Stamp `role: Manager` so existing POS endpoints accept this token.
        "role": "Manager",
        "dash": True,
        "dash_role": u["dash_role"],
        "location_ids": u.get("location_ids") or [],
        "exp": now_ist() + timedelta(hours=DASH_TOKEN_HOURS),
        "type": "access",
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALG)


def _to_public(u: dict, tenant: Optional[dict] = None) -> dict:
    return {
        "id": u["id"],
        "email": u["email"],
        "name": u.get("name") or u["email"].split("@")[0],
        "dash_role": u["dash_role"],
        "tenant_id": u["tenant_id"],
        "tenant_slug": (tenant or {}).get("slug"),
        "location_ids": u.get("location_ids") or [],
        "must_change_password": bool(u.get("must_change_password")),
        "brand_id": u.get("brand_id"),
        "store_ids": assigned_store_ids(u) if u.get("dash_role") != OWNER else [],
        "permissions": effective_permissions(u),
    }


async def get_dash_user(request: Request) -> dict:
    """FastAPI dependency that resolves the dashboard user from the JWT.
    Use on /api/dash/* routes that need explicit dash context."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(auth_header[7:], _secret(), algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if not payload.get("dash"):
        raise HTTPException(status_code=403, detail="Dashboard auth required")
    db = get_db()
    u = await db.dashboard_users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not u or u.get("active") is False:
        raise HTTPException(status_code=401, detail="User not found")
    await assert_store_access(db, u, payload.get("tenant_id"))
    # Anchor tenant_id from the JWT, not the DB row — mirrors get_current_user
    # in auth.py. This is what makes the store switcher work: after switching,
    # the token's tenant_id claim (not the user's home-store row) decides
    # which tenant every dash-prefixed endpoint sees too.
    u["tenant_id"] = payload.get("tenant_id") or u["tenant_id"]
    return u


# ---------- Endpoints ----------
@router.post("/dash/auth/login", response_model=DashLoginResponse)
async def dash_login(payload: DashLoginRequest):
    email = (payload.email or "").strip().lower()
    if not email or not payload.password:
        raise HTTPException(status_code=400, detail="Email and password are required")
    db = get_db()
    u = await db.dashboard_users.find_one({"email": email}, {"_id": 0})
    if not u or not _verify_pw(payload.password, u.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if u.get("active") is False:
        raise HTTPException(status_code=403, detail="Account is disabled")
    tenant = await db.tenants.find_one({"id": u["tenant_id"]}, {"_id": 0, "slug": 1})
    token = _create_dash_token(u)
    return {
        "token": token,
        "must_change_password": bool(u.get("must_change_password")),
        "user": _to_public(u, tenant),
    }


@router.get("/dash/auth/me", response_model=DashUserPublic)
async def dash_me(u: dict = Depends(get_dash_user)):
    db = get_db()
    tenant = await db.tenants.find_one({"id": u["tenant_id"]}, {"_id": 0, "slug": 1})
    # `u["tenant_id"]` is the active store; _to_public's store_ids needs the
    # home store, so re-read it from the row.
    home = await db.dashboard_users.find_one({"id": u["id"]}, {"_id": 0, "tenant_id": 1})
    return _to_public({**u, "tenant_id": home["tenant_id"]}, tenant) | {"tenant_id": u["tenant_id"]}


@router.get("/dash/stores")
async def my_stores(u: dict = Depends(get_dash_user)):
    """Stores the caller can switch between: every store in the brand for an
    owner, only the assigned ones for a manager / area manager."""
    db = get_db()
    home = await db.dashboard_users.find_one({"id": u["id"]}, {"_id": 0, "password_hash": 0})
    ids = await accessible_store_ids(db, home)
    docs = await db.tenants.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1, "slug": 1}).to_list(500)
    by_id = {d["id"]: d for d in docs}
    return [by_id[i] for i in ids if i in by_id]


class BrandSwitchRequest(BaseModel):
    tenant_id: str


@router.post("/dash/brand/switch", response_model=DashLoginResponse)
async def switch_store(payload: BrandSwitchRequest, u: dict = Depends(get_dash_user)):
    """Mint a new dash token scoped to a different store, so someone with
    several stores moves between them without a separate login per store.
    An owner can switch to any store under their brand; an area manager (or
    manager) only to the stores the owner assigned them. This is the single
    place that authorizes a dash token to act on a tenant other than the
    user's home store, so the check matters for tenant isolation."""
    db = get_db()
    # Re-fetch the real identity row (the dependency's `u` may already carry
    # an overridden tenant_id from a previous switch) so must_change_password
    # and the outgoing token are anchored to the account, not the last store.
    fresh = await db.dashboard_users.find_one({"id": u["id"]}, {"_id": 0})
    if payload.tenant_id not in await accessible_store_ids(db, fresh):
        raise HTTPException(status_code=403, detail="You don't have access to that store")
    target = await db.tenants.find_one({"id": payload.tenant_id}, {"_id": 0, "id": 1, "slug": 1, "brand_id": 1})
    if not target:
        raise HTTPException(status_code=403, detail="You don't have access to that store")
    token = _create_dash_token(fresh, tenant_id=target["id"])
    public = _to_public(fresh, target) | {"tenant_id": target["id"]}
    return {
        "token": token,
        "must_change_password": bool(fresh.get("must_change_password")),
        "user": public,
    }


@router.get("/dash/brand/invites", response_model=List[BrandInvite])
async def my_pending_invites(u: dict = Depends(get_dash_user)):
    """Pending brand-join invites addressed to the caller's own store. Only
    an owner can see/act on these — a store's manager or area manager can't
    hand the whole store over to a brand."""
    if u.get("dash_role") != "owner":
        return []
    db = get_db()
    return await db.brand_invites.find(
        {"tenant_id": u["tenant_id"], "status": "pending"}, {"_id": 0},
    ).sort("created_at", -1).to_list(50)


@router.post("/dash/brand/invites/{invite_id}/accept", response_model=BrandInvite)
async def accept_brand_invite(invite_id: str, u: dict = Depends(get_dash_user)):
    if u.get("dash_role") != "owner":
        raise HTTPException(status_code=403, detail="Only the store owner can accept a brand invite")
    db = get_db()
    invite = await db.brand_invites.find_one({"id": invite_id, "status": "pending"}, {"_id": 0})
    if not invite or invite["tenant_id"] != u["tenant_id"]:
        raise HTTPException(status_code=404, detail="Invite not found")
    # Joining only sets the store's own brand_id — it does NOT touch this
    # owner's dashboard_users.brand_id, so they still can't switch to other
    # stores in the brand. Only the brand owner gains switcher/rollup access
    # to this store; the relationship is one-way by design.
    await db.tenants.update_one({"id": u["tenant_id"]}, {"$set": {"brand_id": invite["brand_id"]}})
    res = await db.brand_invites.find_one_and_update(
        {"id": invite_id}, {"$set": {"status": "accepted", "responded_at": now_ist().isoformat()}},
        return_document=True,
    )
    return clean(res) if res else invite


@router.post("/dash/brand/invites/{invite_id}/decline", response_model=BrandInvite)
async def decline_brand_invite(invite_id: str, u: dict = Depends(get_dash_user)):
    if u.get("dash_role") != "owner":
        raise HTTPException(status_code=403, detail="Only the store owner can respond to a brand invite")
    db = get_db()
    invite = await db.brand_invites.find_one({"id": invite_id, "status": "pending"}, {"_id": 0})
    if not invite or invite["tenant_id"] != u["tenant_id"]:
        raise HTTPException(status_code=404, detail="Invite not found")
    res = await db.brand_invites.find_one_and_update(
        {"id": invite_id}, {"$set": {"status": "declined", "responded_at": now_ist().isoformat()}},
        return_document=True,
    )
    return clean(res) if res else invite


@router.post("/dash/auth/change-password")
async def dash_change_password(payload: DashChangePassword, u: dict = Depends(get_dash_user)):
    if len(payload.new_password or "") < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    db = get_db()
    fresh = await db.dashboard_users.find_one({"id": u["id"]}, {"_id": 0})
    # If the account is not in must-change mode, require the current password.
    if not fresh.get("must_change_password"):
        if not payload.current_password or not _verify_pw(payload.current_password, fresh["password_hash"]):
            raise HTTPException(status_code=401, detail="Current password is incorrect")
    await db.dashboard_users.update_one(
        {"id": u["id"]},
        {"$set": {"password_hash": _hash_pw(payload.new_password),
                  "must_change_password": False,
                  "password_changed_at": now_ist().isoformat()}},
    )
    return {"ok": True}


async def ensure_demo_dashboard_users(db) -> None:
    """Idempotent seed of 3 demo dashboard accounts for the `demo` tenant.
    Called from `seed.py` after the tenant has been ensured."""
    tenant = await db.tenants.find_one({"slug": "demo"}, {"_id": 0, "id": 1})
    if not tenant:
        return
    tid = tenant["id"]

    # Make sure we have at least one location for the manager to point at.
    locs = await db.locations.find({"tenant_id": tid}, {"_id": 0, "id": 1}).to_list(10)
    primary_loc_id = locs[0]["id"] if locs else "loc_default"

    accounts = [
        {
            "id": f"da_owner_{tid}",
            "email": "owner@demo.com",
            "name": "Restaurant Owner",
            "dash_role": "owner",
            "tenant_id": tid,
            "location_ids": [],  # empty = all locations
            "must_change_password": False,
            "default_pw": "OwnerPass#2025",
        },
        {
            "id": f"da_manager_{tid}",
            "email": "manager@demo.com",
            "name": "Store Manager",
            "dash_role": "manager",
            "tenant_id": tid,
            "location_ids": [primary_loc_id],
            "must_change_password": False,
            "default_pw": "DemoMgr#2025",
        },
        {
            "id": f"da_area_{tid}",
            "email": "area@demo.com",
            "name": "Area Manager",
            "dash_role": "area_manager",
            "tenant_id": tid,
            "location_ids": [l["id"] for l in locs],  # all current locations
            "must_change_password": False,
            "default_pw": "DemoArea#2025",
        },
    ]
    for a in accounts:
        pw = a.pop("default_pw")
        existing = await db.dashboard_users.find_one({"email": a["email"]}, {"_id": 0})
        if existing:
            # Refresh the location list (in case new locations were added since seed).
            await db.dashboard_users.update_one(
                {"email": a["email"]},
                {"$set": {"location_ids": a["location_ids"], "active": True, "tenant_id": a["tenant_id"]}},
            )
            continue
        a["password_hash"] = _hash_pw(pw)
        a["active"] = True
        a["created_at"] = now_ist().isoformat()
        await db.dashboard_users.insert_one(a)


def _generate_temp_password() -> str:
    # url-safe token, no ambiguous punctuation — easy to read back over chat/phone.
    return secrets.token_urlsafe(9)


async def provision_tenant_dashboard(db, tenant: dict) -> List[dict]:
    """Create the standard 3 dashboard accounts (owner / area manager /
    manager) for a tenant, so every tenant has a working Dashboard login the
    moment it's created — called automatically from tenant creation.

    Idempotent per email: an account that already exists (e.g. re-running
    this against the `demo` tenant) is left untouched. Returns only the
    accounts that were newly created, each with its plaintext temp password —
    this is the only place that password is ever available, so surface it to
    the caller immediately (API response / CLI output) and hand it off.
    """
    tid = tenant["id"]
    slug = tenant["slug"]
    name = tenant.get("name") or slug

    locs = await db.locations.find({"tenant_id": tid}, {"_id": 0, "id": 1}).to_list(10)
    primary_loc_id = locs[0]["id"] if locs else None

    specs = [
        ("owner", "owner", f"owner@{slug}.com", f"{name} Owner", []),
        ("area_manager", "area", f"area@{slug}.com", f"{name} Area Manager", [l["id"] for l in locs]),
        ("manager", "manager", f"manager@{slug}.com", f"{name} Store Manager", [primary_loc_id] if primary_loc_id else []),
    ]

    created: List[dict] = []
    for dash_role, id_part, email, display_name, location_ids in specs:
        if await db.dashboard_users.find_one({"email": email}, {"_id": 0, "id": 1}):
            continue
        temp_pw = _generate_temp_password()
        doc = {
            "id": f"da_{id_part}_{tid}",
            "email": email,
            "name": display_name,
            "dash_role": dash_role,
            "tenant_id": tid,
            "location_ids": location_ids,
            "must_change_password": True,
            "password_hash": _hash_pw(temp_pw),
            "active": True,
            "created_at": now_ist().isoformat(),
        }
        await db.dashboard_users.insert_one(doc)
        created.append({"dash_role": dash_role, "email": email, "password": temp_pw, "name": display_name})
    return created


# ---------- Team & access (owner only) ----------
# The owner decides who gets a dashboard login, which stores each manager /
# area manager can reach, and which sections (dash_access.PERMISSIONS) they
# can use. Changes apply to already-issued tokens on their next request:
# get_current_user / get_dash_user re-check the store, and
# enforce_dash_permissions reads permissions fresh from the row.
class TeamMemberCreate(BaseModel):
    email: str
    name: str
    dash_role: Literal["manager", "area_manager"]
    store_ids: List[str]
    permissions: Optional[Dict[str, bool]] = None


class TeamMemberUpdate(BaseModel):
    name: Optional[str] = None
    dash_role: Optional[Literal["manager", "area_manager"]] = None
    store_ids: Optional[List[str]] = None
    permissions: Optional[Dict[str, bool]] = None
    active: Optional[bool] = None


async def _team_owner(u: dict = Depends(get_dash_user)) -> dict:
    if u.get("dash_role") != OWNER:
        raise HTTPException(status_code=403, detail="Only the owner can manage team access")
    db = get_db()
    # Scope from the owner's real row, not the store they've switched to.
    fresh = await db.dashboard_users.find_one({"id": u["id"]}, {"_id": 0, "password_hash": 0})
    fresh["_stores"] = await owner_store_ids(db, fresh)
    return fresh


def _member_public(m: dict) -> dict:
    return {
        "id": m["id"],
        "email": m["email"],
        "name": m.get("name") or m["email"].split("@")[0],
        "dash_role": m["dash_role"],
        "store_ids": assigned_store_ids(m),
        "permissions": effective_permissions(m),
        "active": m.get("active") is not False,
        "must_change_password": bool(m.get("must_change_password")),
    }


def _validate_stores(role: str, store_ids: List[str], allowed: List[str]) -> List[str]:
    ids: List[str] = []
    for sid in store_ids:
        if sid not in ids:
            ids.append(sid)
    if not ids:
        raise HTTPException(status_code=400, detail="Pick at least one store")
    if any(sid not in allowed for sid in ids):
        raise HTTPException(status_code=403, detail="You can only assign your own stores")
    if role == MANAGER and len(ids) != 1:
        raise HTTPException(status_code=400, detail="A store manager has exactly one store; make them an area manager for more")
    return ids


async def _member_in_scope(db, owner: dict, member_id: str) -> dict:
    m = await db.dashboard_users.find_one({"id": member_id}, {"_id": 0, "password_hash": 0})
    if not m or m.get("dash_role") == OWNER or m.get("tenant_id") not in owner["_stores"]:
        raise HTTPException(status_code=404, detail="Team member not found")
    return m


@router.get("/dash/team")
async def list_team(owner: dict = Depends(_team_owner)):
    db = get_db()
    stores = await db.tenants.find(
        {"id": {"$in": owner["_stores"]}}, {"_id": 0, "id": 1, "name": 1, "slug": 1},
    ).to_list(500)
    members = await db.dashboard_users.find(
        {"tenant_id": {"$in": owner["_stores"]}, "dash_role": {"$ne": OWNER}},
        {"_id": 0, "password_hash": 0},
    ).sort("name", 1).to_list(1000)
    return {
        "stores": stores,
        "permissions": [
            {"key": k, "label": v[0], "area_manager_default": v[1], "manager_default": v[2]}
            for k, v in PERMISSIONS.items()
        ],
        "members": [_member_public(m) for m in members],
    }


@router.post("/dash/team")
async def create_team_member(payload: TeamMemberCreate, owner: dict = Depends(_team_owner)):
    email = (payload.email or "").strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=400, detail="Enter a valid email")
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Enter a name")
    ids = _validate_stores(payload.dash_role, payload.store_ids, owner["_stores"])
    db = get_db()
    if await db.dashboard_users.find_one({"email": email}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=409, detail="That email already has a dashboard login")
    temp_pw = _generate_temp_password()
    doc = {
        "id": f"da_{uuid.uuid4().hex[:10]}_{ids[0]}",
        "email": email,
        "name": payload.name.strip(),
        "dash_role": payload.dash_role,
        "tenant_id": ids[0],
        "store_ids": ids,
        "location_ids": [],
        "permissions": clean_permissions(payload.permissions),
        "must_change_password": True,
        "password_hash": _hash_pw(temp_pw),
        "active": True,
        "created_by": owner["id"],
        "created_at": now_ist().isoformat(),
    }
    await db.dashboard_users.insert_one(doc)
    return {"member": _member_public(doc), "temp_password": temp_pw}


@router.patch("/dash/team/{member_id}")
async def update_team_member(member_id: str, payload: TeamMemberUpdate, owner: dict = Depends(_team_owner)):
    db = get_db()
    m = await _member_in_scope(db, owner, member_id)
    updates: dict = {}
    if payload.name is not None:
        if not payload.name.strip():
            raise HTTPException(status_code=400, detail="Enter a name")
        updates["name"] = payload.name.strip()
    role = payload.dash_role or m["dash_role"]
    if payload.dash_role is not None:
        updates["dash_role"] = role
    if payload.store_ids is not None or payload.dash_role is not None:
        requested = payload.store_ids if payload.store_ids is not None else assigned_store_ids(m)
        ids = _validate_stores(role, requested, owner["_stores"])
        updates["store_ids"] = ids
        if m["tenant_id"] not in ids:
            # Home store taken away — re-home them on their first remaining
            # store so their next login lands somewhere they're allowed.
            updates["tenant_id"] = ids[0]
            updates["location_ids"] = []
    if payload.permissions is not None:
        merged = {**(m.get("permissions") or {}), **clean_permissions(payload.permissions)}
        updates["permissions"] = merged
    if payload.active is not None:
        updates["active"] = bool(payload.active)
    if updates:
        updates["updated_at"] = now_ist().isoformat()
        await db.dashboard_users.update_one({"id": member_id}, {"$set": updates})
    fresh = await db.dashboard_users.find_one({"id": member_id}, {"_id": 0, "password_hash": 0})
    return _member_public(fresh)


@router.post("/dash/team/{member_id}/reset-password")
async def reset_team_member_password(member_id: str, owner: dict = Depends(_team_owner)):
    db = get_db()
    await _member_in_scope(db, owner, member_id)
    temp_pw = _generate_temp_password()
    await db.dashboard_users.update_one(
        {"id": member_id},
        {"$set": {"password_hash": _hash_pw(temp_pw), "must_change_password": True,
                  "password_changed_at": now_ist().isoformat()}},
    )
    return {"temp_password": temp_pw}
