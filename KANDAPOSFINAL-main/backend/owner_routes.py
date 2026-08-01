"""Owner Portal API routes (/api/owner/*) for Kanda POS.

All endpoints require a PlatformOwner JWT (issued from /api/owner/auth/verify).
The exception is the two login endpoints which take the user from
email/password → pre-2FA → TOTP verification.
"""
import base64
import io
import uuid
from datetime import datetime, timezone, timedelta
from tz import now_ist
from typing import List, Optional, Literal

import qrcode
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr

from auth import hash_pin
from db import get_db
from owners import (
    create_owner_access_token, create_pre2fa_token, create_impersonation_token,
    get_current_owner, get_owner_pre2fa, hash_password, verify_password,
    verify_totp, provisioning_uri,
)
from tenants import DEMO_TENANT
from subscriptions import subscribe_tenant, cancel_tenant_subscription, PLANS, grace_state
from models import default_features, BusinessType, TenantFeaturesUpdate, TenantInfo
from routes.dash_auth import provision_tenant_dashboard


owner_router = APIRouter(prefix="/owner")


# ---------- Models ----------
class OwnerLoginRequest(BaseModel):
    email: EmailStr
    password: str


class OwnerLoginResponse(BaseModel):
    pre2faToken: str
    totpRequired: bool = True


class OwnerTotpVerifyRequest(BaseModel):
    code: str


class OwnerPublic(BaseModel):
    id: str
    email: str
    name: str


class OwnerTotpVerifyResponse(BaseModel):
    token: str
    owner: OwnerPublic


class TenantStore(BaseModel):
    name: str
    address: str
    phone: str
    tax_id: str = ""
    footer: str = "Thank you for ordering!"


class TenantPublic(BaseModel):
    id: str
    slug: str
    name: str
    status: str
    plan: str
    contact_email: Optional[str] = None
    store: Optional[dict] = None
    created_at: Optional[str] = None
    business_type: Optional[str] = "restaurant"
    features: Optional[dict] = None
    brand_id: Optional[str] = None
    # Only populated on the create_tenant response — the plaintext temp
    # passwords are generated once and never stored/retrievable again.
    dashboard_accounts: Optional[List[dict]] = None


class TenantCreateRequest(BaseModel):
    slug: str
    name: str
    contact_email: EmailStr
    store: TenantStore
    manager_name: str = "Manager"
    manager_pin: str  # 4-digit PIN for the seeded Manager
    plan: str = "trial"
    business_type: BusinessType = "restaurant"


class ImpersonateRequest(BaseModel):
    mode: Literal["full", "auditor"] = "full"
    reason: Optional[str] = None


class ImpersonateResponse(BaseModel):
    token: str
    tenantSlug: str
    tenantName: str
    mode: str
    expiresInSeconds: int = 1800


# ---------- helpers ----------
def _clean(d: dict) -> dict:
    d.pop("_id", None)
    d.pop("password_hash", None)
    d.pop("totp_secret", None)
    return d


async def _platform_kpis(db) -> dict:
    now = now_ist()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()

    total_tenants = await db.tenants.count_documents({})
    active_tenants = await db.tenants.count_documents({"status": "active"})

    pipeline_today = [
        {"$match": {"placedAt": {"$gte": today}}},
        {"$group": {"_id": None, "gmv": {"$sum": "$total"}, "orders": {"$sum": 1}}},
    ]
    pipeline_month = [
        {"$match": {"placedAt": {"$gte": month_start}}},
        {"$group": {"_id": None, "gmv": {"$sum": "$total"}, "orders": {"$sum": 1}}},
    ]
    today_doc = await db.orders.aggregate(pipeline_today).to_list(1)
    month_doc = await db.orders.aggregate(pipeline_month).to_list(1)
    today_row = today_doc[0] if today_doc else {"gmv": 0, "orders": 0}
    month_row = month_doc[0] if month_doc else {"gmv": 0, "orders": 0}

    # active tenants today: distinct tenant_ids on today's orders
    active_today = await db.orders.distinct("tenant_id", {"placedAt": {"$gte": today}})

    return {
        "totalTenants": total_tenants,
        "activeTenants": active_tenants,
        "activeToday": len(active_today),
        "gmvToday": round(today_row.get("gmv", 0), 2),
        "ordersToday": today_row.get("orders", 0),
        "gmvMonth": round(month_row.get("gmv", 0), 2),
        "ordersMonth": month_row.get("orders", 0),
    }


