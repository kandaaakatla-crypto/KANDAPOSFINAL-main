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
from typing import List

from fastapi import APIRouter, HTTPException, Depends

from db import get_db
from auth import get_current_user, require_role
from tenants import tenant_filter
from models import Customer, CustomerCreate, CustomerUpdate
from ._shared import PROJECTION, clean

router = APIRouter()


def _active_filter(user: dict, extra: dict | None = None) -> dict:
    f = tenant_filter(user, extra or {})
    # only return rows where deleted_at is either missing or null
    f["$or"] = [{"deleted_at": {"$exists": False}}, {"deleted_at": None}]
    return f


@router.get("/customers", response_model=List[Customer])
async def list_customers(user: dict = Depends(get_current_user)):
    db = get_db()
    docs = await db.customers.find(_active_filter(user), PROJECTION).to_list(2000)
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
    }
    await db.customers.insert_one(doc)
    return clean(doc)


@router.put("/customers/{customer_id}", response_model=Customer)
async def update_customer(customer_id: str, payload: CustomerUpdate, user: dict = Depends(get_current_user)):
    db = get_db()
    update = payload.model_dump(exclude_none=True)
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
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
        {"$set": {"deleted_at": now, "deleted_by": user.get("id")}},
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
        {"$set": {"deleted_at": None, "deleted_by": None}},
        return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Deleted customer not found")
    return clean(res)
