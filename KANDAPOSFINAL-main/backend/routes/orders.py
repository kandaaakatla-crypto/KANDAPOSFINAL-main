"""Order CRUD + status & driver mutations."""
import asyncio
import uuid
import logging
from datetime import datetime, timezone
from tz import now_ist
from typing import List

from fastapi import APIRouter, HTTPException, Depends
from pymongo.errors import DuplicateKeyError

from db import get_db
from auth import get_current_user
from tenants import tenant_filter, get_tenant
from ws import schedule_broadcast
from kds import annotate_order_items_for_kds
from email_service import send_email, order_receipt_email
from models import (
    Order, OrderCreate, OrderStatusPayload, AssignDriverPayload, OrderAppendPayload, OrderPackedPayload,
    OrderCustomer, ServiceChargePayload, OrderSplit,
)
from tax import collects_gst, resolve_effective_rate, compute_line_tax, compute_order_tax, compute_service_charge, split_cgst_sgst, apply_taxable_discount
from . import loyalty as loyalty_mod
from . import store_credit as credit_mod
from . import gift_cards as gift_card_mod
from ._shared import PROJECTION, NOT_DELETED, clean, next_order_number, table_doc_to_response

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


def _base_item_name(name: str) -> str:
    """Strip known suffixes so a cart line still matches its base menu item:
    - Pizza sizes are serialised like 'Pepperoni Passion 12"'.
    - Retail variants are serialised like 'Round Neck T-Shirt — Medium'
      (see RetailSaleScreen.jsx's addVariant)."""
    if '"' in name:
        return name.split('"')[0].rsplit(" ", 1)[0]
    if " — " in name:
        return name.split(" — ", 1)[0]
    return name


async def _stamp_item_tax(db, tenant_id: str, business_type: str, items: list[dict],
                          charge_gst: bool = True) -> tuple[list[tuple], list[str]]:
    """Resolve each order item's effective GST rate via its menu item/category,
    stamp tax_rate/tax_amount onto the item dict in place, and return the
    (taxable_value, tax_amount) pairs for the order-level GST breakdown, plus
    any non-fatal warnings (e.g. an item that no longer matches a menu item —
    typically because it was deleted/86'd after an offline order was rung up
    but before it synced) for the caller to surface as sync_warnings.

    Matches items back to their menu item by name (orders don't carry a menu
    item id today), same best-effort approach already used for KDS station
    routing and recipe-based inventory decrement elsewhere in this file."""
    menu = await db.menu_items.find(
        {"tenant_id": tenant_id, **NOT_DELETED}, {"_id": 0, "name": 1, "cat_id": 1, "tax_rate": 1},
    ).to_list(2000)
    by_name = {m["name"]: m for m in menu}
    cats = await db.categories.find(
        {"tenant_id": tenant_id}, {"_id": 0, "id": 1, "name": 1, "tax_rate": 1},
    ).to_list(200)
    cat_by_id = {c["id"]: c for c in cats}
    inclusive = business_type == "retail"

    line_amounts: list[tuple] = []
    warnings: list[str] = []
    for it in items:
        name = it.get("name", "")
        menu_item = by_name.get(name) or by_name.get(_base_item_name(name))
        if not menu_item:
            warnings.append(f"item_unavailable: {name}")
        cat = cat_by_id.get(menu_item["cat_id"]) if menu_item else None
        rate, _source = resolve_effective_rate(
            menu_item.get("tax_rate") if menu_item else None,
            cat.get("tax_rate") if cat else None,
            cat["name"] if cat else "",
            business_type,
            it.get("price"),
        )
        if not charge_gst:
            rate = 0.0
        taxable, tax_amt = compute_line_tax(it.get("price", 0) or 0, it.get("qty", 0) or 0, rate, inclusive)
        it["tax_rate"] = rate
        it["tax_amount"] = tax_amt
        line_amounts.append((taxable, tax_amt))
    return line_amounts, warnings


def _surge_amount(items: list[dict]) -> float:
    """₹ that aggregator surge pricing added across `items` — the POS sends
    each surged line's pre-surge `base_price` next to the `price` it charged
    (see routes/surge.py), so this is just the difference, per unit, x qty."""
    total = 0.0
    for it in items:
        base = it.get("base_price")
        if base is None or not it.get("surge_pct"):
            continue
        total += max(0.0, float(it.get("price") or 0) - float(base)) * (it.get("qty") or 0)
    return round(total, 2)


