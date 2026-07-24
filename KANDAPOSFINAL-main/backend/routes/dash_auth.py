"""Restaurant Dashboard auth — email + password login for Owner / Manager / Area Manager.

Three roles share the same `/biz/login` page; the JWT carries `dash_role` so the
frontend can render the right scope of nav, and `location_ids` to scope what
data they can see. The JWT also still carries `role: "Manager"` so the existing
POS endpoints (which all gate on `require_role("Manager")`) accept dashboard
tokens transparently — no widespread route changes needed.
"""
import os
import uuid
from datetime import datetime, timezone, timedelta
from tz import now_ist
from typing import List, Literal, Optional

import bcrypt
import jwt
from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel, ConfigDict

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
    must_change_password: bool = False


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


def _create_dash_token(u: dict) -> str:
    payload = {
        "sub": u["id"],
        "tenant_id": u["tenant_id"],
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
    if not u:
        raise HTTPException(status_code=401, detail="User not found")
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
    return _to_public(u, tenant)


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
