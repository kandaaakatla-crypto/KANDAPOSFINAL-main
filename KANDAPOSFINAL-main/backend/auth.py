"""JWT + bcrypt auth utilities for staff PIN login."""
import os
from datetime import datetime, timezone, timedelta
from tz import now_ist
import bcrypt
import jwt
from fastapi import Request, HTTPException, Depends

JWT_ALG = "HS256"
ACCESS_TOKEN_HOURS = 12


def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_pin(pin: str, pin_hash: str) -> bool:
    return bcrypt.checkpw(pin.encode("utf-8"), pin_hash.encode("utf-8"))


def _secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str, role: str, tenant_id: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "tenant_id": tenant_id,
        "exp": now_ist() + timedelta(hours=ACCESS_TOKEN_HOURS),
        "type": "access",
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALG)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, _secret(), algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def get_current_user(request: Request) -> dict:
    from db import get_db

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = auth_header[7:]
    payload = decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    db = get_db()

    # Dashboard tokens — Restaurant Owner / Manager / Area Manager logged in
    # at /biz. We resolve them from the separate `dashboard_users` collection
    # and synthesize a staff-shaped dict so existing endpoints accept the JWT.
    if payload.get("dash"):
        # Deliberately NOT filtered by the JWT's tenant_id here — a brand
        # owner's token can carry a different tenant_id than their
        # dashboard_users document's home tenant after /dash/brand/switch
        # (see that endpoint's own comment). dashboard_users ids are also
        # tenant-namespaced by construction (f"da_{...}_{tid}"), so there's
        # no collision risk from the broader lookup the way there was for
        # the regular `users` collection above.
        du = await db.dashboard_users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not du or du.get("active") is False:
            raise HTTPException(status_code=401, detail="User not found")
        display_name = du.get("name") or du["email"]
        initials = "".join(w[0] for w in display_name.split()[:2] if w).upper()[:2] or (du["email"][:2].upper())
        return {
            "id": du["id"],
            "name": display_name,
            "initials": initials,
            "role": "Manager",  # Stamped Manager for require_role checks
            "tenant_id": payload.get("tenant_id") or du["tenant_id"],
            "dash": True,
            "dash_role": du.get("dash_role"),
            "location_ids": du.get("location_ids") or [],
        }

    # tenant_id in the filter (not just id) matters two ways: it lets this use
    # the existing (tenant_id, id) compound index as an equality lookup instead
    # of an effectively unscoped scan across every tenant's users, and it closes
    # off a theoretical cross-tenant collision — staff ids are 8 hex chars
    # generated independently per tenant (routes/staff.py), so nothing else
    # guarantees uniqueness across tenants.
    jwt_tenant_id = payload.get("tenant_id")
    user = await db.users.find_one(
        {"tenant_id": jwt_tenant_id, "id": payload["sub"]}, {"_id": 0, "pin_hash": 0}
    )
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    # Anchor tenant_id from the JWT (not the DB row) — JWT is signed and immutable
    # for the token lifetime, which prevents cross-tenant escalation if a user's
    # tenant assignment changes underneath an active session.
    user["tenant_id"] = jwt_tenant_id or user.get("tenant_id")
    return user


def require_role(*roles: str):
    """FastAPI dependency factory — restricts an endpoint to the given staff roles."""
    async def dep(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Forbidden: insufficient role")
        return user
    return dep