def _with_service_charge(order: dict, items_subtotal: float, items_tax: float, items_gross_delta: float, pct: float) -> dict:
    """Recompute an order's service charge (and the totals it feeds) after its
    items or its service-charge rate change. `items_subtotal`/`items_tax` are
    the item-only figures (service charge excluded); `items_gross_delta` is
    how much the items' own contribution to the total just changed by.
    Returns the fields to $set."""
    old_charge = float(order.get("serviceCharge") or 0)
    old_charge_tax = float(order.get("serviceChargeTax") or 0)
    charge, charge_tax = compute_service_charge(items_subtotal, items_tax, pct)
    tax_total = round(items_tax + charge_tax, 2)
    cgst, sgst = split_cgst_sgst(tax_total)
    total = round(
        float(order.get("total", 0) or 0) - old_charge - old_charge_tax + items_gross_delta + charge + charge_tax, 2,
    )
    return {
        "subtotal": round(items_subtotal, 2), "taxTotal": tax_total, "cgst": cgst, "sgst": sgst,
        "serviceChargePct": pct if charge else 0, "serviceCharge": charge, "serviceChargeTax": charge_tax,
        "total": total,
    }


@router.get("/orders", response_model=List[Order])
async def list_orders(user: dict = Depends(get_current_user)):
    db = get_db()
    docs = await db.orders.find(tenant_filter(user), PROJECTION).sort("placedAt", -1).to_list(1000)
    return docs