# ---------- Auth ----------
@owner_router.post("/auth/login", response_model=OwnerLoginResponse)
async def owner_login(payload: OwnerLoginRequest):
    db = get_db()
    email = payload.email.lower().strip()
    owner = await db.platform_owners.find_one({"email": email})
    if not owner or not verify_password(payload.password, owner["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return OwnerLoginResponse(pre2faToken=create_pre2fa_token(owner["id"]))


@owner_router.post("/auth/verify", response_model=OwnerTotpVerifyResponse)
async def owner_verify_totp(payload: OwnerTotpVerifyRequest, pending: dict = Depends(get_owner_pre2fa)):
    db = get_db()
    full = await db.platform_owners.find_one({"id": pending["id"]})
    if not full:
        raise HTTPException(status_code=401, detail="Owner not found")
    if not verify_totp(full["totp_secret"], payload.code.strip()):
        raise HTTPException(status_code=401, detail="Invalid TOTP code")
    token = create_owner_access_token(full["id"])
    return OwnerTotpVerifyResponse(
        token=token,
        owner=OwnerPublic(id=full["id"], email=full["email"], name=full["name"]),
    )


@owner_router.get("/auth/me", response_model=OwnerPublic)
async def owner_me(owner: dict = Depends(get_current_owner)):
    return OwnerPublic(id=owner["id"], email=owner["email"], name=owner["name"])


# ---------- Dashboard ----------
@owner_router.get("/kpis")
async def kpis(owner: dict = Depends(get_current_owner)):
    db = get_db()
    return await _platform_kpis(db)


@owner_router.get("/tenants")
async def list_tenants(owner: dict = Depends(get_current_owner)):
    db = get_db()
    tenants = await db.tenants.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    # decorate with quick stats
    now_iso = now_ist().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    for t in tenants:
        t["ordersToday"] = await db.orders.count_documents({"tenant_id": t["id"], "placedAt": {"$gte": now_iso}})
        t["staffCount"] = await db.users.count_documents({"tenant_id": t["id"]})
    return tenants


@owner_router.get("/tenants/{tenant_id}")
async def tenant_detail(tenant_id: str, owner: dict = Depends(get_current_owner)):
    db = get_db()
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    now = now_ist()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    last_order_doc = await db.orders.find({"tenant_id": tenant_id}, {"_id": 0, "placedAt": 1, "number": 1, "total": 1}).sort("placedAt", -1).limit(1).to_list(1)

    orders_today = await db.orders.count_documents({"tenant_id": tenant_id, "placedAt": {"$gte": today}})
    orders_month = await db.orders.count_documents({"tenant_id": tenant_id, "placedAt": {"$gte": month_start}})
    gmv_today_doc = await db.orders.aggregate([
        {"$match": {"tenant_id": tenant_id, "placedAt": {"$gte": today}}},
        {"$group": {"_id": None, "sum": {"$sum": "$total"}}},
    ]).to_list(1)
    gmv_month_doc = await db.orders.aggregate([
        {"$match": {"tenant_id": tenant_id, "placedAt": {"$gte": month_start}}},
        {"$group": {"_id": None, "sum": {"$sum": "$total"}}},
    ]).to_list(1)

    staff = await db.users.find({"tenant_id": tenant_id}, {"_id": 0, "pin_hash": 0}).to_list(50)
    menu_count = await db.menu_items.count_documents({"tenant_id": tenant_id})
    customer_count = await db.customers.count_documents({"tenant_id": tenant_id})
    low_stock = await db.inventory.count_documents({
        "tenant_id": tenant_id,
        "$expr": {"$lte": ["$stock", "$reorder"]},
    })

    return {
        "tenant": tenant,
        "kpis": {
            "ordersToday": orders_today,
            "ordersMonth": orders_month,
            "gmvToday": round(gmv_today_doc[0]["sum"], 2) if gmv_today_doc else 0,
            "gmvMonth": round(gmv_month_doc[0]["sum"], 2) if gmv_month_doc else 0,
            "menuItems": menu_count,
            "customers": customer_count,
            "lowStockItems": low_stock,
            "lastOrderAt": last_order_doc[0]["placedAt"] if last_order_doc else None,
        },
        "staff": staff,
    }


@owner_router.patch("/tenants/{tenant_id}/features", response_model=TenantInfo)
async def update_tenant_features_as_owner(tenant_id: str, payload: TenantFeaturesUpdate, owner: dict = Depends(get_current_owner)):
    """Platform Owner control panel — flip any feature on/off for any client
    store without touching code. Independent of business_type and plan; the
    Owner can hand-tune exactly what a given client's subscription includes."""
    db = get_db()
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    business_type = tenant.get("business_type", "restaurant")
    update = payload.model_dump(exclude_none=True)
    merged = {**default_features(business_type), **(tenant.get("features") or {}), **update}
    await db.tenants.update_one({"id": tenant_id}, {"$set": {"features": merged}})
    return TenantInfo(id=tenant["id"], slug=tenant.get("slug", tenant["id"]), name=tenant.get("name", ""),
                       businessType=business_type, features=merged)


@owner_router.patch("/tenants/{tenant_id}/business-type", response_model=TenantPublic)
async def update_tenant_business_type(tenant_id: str, business_type: BusinessType, owner: dict = Depends(get_current_owner)):
    """Switch a store between restaurant and retail after the fact. Doesn't
    touch features already set — only re-derives defaults for any feature
    that's never been explicitly toggled."""
    db = get_db()
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    merged = {**default_features(business_type), **(tenant.get("features") or {})}
    await db.tenants.update_one({"id": tenant_id}, {"$set": {"business_type": business_type, "features": merged}})
    updated = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    return TenantPublic(**updated)


@owner_router.post("/tenants", response_model=TenantPublic)
async def create_tenant(payload: TenantCreateRequest, owner: dict = Depends(get_current_owner)):
    db = get_db()
    slug = payload.slug.lower().strip()
    if not slug.isalnum():
        raise HTTPException(status_code=400, detail="Slug must be lowercase alphanumeric")
    if await db.tenants.find_one({"slug": slug}):
        raise HTTPException(status_code=400, detail="Tenant slug already taken")
    if not (payload.manager_pin.isdigit() and 4 <= len(payload.manager_pin) <= 6):
        raise HTTPException(status_code=400, detail="Manager PIN must be 4-6 digits")

    tenant_id = slug
    now_iso = now_ist().isoformat()
    tenant_doc = {
        "id": tenant_id,
        "slug": slug,
        "name": payload.name,
        "status": "active",
        "plan": payload.plan,
        "contact_email": payload.contact_email,
        "store": payload.store.model_dump(),
        "created_at": now_iso,
        "business_type": payload.business_type,
        "features": default_features(payload.business_type),
    }
    await db.tenants.insert_one(tenant_doc)

    # Seed a Manager + counter so the tenant can immediately log in and start.
    initials = "".join([w[0] for w in payload.manager_name.split() if w])[:2].upper() or "MG"
    await db.users.insert_one({
        "id": f"s_{uuid.uuid4().hex[:8]}",
        "tenant_id": tenant_id,
        "name": payload.manager_name,
        "role": "Manager",
        "initials": initials,
        "pin_hash": hash_pin(payload.manager_pin),
        "created_at": now_iso,
    })
    await db.counters.update_one(
        {"_id": f"{tenant_id}:order_number"},
        {"$setOnInsert": {"seq": 1000}}, upsert=True,
    )

    # Every tenant gets a working Dashboard login the moment it's created —
    # the plaintext temp passwords only exist in this response, so the
    # frontend must show them to the Platform Owner right now.
    tenant_doc["dashboard_accounts"] = await provision_tenant_dashboard(db, tenant_doc)
    return TenantPublic(**tenant_doc)


@owner_router.post("/tenants/{tenant_id}/impersonate", response_model=ImpersonateResponse)
async def impersonate_tenant(tenant_id: str, payload: ImpersonateRequest, owner: dict = Depends(get_current_owner)):
    db = get_db()
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    target = await db.users.find_one({"tenant_id": tenant_id, "role": "Manager"}, {"_id": 0, "pin_hash": 0})
    if not target:
        raise HTTPException(status_code=400, detail="No Manager seeded for this tenant")
    if payload.mode == "auditor" and not (payload.reason and payload.reason.strip()):
        raise HTTPException(status_code=400, detail="Auditor mode requires a reason")

    token = create_impersonation_token(owner["id"], tenant_id, target, payload.mode)

    # Lightweight audit row — a full audit log table comes in P3c.
    await db.owner_impersonations.insert_one({
        "id": f"imp_{uuid.uuid4().hex[:10]}",
        "owner_id": owner["id"],
        "tenant_id": tenant_id,
        "mode": payload.mode,
        "reason": (payload.reason or "").strip()[:500],
        "at": now_ist().isoformat(),
    })
    return ImpersonateResponse(
        token=token, tenantSlug=tenant["slug"], tenantName=tenant["name"], mode=payload.mode,
    )


@owner_router.get("/tenants/{tenant_id}/totp-qr")
async def my_totp_qr(tenant_id: str, owner: dict = Depends(get_current_owner)):
    """(Unused — placeholder so future “rotate tenant TOTP” lives here too.)"""
    raise HTTPException(status_code=404, detail="Not implemented")


@owner_router.get("/me/totp-qr")
async def owner_totp_qr(owner: dict = Depends(get_current_owner)):
    db = get_db()
    full = await db.platform_owners.find_one({"id": owner["id"]})
    uri = provisioning_uri(full["totp_secret"], full["email"])
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    data = base64.b64encode(buf.getvalue()).decode("ascii")
    return {"otpauthUri": uri, "qrPngBase64": data}


# ---------- Subscriptions ----------
class SubscribeIn(BaseModel):
    plan: Literal["starter", "pro", "master"]


@owner_router.get("/plans")
async def list_plans(owner: dict = Depends(get_current_owner)):
    """Return the static plan catalogue (no secrets) for the Subscribe UI."""
    return [
        {"key": k, "name": p["name"], "amount_inr": p["amount_inr"], "currency": p["currency"]}
        for k, p in PLANS.items()
    ]


@owner_router.post("/tenants/{tenant_id}/subscribe")
async def subscribe_tenant_route(tenant_id: str, payload: SubscribeIn, owner: dict = Depends(get_current_owner)):
    return await subscribe_tenant(tenant_id, payload.plan)


@owner_router.post("/tenants/{tenant_id}/cancel-subscription")
async def cancel_tenant_route(tenant_id: str, owner: dict = Depends(get_current_owner)):
    return await cancel_tenant_subscription(tenant_id, immediate=False)


@owner_router.get("/tenants/{tenant_id}/billing")
async def tenant_billing(tenant_id: str, owner: dict = Depends(get_current_owner)):
    db = get_db()
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    events = await db.subscription_events.find({"tenant_id": tenant_id}, {"_id": 0}).sort("at", -1).limit(20).to_list(20)
    return {
        "tenant_id": tenant_id,
        "plan": tenant.get("plan", "none"),
        "subscription_id": tenant.get("subscription_id"),
        "status": tenant.get("subscription_status", "none"),
        "current_period_end": tenant.get("current_period_end"),
        "grace_until": tenant.get("grace_until"),
        "last_payment_at": tenant.get("last_payment_at"),
        "gate": grace_state(tenant),
        "events": events,
    }
