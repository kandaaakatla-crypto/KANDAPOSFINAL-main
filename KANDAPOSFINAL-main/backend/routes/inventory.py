"""Inventory routes — list + adjust + reorder."""
from typing import List

from fastapi import APIRouter, HTTPException, Depends

from db import get_db
from auth import get_current_user, require_role
from tenants import tenant_filter
from ws import schedule_broadcast
from models import InventoryItem, AdjustStockPayload
from ._shared import PROJECTION, clean

router = APIRouter()


@router.get("/inventory", response_model=List[InventoryItem])
async def list_inventory(user: dict = Depends(get_current_user)):
    db = get_db()
    docs = await db.inventory.find(tenant_filter(user), PROJECTION).to_list(500)
    return docs


@router.patch("/inventory/{item_id}/adjust", response_model=InventoryItem)
async def adjust_inventory(item_id: str, payload: AdjustStockPayload, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    item = await db.inventory.find_one(tenant_filter(user, {"id": item_id}), PROJECTION)
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    new_stock = max(0.0, round((item["stock"] + payload.delta) * 10) / 10)
    res = await db.inventory.find_one_and_update(
        tenant_filter(user, {"id": item_id}), {"$set": {"stock": new_stock}}, return_document=True,
    )
    cleaned = clean(res)
    schedule_broadcast(
        "inventory.updated",
        {"item": cleaned, "low": cleaned["stock"] <= cleaned["reorder"]},
        user["tenant_id"],
    )
    return cleaned


@router.post("/inventory/{item_id}/reorder", response_model=InventoryItem)
async def reorder_inventory(item_id: str, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    item = await db.inventory.find_one(tenant_filter(user, {"id": item_id}), PROJECTION)
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    new_stock = item["stock"] + item["reorder"] * 2
    res = await db.inventory.find_one_and_update(
        tenant_filter(user, {"id": item_id}), {"$set": {"stock": new_stock}}, return_document=True,
    )
    cleaned = clean(res)
    schedule_broadcast("inventory.updated", {"item": cleaned, "low": False}, user["tenant_id"])
    return cleaned