@router.post("/orders", response_model=Order)
async def create_order(payload: OrderCreate, user: dict = Depends(get_current_user)):
    db = get_db()

    # Idempotency: a client_ref means this may be a retried replay of an
    # offline-queued order (network dropped after the write landed but
    # before the response did). Return the already-created order instead
    # of creating a duplicate — never trust "no response" to mean "no order".
    if payload.client_ref:
        existing = await db.orders.find_one(
            tenant_filter(user, {"client_ref": payload.client_ref}), PROJECTION,
        )
        if existing:
            return clean(existing)

    number = await next_order_number(db, user["tenant_id"])
    placed_at = now_ist().isoformat()
    raw_items = [it.model_dump() for it in payload.items]

    tenant_doc = await get_tenant(user, db)
    business_type = tenant_doc.get("business_type", "restaurant")

    # GST: resolve each line's effective rate via its menu item/category,
    # stamp tax_rate/tax_amount onto the item, and derive the authoritative
    # order total server-side — the whole point of "tax compliant" is that
    # these numbers are computed here, not merely trusted from the client.
    line_amounts, sync_warnings = await _stamp_item_tax(db, user["tenant_id"], business_type, raw_items, collects_gst(tenant_doc))
    tax = compute_order_tax(line_amounts)
    # GST is on the discounted value, not the sticker price (test report P0-2).
    discount_total = float(payload.discount or 0)
    taxable_disc = discount_total if payload.taxable_discount is None else float(payload.taxable_discount)
    taxable_disc = max(0.0, min(taxable_disc, discount_total))
    d_sub, d_tax, d_items_total = apply_taxable_discount(
        tax["subtotal"], tax["tax_total"], taxable_disc, business_type == "retail",
    )
    tax = {**tax, "subtotal": d_sub, "tax_total": d_tax, "items_total": d_items_total}
    # Service charge is opt-in only (0 unless the customer asked for it).
    sc_pct = float(payload.service_charge_pct or 0)
    sc, sc_tax = compute_service_charge(tax["subtotal"], tax["tax_total"], sc_pct)
    tax_total = round(tax["tax_total"] + sc_tax, 2)
    cgst, sgst = split_cgst_sgst(tax_total)
    # Only the non-taxable remainder (gift card / store credit) comes off the total here.
    grand_total = round(tax["items_total"] + sc + sc_tax - (discount_total - taxable_disc) + float(payload.deliveryFee or 0) + float(payload.tip or 0), 2)

    # Validate splits if provided — must sum (±1¢) to the server-computed total.
    splits_payload = None
    if payload.splits:
        ssum = round(sum(float(s.amount) for s in payload.splits), 2)
        if abs(ssum - grand_total) > 0.01:
            raise HTTPException(
                status_code=400,
                detail=f"Split amounts ({ssum}) must sum to total ({grand_total})",
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
        "total": grand_total,
        "subtotal": tax["subtotal"],
        "taxTotal": tax_total,
        "cgst": cgst,
        "sgst": sgst,
        "taxInclusive": business_type == "retail",
        "serviceChargePct": sc_pct if sc else 0,
        "serviceCharge": sc,
        "serviceChargeTax": sc_tax,
        "surgeAmount": _surge_amount(raw_items),
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
        "store_credit_redeemed": 0,
        "gift_card_code": None,
        "gift_card_redeemed": 0,
        "splits": splits_payload,
        "client_ref": payload.client_ref,
        "sync_warnings": sync_warnings,
    }
    try:
        await db.orders.insert_one(doc)
    except DuplicateKeyError:
        # Lost the race against a concurrent retry with the same client_ref —
        # the other request's order already exists; return it, don't double-book.
        existing = await db.orders.find_one(
            tenant_filter(user, {"client_ref": payload.client_ref}), PROJECTION,
        )
        if existing:
            return clean(existing)
        raise
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
    # Skipped entirely if the tenant has the loyalty feature turned off.
    loyalty_on = (tenant_doc.get("features") or {}).get("loyalty", True)
    redeemed = 0
    if loyalty_on and payload.redeem_loyalty_points and payload.redeem_loyalty_points > 0:
        try:
            redeemed = await loyalty_mod.burn_for_order(db, user, doc, int(payload.redeem_loyalty_points))
        except HTTPException:
            redeemed = 0  # surfaces in toast at frontend; don't fail the order
    earned = 0
    if loyalty_on and payload.payment != "unpaid":
        earned = await loyalty_mod.credit_for_order(db, user, doc)
    if earned or redeemed:
        await db.orders.update_one(
            tenant_filter(user, {"id": doc["id"]}),
            {"$set": {"loyalty_earned": earned, "loyalty_redeemed": redeemed}},
        )
        doc["loyalty_earned"] = earned
        doc["loyalty_redeemed"] = redeemed

    # Store credit + gift card: same server-authoritative debit discipline
    # as loyalty — re-read the real balance rather than trusting the
    # client's `discount` total to reflect an actual deduction.
    credit_redeemed = 0.0
    if payload.redeem_store_credit and payload.redeem_store_credit > 0:
        try:
            credit_redeemed = await credit_mod.burn_credit_for_order(db, user, doc, float(payload.redeem_store_credit))
        except HTTPException:
            credit_redeemed = 0.0
    gift_redeemed = 0.0
    if payload.gift_card_code and payload.gift_card_amount and payload.gift_card_amount > 0:
        try:
            gift_redeemed = await gift_card_mod.redeem_gift_card_for_order(db, user, doc, payload.gift_card_code, float(payload.gift_card_amount))
        except HTTPException:
            gift_redeemed = 0.0
    if credit_redeemed or gift_redeemed:
        await db.orders.update_one(
            tenant_filter(user, {"id": doc["id"]}),
            {"$set": {
                "store_credit_redeemed": credit_redeemed,
                "gift_card_code": payload.gift_card_code if gift_redeemed else None,
                "gift_card_redeemed": gift_redeemed,
            }},
        )
        doc["store_credit_redeemed"] = credit_redeemed
        doc["gift_card_code"] = payload.gift_card_code if gift_redeemed else None
        doc["gift_card_redeemed"] = gift_redeemed

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
            {"$set": {"status": "occupied", "order_id": doc["id"], "updated_at": now_ist().isoformat()}},
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
    if (existing.get("payment") or "unpaid") != "unpaid":
        raise HTTPException(status_code=400, detail="Order already paid — start a new order")

    tenant_doc = await get_tenant(user, db)
    business_type = tenant_doc.get("business_type", "restaurant")

    raw_items = [it.model_dump() for it in payload.items]
    line_amounts, append_warnings = await _stamp_item_tax(db, user["tenant_id"], business_type, raw_items, collects_gst(tenant_doc))
    add_tax = compute_order_tax(line_amounts)
    annotated = await annotate_order_items_for_kds(db, user["tenant_id"], raw_items)
    items_tax = float(existing.get("taxTotal", 0) or 0) - float(existing.get("serviceChargeTax") or 0)
    totals = _with_service_charge(
        existing,
        float(existing.get("subtotal", 0) or 0) + add_tax["subtotal"],
        items_tax + add_tax["tax_total"],
        add_tax["items_total"],
        float(existing.get("serviceChargePct") or 0),
    )
    new_warnings = list(dict.fromkeys((existing.get("sync_warnings") or []) + append_warnings))

    # Drop status back to 'new' so KDS re-alerts staff to the freshly-added items.
    res = await db.orders.find_one_and_update(
        tenant_filter(user, {"id": order_id}),
        {
            "$push": {"items": {"$each": annotated}},
            "$set": {
                **totals, "status": "new",
                "sync_warnings": new_warnings,
            },
            # $inc, not a read-modify-write $set, so two concurrent appends can't drop each other's surge.
            "$inc": {"surgeAmount": _surge_amount(raw_items)},
        },
        return_document=True,
    )
    await _apply_recipes(db, user["tenant_id"], raw_items)
    schedule_broadcast("kds.ticket", {"orderId": order_id, "number": res["number"]}, user["tenant_id"])
    cleaned = clean(res)
    schedule_broadcast("order.upserted", cleaned, user["tenant_id"])
    return cleaned


