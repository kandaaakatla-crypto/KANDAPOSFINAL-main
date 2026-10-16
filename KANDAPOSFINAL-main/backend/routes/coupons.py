"""Coupons / promotions — Manager-managed promo codes consumed at checkout."""
import uuid
from datetime import datetime, timezone
from tz import now_ist
from typing import List

from fastapi import APIRouter, HTTPException, Depends

from db import get_db
from auth import require_role, get_current_user
from tenants import tenant_filter
from models import (
    Coupon, CouponCreate, CouponUpdate,
    CouponApplyRequest, CouponApplyResponse,
)

router = APIRouter()


def _now() -> str:
    return now_ist().isoformat()


def _normalize(code: str) -> str:
    return (code or "").strip().upper()


@router.get("/coupons", response_model=List[Coupon])
async def list_coupons(user: dict = Depends(require_role("Manager"))):
    db = get_db()
    docs = await db.coupons.find(tenant_filter(user), {"_id": 0}).sort("code", 1).to_list(500)
    return docs


def check_coupon_dates(valid_from, valid_to):
    """Dates are ISO strings (a bare date or a full timestamp); blank = open-ended."""
    def parse(v, label):
        if not v:
            return None
        try:
            return datetime.fromisoformat(str(v)[:10]).date()
        except ValueError:
            raise HTTPException(status_code=400, detail=f"{label} is not a valid date")
    start, end = parse(valid_from, "Start date"), parse(valid_to, "End date")
    if start and end and end < start:
        raise HTTPException(status_code=400, detail="End date cannot be before the start date")


@router.post("/coupons", response_model=Coupon)
async def create_coupon(payload: CouponCreate, user: dict = Depends(require_role("Manager"))):
    code = _normalize(payload.code)
    if not code:
        raise HTTPException(status_code=400, detail="Code is required")
    if payload.value <= 0:
        raise HTTPException(status_code=400, detail="Value must be positive")
    if payload.kind == "percent" and payload.value > 100:
        raise HTTPException(status_code=400, detail="Percent value cannot exceed 100")
    check_coupon_dates(payload.valid_from, payload.valid_to)
    db = get_db()
    if await db.coupons.find_one(tenant_filter(user, {"code": code})):
        raise HTTPException(status_code=409, detail="Coupon code already exists")
    doc = {
        "id": f"cp_{uuid.uuid4().hex[:8]}",
        "tenant_id": user["tenant_id"],
        "code": code,
        "kind": payload.kind,
        "value": float(payload.value),
        "valid_from": payload.valid_from,
        "valid_to": payload.valid_to,
        "max_uses": payload.max_uses,
        "used_count": 0,
        "min_subtotal": float(payload.min_subtotal or 0),
        "active": bool(payload.active),
        "created_at": _now(),
    }
    await db.coupons.insert_one(doc)
    return doc


@router.patch("/coupons/{coupon_id}", response_model=Coupon)
async def update_coupon(coupon_id: str, payload: CouponUpdate, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    existing = await db.coupons.find_one(tenant_filter(user, {"id": coupon_id}), {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Coupon not found")
    updates = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    # An explicit null clears an optional limit (the edit form does this when
    # a date / max-uses box is emptied); exclude_none above would drop it.
    for field in ("valid_from", "valid_to", "max_uses"):
        if field in payload.model_fields_set and getattr(payload, field) is None:
            updates[field] = None
    kind = updates.get("kind", existing.get("kind"))
    value = updates.get("value", existing.get("value", 0))
    if "value" in updates and value <= 0:
        raise HTTPException(status_code=400, detail="Value must be positive")
    if kind == "percent" and value is not None and value > 100:
        raise HTTPException(status_code=400, detail="Percent value cannot exceed 100")
    if "valid_from" in updates or "valid_to" in updates:
        check_coupon_dates(updates.get("valid_from", existing.get("valid_from")), updates.get("valid_to", existing.get("valid_to")))
    if updates:
        await db.coupons.update_one(tenant_filter(user, {"id": coupon_id}), {"$set": updates})
    fresh = await db.coupons.find_one(tenant_filter(user, {"id": coupon_id}), {"_id": 0})
    return fresh


@router.delete("/coupons/{coupon_id}")
async def delete_coupon(coupon_id: str, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    res = await db.coupons.delete_one(tenant_filter(user, {"id": coupon_id}))
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Coupon not found")
    return {"ok": True}


@router.post("/coupons/apply", response_model=CouponApplyResponse)
async def apply_coupon(payload: CouponApplyRequest, user: dict = Depends(get_current_user)):
    """Validate a coupon for a given subtotal and return the resulting discount.
    Does NOT increment the use counter — that happens on order creation
    (so abandoned carts don't burn through a max_uses limit)."""
    db = get_db()
    code = _normalize(payload.code)
    doc = await db.coupons.find_one(tenant_filter(user, {"code": code}), {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Invalid coupon code")
    if not doc.get("active", True):
        raise HTTPException(status_code=400, detail="Coupon is inactive")
    now = _now()
    if doc.get("valid_from") and now < doc["valid_from"]:
        raise HTTPException(status_code=400, detail="Coupon is not yet active")
    if doc.get("valid_to") and now > doc["valid_to"]:
        raise HTTPException(status_code=400, detail="Coupon has expired")
    if doc.get("max_uses") is not None and int(doc.get("used_count", 0)) >= int(doc["max_uses"]):
        raise HTTPException(status_code=400, detail="Coupon usage limit reached")
    if payload.subtotal < float(doc.get("min_subtotal") or 0):
        raise HTTPException(status_code=400, detail=f"Minimum subtotal of {doc['min_subtotal']} required")
    if doc["kind"] == "percent":
        discount = round(payload.subtotal * (float(doc["value"]) / 100.0), 2)
    else:
        discount = round(min(float(doc["value"]), payload.subtotal), 2)
    return {
        "code": code,
        "kind": doc["kind"],
        "value": float(doc["value"]),
        "discount": discount,
        "new_total": round(payload.subtotal - discount, 2),
    }
