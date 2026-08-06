"""Store credit — a per-customer ₹ wallet balance, separate from loyalty
points. Funded by manual top-ups (owner/manager adjustment) or a refund
issued "to store credit" instead of the original payment method (see
`routes/refunds.py`). Spent at checkout the same way loyalty points are —
via an authoritative server-side burn that re-reads the real balance
rather than trusting whatever the client claims (see `burn_credit_for_order`,
mirrors `routes/loyalty.py`'s `burn_for_order`).

Endpoints:
  GET  /customers/{id}/credit        — balance + recent txns
  POST /customers/{id}/credit/adjust — manager manual top-up/adjustment
  GET  /credit/lookup?phone=...      — quick balance by phone for checkout
"""
import uuid
from tz import now_ist
from typing import List

from fastapi import APIRouter, HTTPException, Depends, Query

from db import get_db
from auth import get_current_user, require_role
from tenants import tenant_filter
from models import CreditTxn, StoreCreditAdjust

router = APIRouter()


def _now() -> str:
    return now_ist().isoformat()


async def _log_txn(db, tenant_id: str, customer_id: str, customer_name: str, kind: str,
                    amount: float, order_id: str | None, note: str | None,
                    by_user_id: str | None, by_user_name: str | None) -> None:
    await db.credit_txns.insert_one({
        "id": f"ct_{uuid.uuid4().hex[:10]}",
        "tenant_id": tenant_id,
        "customer_id": customer_id,
        "customer_name": customer_name,
        "kind": kind,
        "amount": amount,
        "order_id": order_id,
        "note": note,
        "by_user_id": by_user_id,
        "by_user_name": by_user_name,
        "at": _now(),
    })


async def burn_credit_for_order(db, user_doc: dict, order_doc: dict, amount: float) -> float:
    """Redeem `amount` of store credit against an order. Returns the amount
    actually burned (capped by balance and the order's *gross* item
    subtotal — same discipline as loyalty's burn, since the client-sent
    `total` may already reflect the discount). Raises on no-such-customer."""
    if amount <= 0:
        return 0.0
    phone = (order_doc.get("customer") or {}).get("phone") or ""
    cust = await db.customers.find_one(
        {"tenant_id": user_doc["tenant_id"], "phone": phone,
         "$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}]},
        {"_id": 0},
    ) if phone else None
    if not cust:
        raise HTTPException(status_code=400, detail="Customer not found — store credit cannot be redeemed")
    balance = float(cust.get("store_credit") or 0)
    gross_items = sum(float(it.get("price", 0)) * float(it.get("qty", 0)) for it in order_doc.get("items", []))
    burned = round(min(amount, balance, gross_items), 2)
    if burned <= 0:
        return 0.0
    await db.customers.update_one(
        {"tenant_id": user_doc["tenant_id"], "id": cust["id"]},
        {"$inc": {"store_credit": -burned}},
    )
    await _log_txn(
        db, user_doc["tenant_id"], cust["id"], cust["name"], "redeem", -burned,
        order_doc["id"], f"Redeemed against order #{order_doc['number']}",
        user_doc["id"], user_doc["name"],
    )
    return burned


async def add_credit_for_refund(db, tenant_id: str, phone: str, amount: float,
                                order_id: str, order_number: int,
                                by_user_id: str, by_user_name: str) -> dict:
    """Issue `amount` of store credit to the customer matching `phone`
    instead of a cash/card refund. Raises if no customer record exists for
    that phone — refund-to-credit needs somewhere to put the balance."""
    cust = await db.customers.find_one(
        {"tenant_id": tenant_id, "phone": phone,
         "$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}]},
        {"_id": 0},
    ) if phone else None
    if not cust:
        raise HTTPException(status_code=400, detail="No customer record on file for this order — can't issue store credit")
    await db.customers.update_one(
        {"tenant_id": tenant_id, "id": cust["id"]},
        {"$inc": {"store_credit": amount}},
    )
    await _log_txn(
        db, tenant_id, cust["id"], cust["name"], "refund", amount,
        order_id, f"Refund for order #{order_number}", by_user_id, by_user_name,
    )
    return {"customer_id": cust["id"], "name": cust["name"], "new_balance": round(float(cust.get("store_credit") or 0) + amount, 2)}


@router.get("/customers/{customer_id}/credit")
async def get_credit(customer_id: str, user: dict = Depends(get_current_user)):
    db = get_db()
    cust = await db.customers.find_one(tenant_filter(user, {"id": customer_id}), {"_id": 0})
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    txns = await db.credit_txns.find(
        tenant_filter(user, {"customer_id": customer_id}), {"_id": 0},
    ).sort("at", -1).limit(50).to_list(50)
    return {
        "customer_id": cust["id"],
        "name": cust["name"],
        "phone": cust["phone"],
        "store_credit": float(cust.get("store_credit") or 0),
        "transactions": txns,
    }


@router.post("/customers/{customer_id}/credit/adjust")
async def adjust_credit(customer_id: str, payload: StoreCreditAdjust,
                        user: dict = Depends(require_role("Manager"))):
    if payload.amount == 0:
        raise HTTPException(status_code=400, detail="Adjustment cannot be zero")
    if not (payload.note or "").strip():
        raise HTTPException(status_code=400, detail="Reason note is required")
    db = get_db()
    cust = await db.customers.find_one(tenant_filter(user, {"id": customer_id}), {"_id": 0})
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    current = float(cust.get("store_credit") or 0)
    if current + payload.amount < 0:
        raise HTTPException(status_code=400, detail="Adjustment would make balance negative")
    await db.customers.update_one(
        tenant_filter(user, {"id": customer_id}),
        {"$inc": {"store_credit": float(payload.amount)}},
    )
    await _log_txn(
        db, user["tenant_id"], customer_id, cust["name"],
        "topup" if payload.amount > 0 else "adjust", float(payload.amount),
        None, payload.note.strip(), user["id"], user["name"],
    )
    return {"ok": True, "balance": round(current + payload.amount, 2)}


@router.get("/credit/lookup")
async def lookup_by_phone(user: dict = Depends(get_current_user), phone: str = Query(..., min_length=4)):
    """Cashier checkout: 'how much store credit does this phone have?'"""
    db = get_db()
    cust = await db.customers.find_one(
        tenant_filter(user, {"phone": phone, "$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}]}),
        {"_id": 0},
    )
    if not cust:
        return {"found": False}
    return {"found": True, "id": cust["id"], "name": cust["name"], "store_credit": float(cust.get("store_credit") or 0)}
