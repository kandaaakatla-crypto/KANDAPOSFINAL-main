"""Loyalty / points engine on top of customers.

Earn rule: `floor(subtotal / 100)` points per order — applied automatically
in orders.py when the customer (matched by phone) exists.

Redeem rule: cashier passes `redeem_loyalty_points` on the order; backend
subtracts from the customer's balance and discounts the order ₹1/point
(capped at order subtotal). Negative balances are refused.

Tier upgrades are recomputed every earn event from `loyalty_lifetime_spend`.

This module exposes the read/write surface for the UI:
  GET    /customers/{id}/loyalty       — balance + recent txns
  POST   /customers/{id}/loyalty/adjust — manager manual adjustment (with note)
  GET    /loyalty/lookup?phone=...      — quick balance by phone for checkout
"""
import uuid
from datetime import datetime, timezone
from tz import now_ist
from typing import List

from fastapi import APIRouter, HTTPException, Depends, Query

from db import get_db
from auth import get_current_user, require_role
from tenants import tenant_filter
from models import LoyaltyTxn, LoyaltyAdjust, LOYALTY_EARN_DIVISOR, LOYALTY_TIERS

router = APIRouter()


def _now() -> str:
    return now_ist().isoformat()


def _tier_for(lifetime_spend: float) -> str:
    tier = "bronze"
    for name, threshold in LOYALTY_TIERS:
        if lifetime_spend >= threshold:
            tier = name
    return tier


