"""Wastage / spoilage log — decrements inventory and records why."""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends, Query

from db import get_db
from auth import get_current_user
from tenants import tenant_filter
from models import WasteEntry, WasteCreate

router = APIRouter()


@router.get("/waste", response_model=List[WasteEntry])
async def list_waste(
    user: dict = Depends(get_current_user),
    since: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=2000),
):
    db = get_db()
    flt = tenant_filter(user)
    if since:
        flt["at"] = {"$gte": since}
    docs = await db.waste_entries.find(flt, {"_id": 0}).sort("at", -1).limit(limit).to_list(limit)
    return docs


@router.post("/waste", response_model=WasteEntry)
async def log_waste(payload: WasteCreate, user: dict = Depends(get_current_user)):
    if payload.qty <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be positive")
    if not (payload.reason or "").strip():
        raise HTTPException(status_code=400, detail="Reason is required")
    db = get_db()
    item = await db.inventory.find_one(tenant_filter(user, {"id": payload.inventory_id}), {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    doc = {
        "id": f"w_{uuid.uuid4().hex[:10]}",
        "tenant_id": user["tenant_id"],
        "inventory_id": payload.inventory_id,
        "inventory_name": item["name"],
        "qty": float(payload.qty),
        "unit": item.get("unit", ""),
        "reason": payload.reason.strip(),
        "by_user_id": user["id"],
        "by_user_name": user["name"],
        "at": datetime.now(timezone.utc).isoformat(),
    }
    await db.waste_entries.insert_one(doc)
    await db.inventory.update_one(
        tenant_filter(user, {"id": payload.inventory_id}),
        {"$inc": {"stock": -float(payload.qty)}},
    )
    return doc
