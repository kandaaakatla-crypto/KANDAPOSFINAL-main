"""Order CRUD + status & driver mutations."""
import asyncio
import uuid
import logging
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, HTTPException, Depends

from db import get_db
from auth import get_current_user
from tenants import tenant_filter, get_tenant
from ws import schedule_broadcast
from kds import annotate_order_items_for_kds
from email_service import send_email, order_receipt_email
from models import Order, OrderCreate, OrderStatusPayload, AssignDriverPayload, OrderAppendPayload
from . import loyalty as loyalty_mod
from ._shared import PROJECTION, clean, next_order_number, table_doc_to_response

logger = logging.getLogger("kanda.orders")
router = APIRouter()


async def _apply_recipes(db, tenant_id: str, items: list[dict]):
    """Decrement inventory by recipe ingredient amounts when an order is placed.
    Tries (menu_item_id, item.size) first, falls back to (menu_item_id, None).
    Missing recipes are silently skipped — the menu item simply isn't wired."""
    menu = await db.menu_items.find({"tenant_id": tenant_id}, {"_id": 0, "id": 1, "name": 1}).to_list(2000)
    name_to_id: dict[str, str] = {m["name"]: m["id"] for m in menu}

    agg: dict[str, float] = {}
    for it in items:
        base_name = it.get("name", "")
        bare = base_name.split('"')[0].rsplit(" ", 1)[0] if '"' in base_name else base_name
        menu_id = name_to_id.get(base_name) or name_to_id.get(bare)
        if not menu_id:
            continue
        qty = it.get("qty", 1)
        size = it.get("size")
        recipe = await db.recipes.find_one(
            {"tenant_id": tenant_id, "menu_item_id": menu_id, "size": size},
            {"_id": 0},
        )
        if not recipe:
            recipe = await db.recipes.find_one(
                {"tenant_id": tenant_id, "menu_item_id": menu_id, "size": None},
                {"_id": 0},
            )
        if not recipe:
            continue
        for ing in recipe.get("ingredients", []):
            inv_id = ing.get("inventory_id")
            qty_per = ing.get("qty", 0) or 0
            if not inv_id or qty_per <= 0:
                continue
            agg[inv_id] = agg.get(inv_id, 0) + qty_per * qty

    if not agg:
        return
    for inv_id, total in agg.items():
        try:
            res = await db.inventory.find_one_and_update(
                {"tenant_id": tenant_id, "id": inv_id},
                {"$inc": {"stock": -total}},
                return_document=True,
            )
            if res:
                cleaned = {k: v for k, v in res.items() if k != "_id"}
                low = cleaned["stock"] <= cleaned["reorder"]
                schedule_broadcast("inventory.updated", {"item": cleaned, "low": low}, tenant_id)
                if cleaned["stock"] < 0:
                    logger.warning("Inventory %s went negative (%s) on order — investigate recipes",
                                   inv_id, cleaned["stock"])
        except Exception:
            logger.exception("Failed to decrement inventory %s by %s", inv_id, total)


@router.get("/orders", response_model=List[Order])
async def list_orders(user: dict = Depends(get_current_user)):
    db = get_db()
    docs = await db.orders.find(tenant_filter(user), PROJECTION).sort("placedAt", -1).to_list(1000)
    return docs


