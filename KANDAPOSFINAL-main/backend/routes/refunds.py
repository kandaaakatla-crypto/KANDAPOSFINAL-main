"""Refund / Void workflow with audit trail.

`/api/orders/{id}/refund` — partial or full refund. Decrements payment
totals but keeps the order row in place for analytics. Writes a
`refund_logs` audit row.

`/api/orders/{id}/void` — cancels an order pre-fulfilment (status='new'
or 'cooking'). Reverses inventory recipes so stock comes back. Also
audit-logged.

`/api/refunds/log` — Manager view of all refund + void audit entries.
"""
import uuid
from datetime import datetime, timezone
from tz import now_ist
from typing import List

from fastapi import APIRouter, HTTPException, Depends, Query

from db import get_db
from auth import require_role
from tenants import tenant_filter
from models import RefundRequest, VoidRequest, RefundLog
from ws import schedule_broadcast

router = APIRouter()


def _now() -> str:
    return now_ist().isoformat()


async def _log(db, user: dict, order: dict, kind: str, amount: float, reason: str, notes: str | None) -> dict:
    doc = {
        "id": f"rf_{uuid.uuid4().hex[:10]}",
        "tenant_id": user["tenant_id"],
        "order_id": order["id"],
        "order_number": order["number"],
        "kind": kind,
        "amount": float(amount),
        "reason": reason,
        "notes": notes,
        "by_user_id": user["id"],
        "by_user_name": user["name"],
        "at": _now(),
    }
    await db.refund_logs.insert_one(doc)
    # `insert_one` mutates the input dict to add `_id` (ObjectId) which is not
    # JSON serialisable — strip before returning.
    doc.pop("_id", None)
    return doc


@router.post("/orders/{order_id}/refund")
async def refund_order(order_id: str, payload: RefundRequest,
                       user: dict = Depends(require_role("Manager"))):
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Refund amount must be positive")
    if not (payload.reason or "").strip():
        raise HTTPException(status_code=400, detail="Reason is required")
    db = get_db()
    order = await db.orders.find_one(tenant_filter(user, {"id": order_id}), {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("voided"):
        raise HTTPException(status_code=400, detail="Cannot refund a voided order")
    already = float(order.get("refunded_amount") or 0)
    max_refundable = round(float(order["total"]) - already, 2)
    if payload.amount > max_refundable + 0.005:
        raise HTTPException(status_code=400, detail=f"Cannot refund more than ₹{max_refundable:.2f}")
    new_total = round(already + payload.amount, 2)
    await db.orders.update_one(
        tenant_filter(user, {"id": order_id}),
        {"$set": {
            "refunded_amount": new_total,
            "refunded_at": _now(),
            "refunded_by": user["name"],
        }},
    )
    log = await _log(db, user, order, "refund", payload.amount, payload.reason.strip(), payload.notes)
    return {"ok": True, "refunded_total": new_total, "log": log}


@router.post("/orders/{order_id}/void")
async def void_order(order_id: str, payload: VoidRequest,
                     user: dict = Depends(require_role("Manager"))):
    if not (payload.reason or "").strip():
        raise HTTPException(status_code=400, detail="Reason is required")
    db = get_db()
    order = await db.orders.find_one(tenant_filter(user, {"id": order_id}), {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("voided"):
        raise HTTPException(status_code=400, detail="Order already voided")
    if order.get("status") in ("served", "completed"):
        raise HTTPException(status_code=400, detail="Cannot void a served/completed order — use refund instead")

    # Restore inventory: re-add the recipes that orders.py debited at create.
    try:
        recipes_by_item = {}
        for r in await db.recipes.find(tenant_filter(user), {"_id": 0}).to_list(5000):
            recipes_by_item.setdefault(r["menu_item_id"], {})[r.get("size")] = r.get("ingredients", [])
        items_by_name = {m["name"]: m["id"] for m in await db.menu_items.find(tenant_filter(user), {"_id": 0}).to_list(2000)}
        for it in order.get("items", []):
            mid = items_by_name.get(it.get("name") or "")
            if not mid or mid not in recipes_by_item:
                continue
            sized = recipes_by_item[mid]
            ingredients = sized.get(it.get("size")) or sized.get(None) or []
            qty = float(it.get("qty") or 0)
            for ing in ingredients:
                await db.inventory.update_one(
                    tenant_filter(user, {"id": ing["inventory_id"]}),
                    {"$inc": {"stock": float(ing.get("qty", 0)) * qty}},
                )
    except Exception:
        # Best-effort — voiding still records even if inventory restore hiccups.
        pass

    await db.orders.update_one(
        tenant_filter(user, {"id": order_id}),
        {"$set": {
            "voided": True,
            "voided_at": _now(),
            "voided_by": user["name"],
            "status": "completed",  # remove from active boards
        }},
    )
    log = await _log(db, user, order, "void", float(order["total"]), payload.reason.strip(), payload.notes)
    schedule_broadcast("orders.changed", {"orderId": order_id, "voided": True}, user["tenant_id"])
    return {"ok": True, "log": log}


@router.get("/refunds/log", response_model=List[RefundLog])
async def list_logs(user: dict = Depends(require_role("Manager")),
                    limit: int = Query(100, ge=1, le=500)):
    db = get_db()
    docs = await db.refund_logs.find(tenant_filter(user), {"_id": 0}).sort("at", -1).limit(limit).to_list(limit)
    return docs
