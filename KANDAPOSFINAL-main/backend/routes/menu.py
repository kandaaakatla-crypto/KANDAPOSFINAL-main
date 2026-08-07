"""Menu categories + items routes."""
import uuid
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends, Query

from db import get_db
from auth import get_current_user, require_role
from tenants import tenant_filter, get_tenant
from tax import suggest_tax_rate, is_price_banded
from tz import now_ist
from models import (
    Category, CategoryCreate, CategoryUpdate, CategoryReorder,
    MenuItem, MenuItemCreate, MenuItemUpdate, AvailabilityPayload,
    Recipe, RecipeUpsert,
)
from ._shared import PROJECTION, NOT_DELETED, clean, menu_doc_to_response

router = APIRouter()


# -------------------- Categories --------------------
@router.get("/menu/categories", response_model=List[Category])
async def list_categories(since: Optional[str] = Query(None), user: dict = Depends(get_current_user)):
    db = get_db()
    q = tenant_filter(user, {"updated_at": {"$gt": since}}) if since else tenant_filter(user, NOT_DELETED)
    docs = await db.categories.find(q, PROJECTION).sort("sort_order", 1).to_list(100)
    return docs


@router.post("/menu/categories", response_model=Category)
async def create_category(payload: CategoryCreate, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    tax_rate = payload.tax_rate
    if tax_rate is None:
        tenant = await get_tenant(user, db)
        business_type = tenant.get("business_type", "restaurant")
        # Price-banded categories (e.g. apparel) don't get a frozen category
        # rate — leave it unset so each item's own price re-derives the rate.
        if not is_price_banded(payload.name, business_type):
            tax_rate = suggest_tax_rate(payload.name, business_type)
    doc = {
        "id": f"cat_{uuid.uuid4().hex[:8]}",
        "tenant_id": user["tenant_id"],
        "name": payload.name.strip(),
        "color": payload.color,
        "sort_order": payload.sort_order,
        "station": payload.station,
        "tax_rate": tax_rate,
        "updated_at": now_ist().isoformat(),
        "deleted_at": None,
    }
    await db.categories.insert_one(doc)
    return clean(doc)


@router.put("/menu/categories/{cat_id}", response_model=Category)
async def update_category(cat_id: str, payload: CategoryUpdate, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    update = payload.model_dump(exclude_none=True)
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    update["updated_at"] = now_ist().isoformat()
    res = await db.categories.find_one_and_update(
        tenant_filter(user, {"id": cat_id}), {"$set": update}, return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Category not found")
    return clean(res)


@router.delete("/menu/categories/{cat_id}")
async def delete_category(cat_id: str, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    in_use = await db.menu_items.count_documents(tenant_filter(user, {"cat_id": cat_id}))
    if in_use:
        raise HTTPException(status_code=409, detail=f"{in_use} menu items still use this category. Move or delete them first.")
    res = await db.categories.update_one(
        tenant_filter(user, {"id": cat_id, **NOT_DELETED}),
        {"$set": {"deleted_at": now_ist().isoformat(), "updated_at": now_ist().isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"ok": True}


@router.patch("/menu/categories/reorder")
async def reorder_categories(payload: CategoryReorder, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    for i, cid in enumerate(payload.order):
        await db.categories.update_one(
            tenant_filter(user, {"id": cid}), {"$set": {"sort_order": i * 10, "updated_at": now_ist().isoformat()}},
        )
    return {"ok": True, "count": len(payload.order)}


# -------------------- Menu items --------------------
@router.get("/menu/items", response_model=List[MenuItem])
async def list_menu_items(since: Optional[str] = Query(None), user: dict = Depends(get_current_user)):
    db = get_db()
    q = tenant_filter(user, {"updated_at": {"$gt": since}}) if since else tenant_filter(user, NOT_DELETED)
    docs = await db.menu_items.find(q, PROJECTION).to_list(500)
    return [menu_doc_to_response(d) for d in docs]


@router.post("/menu/items", response_model=MenuItem)
async def create_menu_item(payload: MenuItemCreate, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    doc = {
        "id": f"m_{uuid.uuid4().hex[:8]}",
        "tenant_id": user["tenant_id"],
        "cat_id": payload.catId,
        "name": payload.name,
        "desc": payload.desc,
        "price": payload.price,
        "sizes": payload.sizes.model_dump() if payload.sizes else None,
        "available": payload.available,
        "is_pizza": payload.isPizza,
        "deal_groups": [g.model_dump() for g in payload.dealGroups] if payload.dealGroups else None,
        "image_url": payload.imageUrl,
        "barcode": payload.barcode,
        "variants": [v.model_dump() for v in payload.variants] if payload.variants else None,
        "tax_rate": payload.tax_rate,
        "updated_at": now_ist().isoformat(),
        "deleted_at": None,
    }
    await db.menu_items.insert_one(doc)
    return menu_doc_to_response(doc)


@router.put("/menu/items/{item_id}", response_model=MenuItem)
async def update_menu_item(item_id: str, payload: MenuItemUpdate, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    update = {}
    raw = payload.model_dump(exclude_none=True)
    mapping = {"catId": "cat_id", "isPizza": "is_pizza", "dealGroups": "deal_groups", "imageUrl": "image_url"}
    for k, v in raw.items():
        key = mapping.get(k, k)
        update[key] = v.model_dump() if hasattr(v, "model_dump") else v
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    update["updated_at"] = now_ist().isoformat()
    res = await db.menu_items.find_one_and_update(
        tenant_filter(user, {"id": item_id}), {"$set": update}, return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Menu item not found")
    return menu_doc_to_response(clean(res))


@router.patch("/menu/items/{item_id}/availability", response_model=MenuItem)
async def set_availability(item_id: str, payload: AvailabilityPayload, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    res = await db.menu_items.find_one_and_update(
        tenant_filter(user, {"id": item_id}),
        {"$set": {"available": payload.available, "updated_at": now_ist().isoformat()}},
        return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Menu item not found")
    return menu_doc_to_response(clean(res))


@router.delete("/menu/items/{item_id}")
async def delete_menu_item(item_id: str, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    res = await db.menu_items.update_one(
        tenant_filter(user, {"id": item_id, **NOT_DELETED}),
        {"$set": {"deleted_at": now_ist().isoformat(), "updated_at": now_ist().isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Menu item not found")
    # also drop any recipes pinned to this item
    await db.recipes.delete_many(tenant_filter(user, {"menu_item_id": item_id}))
    return {"ok": True}


# -------------------- Recipes --------------------
@router.get("/menu/items/{item_id}/recipes")
async def list_recipes(item_id: str, user: dict = Depends(get_current_user)):
    db = get_db()
    docs = await db.recipes.find(
        tenant_filter(user, {"menu_item_id": item_id}), PROJECTION,
    ).to_list(20)
    return docs


@router.put("/menu/items/{item_id}/recipes")
async def upsert_recipes(item_id: str, payload: RecipeUpsert, user: dict = Depends(require_role("Manager"))):
    """Replace the full recipe set for a menu item. Empty list clears recipes."""
    db = get_db()
    # Sanity: every menu item must exist for this tenant
    item = await db.menu_items.find_one(tenant_filter(user, {"id": item_id}), PROJECTION)
    if not item:
        raise HTTPException(status_code=404, detail="Menu item not found")
    await db.recipes.delete_many(tenant_filter(user, {"menu_item_id": item_id}))
    if not payload.recipes:
        return {"ok": True, "count": 0}
    docs = []
    for r in payload.recipes:
        docs.append({
            "tenant_id": user["tenant_id"],
            "menu_item_id": item_id,
            "size": r.size,
            "ingredients": [i.model_dump() for i in r.ingredients],
        })
    await db.recipes.insert_many(docs)
    return {"ok": True, "count": len(docs)}

