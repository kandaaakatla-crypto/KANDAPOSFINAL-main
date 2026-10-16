"""Staff (employee) CRUD — Manager-only.

Lets a store manager add, edit, deactivate, and PIN-rotate their own
employees without DB access. Built on top of the existing `users`
collection (used by PIN login), extended with `phone`, `hourly_rate`,
and `active`.
"""
import uuid
from datetime import datetime, timezone
from tz import now_ist
from typing import List

from fastapi import APIRouter, HTTPException, Depends

from db import get_db
from auth import require_role, hash_pin, verify_pin, user_cache_key
from cache import cache_delete
from tenants import tenant_filter
from models import StaffPublic, StaffCreate, StaffUpdate

router = APIRouter()

_VALID_PIN = lambda p: isinstance(p, str) and p.isdigit() and len(p) == 4


def can_see_pay(user: dict) -> bool:
    """Dashboard users only see salaries with the Payroll permission, the same
    switch that gates /api/payroll. PIN-login store managers keep access."""
    if user.get("dash"):
        return bool((user.get("permissions") or {}).get("payroll"))
    return True


def _to_public(doc: dict, show_pay: bool = True) -> dict:
    return {
        "id": doc["id"],
        "name": doc["name"],
        "role": doc["role"],
        "initials": doc.get("initials") or "".join(p[:1] for p in doc["name"].split())[:2].upper(),
        "phone": doc.get("phone", "") or "",
        "pay_type": doc.get("pay_type") or "monthly",
        "monthly_pay": float(doc.get("monthly_pay", 0) or 0) if show_pay else None,
        "hourly_rate": float(doc.get("hourly_rate", 0) or 0) if show_pay else None,
        "pay_visible": show_pay,
        "active": bool(doc.get("active", True)),
    }


@router.get("/staff", response_model=List[StaffPublic])
async def list_staff(user: dict = Depends(require_role("Manager"))):
    db = get_db()
    docs = await db.users.find(tenant_filter(user), {"_id": 0, "pin_hash": 0}).to_list(500)
    show_pay = can_see_pay(user)
    return [_to_public(d, show_pay) for d in docs]


@router.post("/staff", response_model=StaffPublic)
async def create_staff(payload: StaffCreate, user: dict = Depends(require_role("Manager"))):
    if not _VALID_PIN(payload.pin):
        raise HTTPException(status_code=400, detail="PIN must be exactly 4 digits")
    db = get_db()
    # PIN uniqueness within the tenant — required because login is PIN-only.
    existing = await db.users.find(tenant_filter(user), {"_id": 0, "pin_hash": 1, "id": 1}).to_list(500)
    for u in existing:
        if verify_pin(payload.pin, u["pin_hash"]):
            raise HTTPException(status_code=409, detail="PIN is already in use by another employee")
    initials = "".join(p[:1] for p in payload.name.split())[:2].upper() or "??"
    doc = {
        "id": f"u_{uuid.uuid4().hex[:8]}",
        "tenant_id": user["tenant_id"],
        "name": payload.name.strip(),
        "role": payload.role,
        "initials": initials,
        "pin_hash": hash_pin(payload.pin),
        "phone": (payload.phone or "").strip(),
        "pay_type": payload.pay_type or "monthly",
        "monthly_pay": float(payload.monthly_pay or 0),
        "hourly_rate": float(payload.hourly_rate or 0),
        "active": bool(payload.active),
        "created_at": now_ist().isoformat(),
    }
    if not can_see_pay(user):
        doc["monthly_pay"] = 0.0
        doc["hourly_rate"] = 0.0
    await db.users.insert_one(doc)
    return _to_public(doc, can_see_pay(user))


@router.put("/staff/{user_id}", response_model=StaffPublic)
async def update_staff(user_id: str, payload: StaffUpdate, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    existing = await db.users.find_one(tenant_filter(user, {"id": user_id}), {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Employee not found")
    updates: dict = {}
    if not can_see_pay(user) and any(v is not None for v in (payload.pay_type, payload.monthly_pay, payload.hourly_rate)):
        raise HTTPException(status_code=403, detail="Your owner hasn't given you access to Payroll & labour cost")
    if payload.name is not None:
        updates["name"] = payload.name.strip()
        updates["initials"] = "".join(p[:1] for p in payload.name.split())[:2].upper() or "??"
    if payload.role is not None:
        updates["role"] = payload.role
    if payload.phone is not None:
        updates["phone"] = payload.phone.strip()
    if payload.pay_type is not None:
        updates["pay_type"] = payload.pay_type
    if payload.monthly_pay is not None:
        updates["monthly_pay"] = float(payload.monthly_pay)
    if payload.hourly_rate is not None:
        updates["hourly_rate"] = float(payload.hourly_rate)
    if payload.active is not None:
        updates["active"] = bool(payload.active)
    if payload.pin is not None:
        if not _VALID_PIN(payload.pin):
            raise HTTPException(status_code=400, detail="PIN must be exactly 4 digits")
        others = await db.users.find(
            tenant_filter(user, {"id": {"$ne": user_id}}),
            {"_id": 0, "pin_hash": 1},
        ).to_list(500)
        for o in others:
            if verify_pin(payload.pin, o["pin_hash"]):
                raise HTTPException(status_code=409, detail="PIN is already in use")
        updates["pin_hash"] = hash_pin(payload.pin)
    if updates:
        await db.users.update_one(tenant_filter(user, {"id": user_id}), {"$set": updates})
        await cache_delete(user_cache_key(user["tenant_id"], user_id))
    fresh = await db.users.find_one(tenant_filter(user, {"id": user_id}), {"_id": 0, "pin_hash": 0})
    return _to_public(fresh, can_see_pay(user))


@router.delete("/staff/{user_id}")
async def deactivate_staff(user_id: str, user: dict = Depends(require_role("Manager"))):
    """Soft-delete — flips `active` to False so historic timesheets stay intact."""
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="You cannot deactivate yourself")
    db = get_db()
    res = await db.users.update_one(
        tenant_filter(user, {"id": user_id}),
        {"$set": {"active": False}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Employee not found")
    await cache_delete(user_cache_key(user["tenant_id"], user_id))
    return {"ok": True, "id": user_id}