@router.post("/orders", response_model=Order)
async def create_order(payload: OrderCreate, user: dict = Depends(get_current_user)):
    db = get_db()
    number = await next_order_number(db, user["tenant_id"])
    placed_at = datetime.now(timezone.utc).isoformat()
    raw_items = [it.model_dump() for it in payload.items]

    # Validate splits if provided — must sum (±1¢) to total.
    splits_payload = None
    if payload.splits:
        ssum = round(sum(float(s.amount) for s in payload.splits), 2)
        if abs(ssum - round(float(payload.total), 2)) > 0.01:
            raise HTTPException(
                status_code=400,
                detail=f"Split amounts ({ssum}) must sum to total ({payload.total})",
            )
        splits_payload = [{"method": s.method, "amount": float(s.amount)} for s in payload.splits]

    doc = {
        "id": f"o_{uuid.uuid4().hex[:10]}",
        "tenant_id": user["tenant_id"],
        "number": number,
        "type": payload.type,
        "status": payload.status or "new",
        "customer": payload.customer.model_dump(exclude_none=False),
        "table": payload.table,
        "items": await annotate_order_items_for_kds(db, user["tenant_id"], raw_items),
        "deliveryFee": payload.deliveryFee,
        "discount": payload.discount,
        "total": payload.total,
        "payment": payload.payment,
        "placedAt": placed_at,
        "driver": payload.driver,
        "source": payload.source or "in-store",
        "tip": float(payload.tip or 0),
        "coupon_code": (payload.coupon_code or None),
        "location_id": payload.location_id,
        "customer_email": (payload.customer_email or "").strip() or None,
        "refunded_amount": 0,
        "voided": False,
        "loyalty_earned": 0,
        "loyalty_redeemed": 0,
        "splits": splits_payload,
    }
    await db.orders.insert_one(doc)
    await _apply_recipes(db, user["tenant_id"], raw_items)

    # Bump coupon usage counter (best-effort — doesn't fail the order).
    if payload.coupon_code:
        try:
            await db.coupons.update_one(
                tenant_filter(user, {"code": payload.coupon_code.strip().upper()}),
                {"$inc": {"used_count": 1}},
            )
        except Exception as exc:
            logger.warning("coupon usage bump failed: %s", exc)

    # Loyalty: burn requested points first (so earn is computed on the
    # already-discounted total), then credit on the resulting paid amount.
    redeemed = 0
    if payload.redeem_loyalty_points and payload.redeem_loyalty_points > 0:
        try:
            redeemed = await loyalty_mod.burn_for_order(db, user, doc, int(payload.redeem_loyalty_points))
        except HTTPException:
            redeemed = 0  # surfaces in toast at frontend; don't fail the order
    earned = 0
    if payload.payment in ("cash", "card"):
        earned = await loyalty_mod.credit_for_order(db, user, doc)
    if earned or redeemed:
        await db.orders.update_one(
            tenant_filter(user, {"id": doc["id"]}),
            {"$set": {"loyalty_earned": earned, "loyalty_redeemed": redeemed}},
        )
        doc["loyalty_earned"] = earned
        doc["loyalty_redeemed"] = redeemed

    schedule_broadcast("kds.ticket", {"orderId": doc["id"], "number": doc["number"]}, user["tenant_id"])

    # Optional customer email receipt — fire-and-forget; never block the order.
    if payload.send_email_receipt and payload.customer_email and "@" in payload.customer_email:
        try:
            tenant = await get_tenant(user, db)
            subject, body = order_receipt_email(doc, tenant or {})
            asyncio.create_task(send_email(payload.customer_email.strip(), subject, body))
        except Exception as exc:
            logger.warning("receipt email scheduling failed: %s", exc)

    if payload.type == "dine-in" and payload.table is not None:
        await db.tables.update_one(
            tenant_filter(user, {"number": payload.table}),
            {"$set": {"status": "occupied", "order_id": doc["id"]}},
        )
        tbl = await db.tables.find_one(tenant_filter(user, {"number": payload.table}), PROJECTION)
        if tbl:
            schedule_broadcast("table.updated", table_doc_to_response(tbl), user["tenant_id"])
    if payload.customer.id:
        await db.customers.update_one(
            tenant_filter(user, {"id": payload.customer.id}), {"$inc": {"orders": 1}},
        )
    cleaned = clean(doc)
    schedule_broadcast("order.upserted", cleaned, user["tenant_id"])
    return cleaned


