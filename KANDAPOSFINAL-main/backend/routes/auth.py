"""Tenant staff auth + drivers list + per-tenant billing-status helper."""
from typing import List

from fastapi import APIRouter, HTTPException, Depends, Request

from db import get_db
from auth import verify_pin, create_access_token, get_current_user
from tenants import resolve_tenant_from_request, tenant_filter
from subscriptions import grace_state
from models import LoginRequest, LoginResponse, UserPublic

router = APIRouter()


@router.post("/auth/login", response_model=LoginResponse)
async def login(payload: LoginRequest, request: Request):
    db = get_db()
    pin = (payload.pin or "").strip()
    if not pin:
        raise HTTPException(status_code=400, detail="PIN is required")
    tenant = await resolve_tenant_from_request(request, db)
    # Subscription gate: hard-block staff login if the tenant is past the grace window.
    sub = grace_state(tenant)
    if not sub["ok"]:
        raise HTTPException(
            status_code=402,
            detail={
                "code": "subscription_required",
                "message": "Your subscription has expired. Please contact the platform owner to renew.",
                "status": sub["status"],
                "plan": sub["plan"],
            },
        )
    users = await db.users.find({"tenant_id": tenant["id"]}, {"_id": 0}).to_list(50)
    for u in users:
        if verify_pin(pin, u["pin_hash"]):
            token = create_access_token(u["id"], u["role"], tenant["id"])
            return LoginResponse(
                token=token,
                user=UserPublic(id=u["id"], name=u["name"], role=u["role"], initials=u["initials"]),
            )
    raise HTTPException(status_code=401, detail="Invalid PIN")


@router.get("/auth/me", response_model=UserPublic)
async def me(user: dict = Depends(get_current_user)):
    return UserPublic(id=user["id"], name=user["name"], role=user["role"], initials=user["initials"])


@router.get("/billing/status")
async def billing_status(user: dict = Depends(get_current_user)):
    """Per-tenant billing/subscription state for the soft-warning POS banner."""
    db = get_db()
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return grace_state(tenant)


@router.get("/users/drivers", response_model=List[UserPublic])
async def list_drivers(user: dict = Depends(get_current_user)):
    db = get_db()
    docs = await db.users.find(
        tenant_filter(user, {"role": "Driver"}),
        {"_id": 0, "pin_hash": 0},
    ).to_list(50)
    return docs
