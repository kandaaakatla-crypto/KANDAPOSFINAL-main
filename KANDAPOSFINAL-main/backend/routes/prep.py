"""Prep list — derive what to prep next from current stock vs upcoming demand.

Demand is approximated from the last 7 days' average daily usage of each
inventory item (derived from the recipes ↔ menu_items ↔ orders chain).
Anything where `on_hand < demand_horizon` is reported as a prep task.
"""
from datetime import datetime, timezone, timedelta
from typing import List

from fastapi import APIRouter, Depends, Query

from db import get_db
from auth import get_current_user
from tenants import tenant_filter
from models import PrepListResponse, PrepListItem

router = APIRouter()


def _now() -> datetime:
    return datetime.now(timezone.utc)


@router.get("/prep-list", response_model=PrepListResponse)
async def prep_list(
    user: dict = Depends(get_current_user),
    horizon_hours: int = Query(24, ge=1, le=168),
):
    db = get_db()
    now = _now()
    window_start = now - timedelta(days=7)

    inventory = await db.inventory.find(tenant_filter(user), {"_id": 0}).to_list(2000)
    inv_by_id = {i["id"]: i for i in inventory}

    recipes = await db.recipes.find(tenant_filter(user), {"_id": 0}).to_list(5000)
    # Map menu_item_id -> {size: [{inventory_id, qty}, ...]}
    recipes_by_item: dict[str, dict] = {}
    for r in recipes:
        recipes_by_item.setdefault(r["menu_item_id"], {})[r.get("size")] = r.get("ingredients", [])

    # Map menu name -> menu_item_id (orders carry name + size, not id).
    items = await db.menu_items.find(tenant_filter(user), {"_id": 0}).to_list(2000)
    name_to_item = {}
    for m in items:
        # Build name variants — `Margherita`, `Margherita 12"`, etc. Plain name first.
        name_to_item[m["name"].lower()] = m["id"]

    # Tally usage across last 7 days.
    orders = await db.orders.find(
        tenant_filter(user, {"placedAt": {"$gte": window_start.isoformat()}}),
        {"_id": 0, "items": 1},
    ).to_list(5000)

    usage: dict[str, float] = {}
    for o in orders:
        for it in o.get("items", []):
            mname = (it.get("name") or "").lower()
            # Strip a trailing pizza-size token (e.g. ' 12"') for the lookup.
            base = mname.split(' ')[0] if ' ' in mname else mname
            mid = name_to_item.get(mname) or name_to_item.get(base)
            if not mid or mid not in recipes_by_item:
                continue
            sized = recipes_by_item[mid]
            ingredients = sized.get(it.get("size")) or sized.get(None) or []
            qty = float(it.get("qty") or 0)
            for ing in ingredients:
                usage[ing["inventory_id"]] = usage.get(ing["inventory_id"], 0) + float(ing.get("qty", 0)) * qty

    items_out: list[dict] = []
    horizon_fraction = horizon_hours / (7 * 24)
    for inv_id, total_used in usage.items():
        inv = inv_by_id.get(inv_id)
        if not inv:
            continue
        expected = total_used * horizon_fraction
        on_hand = float(inv.get("stock", 0))
        if expected > on_hand:
            items_out.append({
                "inventory_id": inv_id,
                "name": inv["name"],
                "unit": inv.get("unit", ""),
                "on_hand": round(on_hand, 2),
                "needed": round(expected, 2),
                "shortfall": round(expected - on_hand, 2),
            })
    items_out.sort(key=lambda x: x["shortfall"], reverse=True)

    return {
        "generated_at": now.isoformat(),
        "horizon_hours": horizon_hours,
        "items": items_out,
    }
