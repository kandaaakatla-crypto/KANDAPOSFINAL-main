"""JWT + bcrypt auth utilities for staff PIN login."""
import os
from datetime import datetime, timezone, timedelta
from tz import now_ist
import bcrypt
import jwt
from typing import Optional
from fastapi import Request, HTTPException, Depends

JWT_ALG = "HS256"
ACCESS_TOKEN_HOURS = 12


def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_pin(pin: str, pin_hash: str) -> bool:
    return bcrypt.checkpw(pin.encode("utf-8"), pin_hash.encode("utf-8"))


def _secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str, role: str, tenant_id: str, device_id: Optional[str] = None) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "tenant_id": tenant_id,
        "exp": now_ist() + timedelta(hours=ACCESS_TOKEN_HOURS),
        "type": "access",
    }
    # Staff sessions started on an unlocked till (routes/pos_devices.py) are
    # bound to it: get_current_user rejects them once the till is removed or
    # when the request doesn't come with that till's device token.
    if device_id:
        payload["dev"] = device_id
    return jwt.encode(payload, _secret(), algorithm=JWT_ALG)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, _secret(), algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def user_cache_key(tenant_id: str, user_id: str) -> str:
    return f"user:{tenant_id}:{user_id}"


async def get_current_user(request: Request) -> dict:
    from db import get_db
    from cache import cache_get, cache_set

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
    cache_key = user_cache_key(jwt_tenant_id, payload["sub"])
    user = await cache_get(cache_key)
    if user is None:
        user = await db.users.find_one(
            {"tenant_id": jwt_tenant_id, "id": payload["sub"]}, {"_id": 0, "pin_hash": 0}
        )
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        # Short TTL — staff.py explicitly invalidates this key on update/deactivate,
        # so the TTL only bounds staleness from writes that bypass that path.
        await cache_set(cache_key, user, ttl=60)
    # Deactivated staff (DELETE /staff/{id}) must lose access immediately, not
    # when their token expires. `is False`, not falsy: legacy rows with no
    # `active` field are active. Checked after the cache read so a cached
    # document is held to the same rule.
    if user.get("active") is False:
        raise HTTPException(status_code=401, detail="User not found")
    if payload.get("dev"):
        from routes.pos_devices import check_bound_device
        await check_bound_device(request, payload["dev"], db)
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
