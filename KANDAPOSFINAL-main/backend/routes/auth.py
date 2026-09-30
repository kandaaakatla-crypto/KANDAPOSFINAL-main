"""Tenant staff auth + drivers list + per-tenant billing-status helper."""
import base64
import io
from typing import List, Literal

from fastapi import APIRouter, HTTPException, Depends, Request, UploadFile, File, Form
from PIL import Image, UnidentifiedImageError

from db import get_db
from auth import verify_pin, create_access_token, get_current_user, require_role
from tenants import resolve_tenant_from_request, tenant_filter
from subscriptions import grace_state
from ratelimit import peek as rate_limit_peek, hit as rate_limit_hit
from models import LoginRequest, LoginResponse, UserPublic, TenantInfo, TenantFeaturesUpdate, default_features

router = APIRouter()

# A PIN is 4 digits — 10,000 combinations. Cap failed attempts per source so
# brute-forcing one isn't practical, without punishing a shared terminal
# where many staff enter their own correct PIN throughout a shift (only
# failures count, see below).
LOGIN_MAX_FAILURES = 6
LOGIN_WINDOW_SECONDS = 300


def _client_ip(request: Request) -> str:
    # Cloud Run puts the real client IP first in X-Forwarded-For, with its
    # own infra's hops appended after.
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("/auth/login", response_model=LoginResponse)
async def login(payload: LoginRequest, request: Request):
    db = get_db()
    pin = (payload.pin or "").strip()
    if not pin:
        raise HTTPException(status_code=400, detail="PIN is required")
    tenant = await resolve_tenant_from_request(request, db)

    rl_key = f"loginrl:{tenant['id']}:{_client_ip(request)}"
    if await rate_limit_peek(rl_key) >= LOGIN_MAX_FAILURES:
        raise HTTPException(
            status_code=429,
            detail="Too many failed sign-in attempts. Please wait a few minutes and try again.",
        )

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
    await rate_limit_hit(rl_key, LOGIN_WINDOW_SECONDS)
    raise HTTPException(status_code=401, detail="Invalid PIN")


@router.get("/tenant/public-info")
async def tenant_public_info(request: Request):
    """Unauthenticated — just enough for the Staff Sign In screen to brand
    itself correctly (retail vs restaurant icon/copy) before anyone has
    logged in. Resolves the tenant the same way /auth/login does (the
    X-Tenant-Slug header client.js already attaches), so no frontend
    plumbing beyond calling this endpoint is needed."""
    db = get_db()
    tenant = await resolve_tenant_from_request(request, db)
    return {"name": tenant.get("name", ""), "businessType": tenant.get("business_type", "restaurant")}


@router.get("/auth/me", response_model=UserPublic)
async def me(user: dict = Depends(get_current_user)):
    return UserPublic(id=user["id"], name=user["name"], role=user["role"], initials=user["initials"])


@router.get("/tenant/info", response_model=TenantInfo)
async def tenant_info(user: dict = Depends(get_current_user)):
    """Business type + feature flags — drives which nav items/screens the POS
    and Dashboard show (Tables/KDS/Packing/Dispatch/meal deals/pizza sizing)."""
    db = get_db()
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    business_type = tenant.get("business_type", "restaurant")
    features = {**default_features(business_type), **(tenant.get("features") or {})}
    return TenantInfo(id=tenant["id"], slug=tenant.get("slug", tenant["id"]), name=tenant.get("name", ""),
                       businessType=business_type, features=features, brandId=tenant.get("brand_id"),
                       store=tenant.get("store"))


@router.patch("/tenant/features", response_model=TenantInfo)
async def update_tenant_features(payload: TenantFeaturesUpdate, user: dict = Depends(require_role("Manager"))):
    """Lets a tenant's own Manager/Owner/Area Manager turn individual
    restaurant-only features on or off, independent of business_type."""
    db = get_db()
    update = payload.model_dump(exclude_none=True)
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    business_type = tenant.get("business_type", "restaurant")
    merged = {**default_features(business_type), **(tenant.get("features") or {}), **update}
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"features": merged}})
    return TenantInfo(id=tenant["id"], slug=tenant.get("slug", tenant["id"]), name=tenant.get("name", ""),
                       businessType=business_type, features=merged)


# QR ordering branding — a store's own logo + background photo on its
# customer-facing table/pickup ordering pages (frontend/src/components/
# storefront/). Stored as a data: URI directly on tenant.store, the same
# free-form dict store_footer/logo_url already live on — there's no file
# storage bucket wired up for this app, so re-encoding a resized copy
# in-place keeps this self-contained rather than needing new cloud
# infrastructure. Max dimensions differ (a logo only needs to be legible
# at header-icon size; a background fills the whole screen) but both go
# through the same WEBP re-encode to keep the resulting document small.
MAX_UPLOAD_BYTES = 8 * 1024 * 1024  # raw upload cap, before re-encoding
_BRANDING_LIMITS = {"logo": 512, "background": 1600}


@router.post("/tenant/store/branding")
async def upload_store_branding(
    field: Literal["logo", "background"] = Form(...),
    file: UploadFile = File(...),
    user: dict = Depends(require_role("Manager")),
):
    """Resizes + re-encodes the upload, saves it as a data: URI on this
    tenant's own store record, and returns the updated store dict. Scoped to
    the caller's tenant_id — one store's upload never touches another's."""
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image is too large — please use one under 8MB.")
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError):
        # Truncated/corrupt files raise OSError from img.load(), and huge
        # pixel dimensions raise DecompressionBombError — both are bad input,
        # not a server fault.
        raise HTTPException(status_code=400, detail="That file doesn't look like an image.")

    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if "A" in img.getbands() else "RGB")

    max_side = _BRANDING_LIMITS[field]
    if max(img.size) > max_side:
        img.thumbnail((max_side, max_side), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=82, method=6)
    data_url = f"data:image/webp;base64,{base64.b64encode(buf.getvalue()).decode('ascii')}"

    db = get_db()
    key = "logo_url" if field == "logo" else "background_image_url"
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    store = {**(tenant.get("store") or {}), key: data_url}
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"store": store}})
    return store


@router.delete("/tenant/store/branding")
async def clear_store_branding(
    field: Literal["logo", "background"],
    user: dict = Depends(require_role("Manager")),
):
    db = get_db()
    key = "logo_url" if field == "logo" else "background_image_url"
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    store = {**(tenant.get("store") or {})}
    store.pop(key, None)
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"store": store}})
    return store


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