@router.post("/orders/{order_id}/append", response_model=Order)
async def append_items_to_order(order_id: str, payload: OrderAppendPayload, user: dict = Depends(get_current_user)):
    """Append extra items to an existing order (running tab / occupied table).

    The order must not be paid/voided/completed. Items go through the KDS
    annotation + recipe inventory decrement pipeline just like a fresh order,
    and the running total is bumped by the added subtotal.
    """
    if not payload.items:
        raise HTTPException(status_code=422, detail="No items to add")
    db = get_db()
    existing = await db.orders.find_one(tenant_filter(user, {"id": order_id}), PROJECTION)
    if not existing:
        raise HTTPException(status_code=404, detail="Order not found")
    if existing.get("voided"):
        raise HTTPException(status_code=400, detail="Cannot add to a voided order")
    if existing.get("status") == "completed":
        raise HTTPException(status_code=400, detail="Cannot add to a completed order")
    if existing.get("payment") in ("cash", "card"):
        raise HTTPException(status_code=400, detail="Order already paid — start a new order")

    raw_items = [it.model_dump() for it in payload.items]
    annotated = await annotate_order_items_for_kds(db, user["tenant_id"], raw_items)
    add_subtotal = round(sum((it.get("price", 0) or 0) * (it.get("qty", 0) or 0) for it in raw_items), 2)
    new_total = round(float(existing.get("total", 0) or 0) + add_subtotal, 2)

    # Drop status back to 'new' so KDS re-alerts staff to the freshly-added items.
    res = await db.orders.find_one_and_update(
        tenant_filter(user, {"id": order_id}),
        {
            "$push": {"items": {"$each": annotated}},
            "$set": {"total": new_total, "status": "new"},
        },
        return_document=True,
    )
    await _apply_recipes(db, user["tenant_id"], raw_items)
    schedule_broadcast("kds.ticket", {"orderId": order_id, "number": res["number"]}, user["tenant_id"])
    cleaned = clean(res)
    schedule_broadcast("order.upserted", cleaned, user["tenant_id"])
    return cleaned


@router.patch("/orders/{order_id}/status", response_model=Order)
async def set_order_status(order_id: str, payload: OrderStatusPayload, user: dict = Depends(get_current_user)):
    db = get_db()
    res = await db.orders.find_one_and_update(
        tenant_filter(user, {"id": order_id}), {"$set": {"status": payload.status}}, return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Order not found")
    if payload.status == "completed":
        await db.tables.update_many(
            tenant_filter(user, {"order_id": order_id}),
            {"$set": {"status": "available", "order_id": None}},
        )
        async for t in db.tables.find(
            tenant_filter(user, {"order_id": None, "status": "available"}), PROJECTION,
        ):
            schedule_broadcast("table.updated", table_doc_to_response(t), user["tenant_id"])
    cleaned = clean(res)
    schedule_broadcast("order.upserted", cleaned, user["tenant_id"])
    return cleaned


@router.patch("/orders/{order_id}/driver", response_model=Order)
async def assign_driver(order_id: str, payload: AssignDriverPayload, user: dict = Depends(get_current_user)):
    db = get_db()
    res = await db.orders.find_one_and_update(
        tenant_filter(user, {"id": order_id}), {"$set": {"driver": payload.driver}}, return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Order not found")
    cleaned = clean(res)
    schedule_broadcast("order.upserted", cleaned, user["tenant_id"])
    return cleaned


@router.patch("/orders/{order_id}/payment", response_model=Order)
async def update_payment(order_id: str, payload: dict, user: dict = Depends(get_current_user)):
    """Drivers use this to mark cash-on-delivery as collected."""
    db = get_db()
    new_payment = payload.get("payment")
    if new_payment not in ("cash", "card", "unpaid"):
        raise HTTPException(status_code=422, detail="Invalid payment")
    res = await db.orders.find_one_and_update(
        tenant_filter(user, {"id": order_id}),
        {"$set": {"payment": new_payment}},
        return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Order not found")
    cleaned = clean(res)
    schedule_broadcast("order.upserted", cleaned, user["tenant_id"])
    return cleaned


@router.post("/orders/{order_id}/claim", response_model=Order)
async def claim_order(order_id: str, user: dict = Depends(get_current_user)):
    """A driver self-assigns to an unclaimed delivery."""
    if user.get("role") != "Driver":
        raise HTTPException(status_code=403, detail="Only drivers can claim")
    db = get_db()
    res = await db.orders.find_one_and_update(
        tenant_filter(user, {"id": order_id, "type": "delivery", "driver": None}),
        {"$set": {"driver": user["name"]}},
        return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Delivery not available or already claimed")
    cleaned = clean(res)
    schedule_broadcast("order.upserted", cleaned, user["tenant_id"])
    return cleaned
