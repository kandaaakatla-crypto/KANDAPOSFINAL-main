"""Locations (multi-store) — a tenant can run several physical stores.

This module manages a tenant's locations. The legacy single-location
behavior keeps working unchanged: when no location is provided on an
order/punch/shift, queries don't filter by location. The "default"
location is auto-seeded on first read so every tenant starts with one.
"""
import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, HTTPException, Depends

from db import get_db
from auth import get_current_user, require_role
from tenants import tenant_filter, get_tenant
from models import Location, LocationCreate, LocationUpdate

router = APIRouter()


async def _ensure_default(db, user: dict) -> None:
    """Auto-seed a default location based on the tenant's `store` block."""
    if await db.locations.count_documents(tenant_filter(user)) > 0:
        return
    tenant = await get_tenant(user, db)
    store = tenant.get("store") or {}
    await db.locations.insert_one({
        "id": "loc_default",
        "tenant_id": user["tenant_id"],
        "name": store.get("name") or tenant.get("name") or "Main store",
        "address": store.get("address", ""),
        "phone": store.get("phone", ""),
        "store_number": "0001",
        "active": True,
        "is_default": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


@router.get("/locations", response_model=List[Location])
async def list_locations(user: dict = Depends(get_current_user)):
    db = get_db()
    await _ensure_default(db, user)
    docs = await db.locations.find(tenant_filter(user), {"_id": 0}).sort("name", 1).to_list(200)
    return docs


@router.post("/locations", response_model=Location)
async def create_location(payload: LocationCreate, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    await _ensure_default(db, user)

    # Pay-per-location gate: first location free, each additional needs a
    # paid slot in `tenant.paid_slots`.
    from routes.plans import _tenant_slots, LOCATION_PRICE_INR, CURRENCY
    slots = await _tenant_slots(db, user["tenant_id"])
    if slots["used"] >= slots["total_slots"]:
        raise HTTPException(
            status_code=402,
            detail={
                "message": "Adding another location requires a one-time ₹1999 payment.",
                "code": "payment_required",
                "price": LOCATION_PRICE_INR,
                "currency": CURRENCY,
                "used": slots["used"],
                "total_slots": slots["total_slots"],
            },
        )

    if payload.is_default:
        await db.locations.update_many(tenant_filter(user), {"$set": {"is_default": False}})
    doc = {
        "id": f"loc_{uuid.uuid4().hex[:8]}",
        "tenant_id": user["tenant_id"],
        "name": payload.name.strip(),
        "address": (payload.address or "").strip(),
        "phone": (payload.phone or "").strip(),
        "store_number": (payload.store_number or "").strip(),
        "active": bool(payload.active),
        "is_default": bool(payload.is_default),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.locations.insert_one(doc)
    return doc


@router.patch("/locations/{loc_id}", response_model=Location)
async def update_location(loc_id: str, payload: LocationUpdate, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    existing = await db.locations.find_one(tenant_filter(user, {"id": loc_id}), {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Location not found")
    updates = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if updates.get("is_default"):
        await db.locations.update_many(
            tenant_filter(user, {"id": {"$ne": loc_id}}),
            {"$set": {"is_default": False}},
        )
    if updates:
        await db.locations.update_one(tenant_filter(user, {"id": loc_id}), {"$set": updates})
    fresh = await db.locations.find_one(tenant_filter(user, {"id": loc_id}), {"_id": 0})
    return fresh


@router.delete("/locations/{loc_id}")
async def delete_location(loc_id: str, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    if (await db.locations.count_documents(tenant_filter(user))) <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete your only location")
    target = await db.locations.find_one(tenant_filter(user, {"id": loc_id}), {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Location not found")
    await db.locations.delete_one(tenant_filter(user, {"id": loc_id}))
    if target.get("is_default"):
        other = await db.locations.find_one(tenant_filter(user), {"_id": 0})
        if other:
            await db.locations.update_one(
                tenant_filter(user, {"id": other["id"]}),
                {"$set": {"is_default": True}},
            )
    return {"ok": True}
