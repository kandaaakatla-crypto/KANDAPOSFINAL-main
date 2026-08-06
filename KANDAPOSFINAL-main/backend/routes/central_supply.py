"""Brand central supply — a warehouse catalog the brand owner stocks and
pushes out to member stores. Each brand store is its own tenant with its
own independent `inventory` collection (see routes/inventory.py), so a
push here finds-or-creates a matching item (by name) in every target
tenant's own inventory, the same pattern `brands.py`'s menu-template push
uses for categories/items — rather than trying to share one inventory
collection across tenants.

Reuses `_brand_owner` from brands.py as the auth gate: every route here is
cross-tenant (the brand owner writes into stores they don't hold a normal
session for), so it re-checks owner role + exact brand_id match, same as
every other brand-scoped route.
"""
import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from db import get_db
from tz import now_ist
from ws import schedule_broadcast
from routes.brands import _brand_owner
from routes._shared import PROJECTION, clean
from models import (
    CentralSupplyItem, CentralSupplyItemCreate, CentralSupplyItemUpdate,
    CentralSupplyRestock, SupplyPush, SupplyLogEntry,
)

router = APIRouter(prefix="/brand")


# ===================================================================
# Central catalog CRUD
# ===================================================================
@router.get("/{brand_id}/supply/items", response_model=List[CentralSupplyItem])
async def list_supply_items(brand_id: str, u: dict = Depends(_brand_owner)):
    db = get_db()
    return await db.central_supply_items.find({"brand_id": brand_id}, PROJECTION).sort("name", 1).to_list(500)


@router.post("/{brand_id}/supply/items", response_model=CentralSupplyItem)
async def create_supply_item(brand_id: str, payload: CentralSupplyItemCreate, u: dict = Depends(_brand_owner)):
    db = get_db()
    doc = {"id": f"csi_{uuid.uuid4().hex[:8]}", "brand_id": brand_id, **payload.model_dump()}
    await db.central_supply_items.insert_one(doc)
    return clean(doc)


@router.patch("/{brand_id}/supply/items/{item_id}", response_model=CentralSupplyItem)
async def update_supply_item(brand_id: str, item_id: str, payload: CentralSupplyItemUpdate, u: dict = Depends(_brand_owner)):
    db = get_db()
    update = payload.model_dump(exclude_none=True)
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    res = await db.central_supply_items.find_one_and_update(
        {"id": item_id, "brand_id": brand_id}, {"$set": update}, return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Central supply item not found")
    return clean(res)


@router.delete("/{brand_id}/supply/items/{item_id}")
async def delete_supply_item(brand_id: str, item_id: str, u: dict = Depends(_brand_owner)):
    db = get_db()
    res = await db.central_supply_items.delete_one({"id": item_id, "brand_id": brand_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Central supply item not found")
    return {"ok": True}


@router.patch("/{brand_id}/supply/items/{item_id}/restock", response_model=CentralSupplyItem)
async def restock_supply_item(brand_id: str, item_id: str, payload: CentralSupplyRestock, u: dict = Depends(_brand_owner)):
    db = get_db()
    item = await db.central_supply_items.find_one({"id": item_id, "brand_id": brand_id}, PROJECTION)
    if not item:
        raise HTTPException(status_code=404, detail="Central supply item not found")
    new_stock = max(0.0, round((item["stock"] + payload.delta) * 100) / 100)
    res = await db.central_supply_items.find_one_and_update(
        {"id": item_id, "brand_id": brand_id}, {"$set": {"stock": new_stock}}, return_document=True,
    )
    return clean(res)


# ===================================================================
# Push to stores — deduct central stock, find-or-create the matching item
# in each target tenant's own inventory (tagged with the central item's
# cost so store-side margin/reorder math stays accurate).
# ===================================================================
@router.post("/{brand_id}/supply/items/{item_id}/push")
async def push_supply(brand_id: str, item_id: str, payload: SupplyPush, u: dict = Depends(_brand_owner)):
    db = get_db()
    if payload.qty_per_store <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be positive")
    if not payload.tenant_ids:
        raise HTTPException(status_code=400, detail="Select at least one store")

    item = await db.central_supply_items.find_one({"id": item_id, "brand_id": brand_id}, PROJECTION)
    if not item:
        raise HTTPException(status_code=404, detail="Central supply item not found")

    targets = await db.tenants.find(
        {"id": {"$in": payload.tenant_ids}, "brand_id": brand_id}, {"_id": 0, "id": 1, "name": 1},
    ).to_list(200)
    if len(targets) != len(set(payload.tenant_ids)):
        raise HTTPException(status_code=400, detail="One or more selected stores aren't in this brand")

    total_needed = payload.qty_per_store * len(targets)
    if item["stock"] < total_needed:
        raise HTTPException(status_code=400, detail=f"Only {item['stock']} {item['unit']} in central stock — need {total_needed}")

    results = []
    for t in targets:
        existing = await db.inventory.find_one({"tenant_id": t["id"], "name": item["name"]}, PROJECTION)
        if existing:
            await db.inventory.update_one({"id": existing["id"], "tenant_id": t["id"]}, {"$inc": {"stock": payload.qty_per_store}})
            new_item_id = existing["id"]
        else:
            new_item_id = f"i_{uuid.uuid4().hex[:8]}"
            await db.inventory.insert_one({
                "id": new_item_id, "tenant_id": t["id"], "name": item["name"], "unit": item["unit"],
                "stock": payload.qty_per_store, "reorder": item.get("reorder", 0),
                "supplier": "", "cost_per_unit": item.get("cost_per_unit", 0.0),
                "expiry_date": None, "location_id": None,
            })
        schedule_broadcast("inventory.updated", {"item": {"id": new_item_id}, "low": False}, t["id"])

        log_doc = {
            "id": f"slog_{uuid.uuid4().hex[:10]}", "brand_id": brand_id, "central_item_id": item_id,
            "item_name": item["name"], "unit": item["unit"], "tenant_id": t["id"], "store_name": t["name"],
            "qty": payload.qty_per_store, "note": payload.note,
            "by_user_id": u.get("id"), "by_user_name": u.get("name"), "at": now_ist().isoformat(),
        }
        await db.supply_log.insert_one(log_doc)
        results.append({"tenant_id": t["id"], "store_name": t["name"], "qty": payload.qty_per_store})

    await db.central_supply_items.update_one({"id": item_id, "brand_id": brand_id}, {"$inc": {"stock": -total_needed}})
    return {"ok": True, "pushed_to": len(targets), "total_qty": total_needed, "results": results}


@router.get("/{brand_id}/supply/log", response_model=List[SupplyLogEntry])
async def supply_log(brand_id: str, u: dict = Depends(_brand_owner)):
    db = get_db()
    return await db.supply_log.find({"brand_id": brand_id}, PROJECTION).sort("at", -1).to_list(500)
