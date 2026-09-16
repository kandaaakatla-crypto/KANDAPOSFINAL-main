"""Shared live-data queries for a tenant's current state — today's sales,
top items, low/expiring stock, active orders, staff on duty. Used by the
Daily Digest (routes/digest.py) to build its summary; previously also used
by the (now removed) in-app AI assistant as callable "tools", which is why
these keep their `_tool_*` naming.
"""
from __future__ import annotations

from datetime import timedelta
from tz import now_ist


async def _tool_todays_sales(db, tenant_id: str) -> dict:
    start = now_ist().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    pipe = [
        {"$match": {"tenant_id": tenant_id, "placedAt": {"$gte": start}, "voided": {"$ne": True}}},
        {"$group": {"_id": None, "count": {"$sum": 1}, "revenue": {"$sum": "$total"}}},
    ]
    r = await db.orders.aggregate(pipe).to_list(1)
    if not r:
        return {"count": 0, "revenue": 0.0, "since": start}
    return {"count": r[0]["count"], "revenue": round(r[0]["revenue"], 2), "since": start}


async def _tool_top_items(db, tenant_id: str, days: int = 7, limit: int = 5) -> list:
    since = (now_ist() - timedelta(days=days)).isoformat()
    pipe = [
        {"$match": {"tenant_id": tenant_id, "placedAt": {"$gte": since}, "voided": {"$ne": True}}},
        {"$unwind": "$items"},
        {"$group": {"_id": "$items.name", "qty": {"$sum": "$items.qty"},
                    "revenue": {"$sum": {"$multiply": ["$items.qty", "$items.price"]}}}},
        {"$sort": {"qty": -1}},
        {"$limit": limit},
    ]
    rows = await db.orders.aggregate(pipe).to_list(limit)
    return [{"name": r["_id"], "qty": r["qty"], "revenue": round(r["revenue"], 2)} for r in rows]


async def _tool_low_stock(db, tenant_id: str) -> list:
    rows = await db.inventory.find(
        {"tenant_id": tenant_id, "$expr": {"$lte": ["$stock", "$reorder"]}},
        {"_id": 0, "name": 1, "stock": 1, "unit": 1, "reorder": 1},
    ).to_list(50)
    return rows


async def _tool_expiring_stock(db, tenant_id: str, days: int = 7) -> list:
    """Inventory items already expired or expiring within `days` days,
    soonest first. Items with no expiry_date set are excluded."""
    cutoff = (now_ist() + timedelta(days=days)).strftime("%Y-%m-%d")
    rows = await db.inventory.find(
        {"tenant_id": tenant_id, "expiry_date": {"$ne": None, "$lte": cutoff}},
        {"_id": 0, "name": 1, "stock": 1, "unit": 1, "expiry_date": 1},
    ).sort("expiry_date", 1).to_list(50)
    today = now_ist().strftime("%Y-%m-%d")
    for r in rows:
        r["expired"] = r["expiry_date"] < today
    return rows


async def _tool_active_orders(db, tenant_id: str) -> list:
    rows = await db.orders.find(
        {"tenant_id": tenant_id, "status": {"$in": ["new", "preparing", "ready"]}, "voided": {"$ne": True}},
        {"_id": 0, "number": 1, "type": 1, "status": 1, "total": 1, "placedAt": 1,
         "customer.name": 1, "table": 1},
    ).sort("placedAt", 1).to_list(30)
    return rows


async def _tool_staff_on_duty(db, tenant_id: str) -> list:
    # People clocked in with no matching clock-out yet.
    rows = await db.time_punches.aggregate([
        {"$match": {"tenant_id": tenant_id}},
        {"$sort": {"at": -1}},
        {"$group": {"_id": "$user_id", "last": {"$first": "$$ROOT"}}},
        {"$match": {"last.type": "in"}},
        {"$replaceRoot": {"newRoot": "$last"}},
    ]).to_list(50)
    return [{"user_id": r["user_id"], "user_name": r.get("user_name"), "since": r["at"]} for r in rows]