@router.patch("/orders/{order_id}/service-charge", response_model=Order)
async def set_service_charge(order_id: str, payload: ServiceChargePayload, user: dict = Depends(get_current_user)):
    """Add, change or remove the optional service charge on an open bill —
    it's never applied by default, only when the customer agrees to it.
    pct=0 removes it. Only unpaid bills: a settled total can't silently grow."""
    db = get_db()
    existing = await db.orders.find_one(tenant_filter(user, {"id": order_id}), PROJECTION)
    if not existing:
        raise HTTPException(status_code=404, detail="Order not found")
    if existing.get("voided"):
        raise HTTPException(status_code=400, detail="Cannot change a voided order")
    if existing.get("payment") != "unpaid" or float(existing.get("refunded_amount") or 0) > 0:
        raise HTTPException(status_code=400, detail="Order already paid — service charge can only be changed on an open bill")

    items_tax = float(existing.get("taxTotal", 0) or 0) - float(existing.get("serviceChargeTax") or 0)
    totals = _with_service_charge(existing, float(existing.get("subtotal", 0) or 0), items_tax, 0.0, float(payload.pct))
    res = await db.orders.find_one_and_update(
        tenant_filter(user, {"id": order_id}), {"$set": totals}, return_document=True,
    )
    cleaned = clean(res)
    schedule_broadcast("order.upserted", cleaned, user["tenant_id"])
    return cleaned


@router.patch("/orders/{order_id}/customer", response_model=Order)
async def set_order_customer(order_id: str, payload: OrderCustomer, user: dict = Depends(get_current_user)):
    """Attach/replace the customer details on an order (any type, paid or
    not) — e.g. a dine-in guest asking for a GST invoice in their company's
    name after the meal."""
    db = get_db()
    existing = await db.orders.find_one(tenant_filter(user, {"id": order_id}), PROJECTION)
    if not existing:
        raise HTTPException(status_code=404, detail="Order not found")
    customer = {k: (v.strip() if isinstance(v, str) else v) for k, v in payload.model_dump(exclude_none=False).items()}
    if customer.get("gstin"):
        customer["gstin"] = customer["gstin"].upper()
    if not customer.get("name"):
        # Keep the table placeholder rather than an empty name on a dine-in bill.
        customer["name"] = (existing.get("customer") or {}).get("name") or "Walk-in"
    customer["id"] = customer.get("id") or (existing.get("customer") or {}).get("id")
    res = await db.orders.find_one_and_update(
        tenant_filter(user, {"id": order_id}), {"$set": {"customer": customer}}, return_document=True,
    )
    cleaned = clean(res)
    schedule_broadcast("order.upserted", cleaned, user["tenant_id"])
    return cleaned


@router.patch("/orders/{order_id}/status", response_model=Order)
async def set_order_status(order_id: str, payload: OrderStatusPayload, user: dict = Depends(get_current_user)):
    db = get_db()
    if payload.status == "completed":
        # An unpaid order must not be closed: Completed hides the Bill button
        # and blocks void, leaving the money uncollectable (test report P0-4).
        # Delivery is exempt — cash-on-delivery is legitimately completed by
        # the driver before/while the cash is taken.
        current = await db.orders.find_one(tenant_filter(user, {"id": order_id}), {"_id": 0, "payment": 1, "type": 1, "voided": 1})
        if (current and not current.get("voided") and (current.get("payment") or "unpaid") == "unpaid"
                and current.get("type") != "delivery"):
            raise HTTPException(status_code=409, detail="Collect payment before completing this order.")
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


@router.patch("/orders/{order_id}/pack", response_model=Order)
async def set_order_packed(order_id: str, payload: OrderPackedPayload, user: dict = Depends(get_current_user)):
    db = get_db()
    res = await db.orders.find_one_and_update(
        tenant_filter(user, {"id": order_id}), {"$set": {"packed": payload.packed}}, return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Order not found")
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
    if new_payment not in ("cash", "card", "upi", "card_machine", "other", "split", "unpaid"):
        raise HTTPException(status_code=422, detail="Invalid payment")
    update = {"payment": new_payment}
    if new_payment == "split":
        # Settling a running tab in parts: record every part so the cash half
        # reaches the drawer. Parts must add up to the order total.
        try:
            parts = [OrderSplit(**s) for s in (payload.get("splits") or [])]
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="Invalid splits")
        current = await db.orders.find_one(tenant_filter(user, {"id": order_id}), {"_id": 0, "total": 1})
        if not current:
            raise HTTPException(status_code=404, detail="Order not found")
        if len(parts) < 2 or any(p.amount <= 0 for p in parts) or \
                abs(round(sum(p.amount for p in parts), 2) - round(float(current.get("total") or 0), 2)) > 0.01:
            raise HTTPException(status_code=400, detail="Split amounts must add up to the order total")
        update["splits"] = [{"method": p.method, "amount": float(p.amount)} for p in parts]
    res = await db.orders.find_one_and_update(
        tenant_filter(user, {"id": order_id}),
        {"$set": update},
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