async def credit_for_order(db, user_doc: dict, order_doc: dict) -> int:
    """Called from orders.create — auto-earn points for a paid order.
    Returns the number of points earned (0 if no matching customer)."""
    phone = (order_doc.get("customer") or {}).get("phone") or ""
    if not phone:
        return 0
    cust = await db.customers.find_one(
        {"tenant_id": user_doc["tenant_id"], "phone": phone, "deleted": {"$ne": True}},
        {"_id": 0},
    )
    if not cust:
        return 0
    # Earn on net subtotal — excludes tip + delivery to keep it honest.
    net = float(order_doc.get("total", 0)) - float(order_doc.get("tip", 0) or 0) - float(order_doc.get("deliveryFee", 0) or 0)
    earned = max(0, int(net // LOYALTY_EARN_DIVISOR))
    if earned == 0:
        return 0
    new_lifetime = float(cust.get("loyalty_lifetime_spend") or 0) + max(0.0, net)
    new_tier = _tier_for(new_lifetime)
    await db.customers.update_one(
        {"tenant_id": user_doc["tenant_id"], "id": cust["id"]},
        {"$inc": {"loyalty_points": earned},
         "$set": {"loyalty_lifetime_spend": new_lifetime, "loyalty_tier": new_tier}},
    )
    await db.loyalty_txns.insert_one({
        "id": f"lt_{uuid.uuid4().hex[:10]}",
        "tenant_id": user_doc["tenant_id"],
        "customer_id": cust["id"],
        "customer_name": cust["name"],
        "kind": "earn",
        "points": earned,
        "order_id": order_doc["id"],
        "note": None,
        "by_user_id": user_doc["id"],
        "by_user_name": user_doc["name"],
        "at": _now(),
    })
    return earned


async def burn_for_order(db, user_doc: dict, order_doc: dict, points: int) -> int:
    """Redeem `points` against an order. Returns the number actually burned
    (capped by balance and order *gross* item subtotal — not `total`, which
    is already discounted client-side). Raises on no-such-customer."""
    if points <= 0:
        return 0
    phone = (order_doc.get("customer") or {}).get("phone") or ""
    cust = await db.customers.find_one(
        {"tenant_id": user_doc["tenant_id"], "phone": phone, "deleted": {"$ne": True}},
        {"_id": 0},
    ) if phone else None
    if not cust:
        raise HTTPException(status_code=400, detail="Customer not found — loyalty points cannot be redeemed")
    balance = int(cust.get("loyalty_points") or 0)
    # Cap by the gross item subtotal — the client-side `total` may already
    # reflect the loyalty discount, so it would falsely cap us at zero and
    # let the customer walk out without their balance being debited.
    gross_items = sum(float(it.get("price", 0)) * float(it.get("qty", 0)) for it in order_doc.get("items", []))
    subtotal_cap = int(gross_items)
    burned = min(points, balance, subtotal_cap)
    if burned <= 0:
        return 0
    await db.customers.update_one(
        {"tenant_id": user_doc["tenant_id"], "id": cust["id"]},
        {"$inc": {"loyalty_points": -burned}},
    )
    await db.loyalty_txns.insert_one({
        "id": f"lt_{uuid.uuid4().hex[:10]}",
        "tenant_id": user_doc["tenant_id"],
        "customer_id": cust["id"],
        "customer_name": cust["name"],
        "kind": "redeem",
        "points": -burned,
        "order_id": order_doc["id"],
        "note": f"Redeemed against order #{order_doc['number']}",
        "by_user_id": user_doc["id"],
        "by_user_name": user_doc["name"],
        "at": _now(),
    })
    return burned


@router.get("/customers/{customer_id}/loyalty")
async def get_loyalty(customer_id: str, user: dict = Depends(get_current_user)):
    db = get_db()
    cust = await db.customers.find_one(tenant_filter(user, {"id": customer_id}), {"_id": 0})
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    txns = await db.loyalty_txns.find(
        tenant_filter(user, {"customer_id": customer_id}), {"_id": 0},
    ).sort("at", -1).limit(50).to_list(50)
    return {
        "customer_id": cust["id"],
        "name": cust["name"],
        "phone": cust["phone"],
        "loyalty_points": int(cust.get("loyalty_points") or 0),
        "loyalty_tier": cust.get("loyalty_tier") or "bronze",
        "loyalty_lifetime_spend": float(cust.get("loyalty_lifetime_spend") or 0),
        "transactions": txns,
    }


@router.post("/customers/{customer_id}/loyalty/adjust")
async def adjust_loyalty(customer_id: str, payload: LoyaltyAdjust,
                         user: dict = Depends(require_role("Manager"))):
    if payload.points == 0:
        raise HTTPException(status_code=400, detail="Points adjustment cannot be zero")
    if not (payload.note or "").strip():
        raise HTTPException(status_code=400, detail="Reason note is required")
    db = get_db()
    cust = await db.customers.find_one(tenant_filter(user, {"id": customer_id}), {"_id": 0})
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    current = int(cust.get("loyalty_points") or 0)
    if current + payload.points < 0:
        raise HTTPException(status_code=400, detail="Adjustment would make balance negative")
    await db.customers.update_one(
        tenant_filter(user, {"id": customer_id}),
        {"$inc": {"loyalty_points": int(payload.points)}},
    )
    await db.loyalty_txns.insert_one({
        "id": f"lt_{uuid.uuid4().hex[:10]}",
        "tenant_id": user["tenant_id"],
        "customer_id": customer_id,
        "customer_name": cust["name"],
        "kind": "adjust",
        "points": int(payload.points),
        "note": payload.note.strip(),
        "by_user_id": user["id"],
        "by_user_name": user["name"],
        "at": _now(),
    })
    return {"ok": True, "balance": current + int(payload.points)}


@router.get("/loyalty/lookup")
async def lookup_by_phone(user: dict = Depends(get_current_user),
                          phone: str = Query(..., min_length=4)):
    """Cashier checkout: 'how many points does this phone have available?'"""
    db = get_db()
    cust = await db.customers.find_one(
        tenant_filter(user, {"phone": phone, "deleted": {"$ne": True}}), {"_id": 0},
    )
    if not cust:
        return {"found": False}
    return {
        "found": True,
        "id": cust["id"],
        "name": cust["name"],
        "loyalty_points": int(cust.get("loyalty_points") or 0),
        "loyalty_tier": cust.get("loyalty_tier") or "bronze",
    }


@router.get("/loyalty/txns", response_model=List[LoyaltyTxn])
async def list_txns(user: dict = Depends(require_role("Manager")),
                    limit: int = Query(100, ge=1, le=500)):
    db = get_db()
    docs = await db.loyalty_txns.find(tenant_filter(user), {"_id": 0}).sort("at", -1).limit(limit).to_list(limit)
    return docs
