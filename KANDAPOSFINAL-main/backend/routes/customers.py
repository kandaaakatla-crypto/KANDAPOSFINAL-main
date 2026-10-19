"""Customer CRUD + phone search.

Soft-delete pattern (added 2026-02-20 after data-loss incident):
- `DELETE /api/customers/{id}` flags the doc with `deleted_at` instead of
  hard-removing. The list, search and order-create flows all skip soft-deleted
  rows so the UX is identical to a real delete.
- Managers can browse and undo via `GET /api/customers/trash` and
  `POST /api/customers/{id}/restore`.
- Hard purge of rows soft-deleted >30 days ago is intentionally **not**
  automated — that's a deliberate human decision that should leave an
  audit-log entry.
"""
import uuid
from datetime import datetime, timezone
from tz import now_ist
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends, Query

from db import get_db
from auth import get_current_user, require_role
from tenants import tenant_filter, get_tenant
from models import Customer, CustomerCreate, CustomerUpdate
from . import loyalty as loyalty_mod
from ._shared import PROJECTION, clean

router = APIRouter()


def _active_filter(user: dict, extra: dict | None = None) -> dict:
    f = tenant_filter(user, extra or {})
    # only return rows where deleted_at is either missing or null
    f["$or"] = [{"deleted_at": {"$exists": False}}, {"deleted_at": None}]
    return f


def _phone_key(phone: str) -> str:
    """Digits-only form used to spot the same number typed two ways."""
    return "".join(ch for ch in (phone or "") if ch.isdigit())


async def _phone_taken(db, user: dict, phone: str, exclude_id: str | None = None) -> bool:
    key = _phone_key(phone)
    async for c in db.customers.find(_active_filter(user), {"_id": 0, "id": 1, "phone": 1}):
        if c["id"] != exclude_id and _phone_key(c.get("phone")) == key:
            return True
    return False


@router.get("/customers", response_model=List[Customer])
async def list_customers(since: Optional[str] = Query(None), user: dict = Depends(get_current_user)):
    db = get_db()
    # A delta-sync pull includes tombstones (deleted_at set) so an offline
    # client can prune ones it deleted since its last sync; the normal
    # (no `since`) call keeps hiding them, same as before.
    q = tenant_filter(user, {"updated_at": {"$gt": since}}) if since else _active_filter(user)
    docs = await db.customers.find(q, PROJECTION).to_list(2000)
    return docs


@router.get("/customers/trash")
async def list_deleted_customers(user: dict = Depends(require_role("Manager"))):
    """Manager-only — soft-deleted customers, newest first."""
    db = get_db()
    q = tenant_filter(user, {"deleted_at": {"$ne": None}})
    docs = await db.customers.find(q, PROJECTION).sort("deleted_at", -1).to_list(500)
    return docs


@router.get("/customers/search")
async def search_customer(phone: str, user: dict = Depends(get_current_user)):
    db = get_db()
    needle = phone.replace(" ", "")
    if len(needle) < 5:
        raise HTTPException(status_code=400, detail="Provide at least 5 digits")
    doc = await db.customers.find_one(_active_filter(user, {"phone": needle}), PROJECTION)
    if not doc:
        docs = await db.customers.find(_active_filter(user), PROJECTION).to_list(2000)
        for c in docs:
            if needle in (c.get("phone") or "").replace(" ", ""):
                doc = c
                break
    return doc


@router.post("/customers", response_model=Customer)
async def create_customer(payload: CustomerCreate, user: dict = Depends(get_current_user)):
    db = get_db()
    if await _phone_taken(db, user, payload.phone):
        raise HTTPException(status_code=409, detail="A customer with this phone number already exists")
    doc = {
        "id": f"cu_{uuid.uuid4().hex[:8]}",
        "tenant_id": user["tenant_id"],
        "name": payload.name,
        "phone": payload.phone,
        "address": payload.address or "",
        "postcode": payload.postcode or "",
        "notes": payload.notes or "",
        "orders": 0,
        "deleted_at": None,
        "loyalty_points": 0,
        "birthday": (payload.birthday or "").strip() or None,
        "updated_at": now_ist().isoformat(),
    }
    tenant = await get_tenant(user, db)
    loyalty_on = ((tenant or {}).get("features") or {}).get("loyalty", True)
    if loyalty_on:
        cfg = await loyalty_mod._get_config(db, user["tenant_id"])
        bonus = int(cfg.get("welcome_bonus_points") or 0)
        if bonus > 0:
            doc["loyalty_points"] = bonus
    await db.customers.insert_one(doc)
    if doc["loyalty_points"] > 0:
        await db.loyalty_txns.insert_one({
            "id": f"lt_{uuid.uuid4().hex[:10]}",
            "tenant_id": user["tenant_id"],
            "customer_id": doc["id"],
            "customer_name": doc["name"],
            "kind": "bonus",
            "points": doc["loyalty_points"],
            "order_id": None,
            "note": "Welcome bonus for new customer",
            "by_user_id": user["id"],
            "by_user_name": user["name"],
            "at": now_ist().isoformat(),
        })
    return clean(doc)


@router.put("/customers/{customer_id}", response_model=Customer)
async def update_customer(customer_id: str, payload: CustomerUpdate, user: dict = Depends(get_current_user)):
    db = get_db()
    update = payload.model_dump(exclude_none=True)
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    if "phone" in update and await _phone_taken(db, user, update["phone"], exclude_id=customer_id):
        raise HTTPException(status_code=409, detail="A customer with this phone number already exists")
    update["updated_at"] = now_ist().isoformat()
    res = await db.customers.find_one_and_update(
        _active_filter(user, {"id": customer_id}), {"$set": update}, return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Customer not found")
    return clean(res)


@router.delete("/customers/{customer_id}")
async def delete_customer(customer_id: str, user: dict = Depends(get_current_user)):
    """Soft delete — the row is hidden from list/search/order flows but kept
    in DB. Use `POST /api/customers/{id}/restore` to bring it back."""
    db = get_db()
    now = now_ist().isoformat()
    res = await db.customers.find_one_and_update(
        _active_filter(user, {"id": customer_id}),
        {"$set": {"deleted_at": now, "deleted_by": user.get("id"), "updated_at": now}},
        return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Customer not found")
    return {"ok": True, "soft_deleted": True, "deleted_at": now}


@router.post("/customers/{customer_id}/restore", response_model=Customer)
async def restore_customer(customer_id: str, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    res = await db.customers.find_one_and_update(
        tenant_filter(user, {"id": customer_id, "deleted_at": {"$ne": None}}),
        {"$set": {"deleted_at": None, "deleted_by": None, "updated_at": now_ist().isoformat()}},
        return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Deleted customer not found")
    return clean(res)
