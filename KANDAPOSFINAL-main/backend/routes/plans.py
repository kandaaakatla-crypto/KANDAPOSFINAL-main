"""Pay-per-location billing (Razorpay).

Model: the FIRST location is always free (included with signup). Every
additional location the tenant adds must be paid for BEFORE it can be
created. Each purchase is one-time — the tenant gains one "location slot"
which they can then spend by hitting POST /locations.

Flow:
  1. Client hits POST /api/locations
  2. Server checks: active_locations >= 1 + tenant.paid_slots → 402 with
     {code: 'payment_required', price, currency}
  3. Client opens Razorpay via POST /api/payments/purchase-location
  4. On Razorpay success handler, client POSTs /api/payments/verify
  5. Server validates HMAC, increments tenant.paid_slots by 1 (idempotent),
     and returns {ok, slots_added, slots_remaining}
  6. Client re-issues the original POST /locations which now succeeds

The old tier-based PLANS are gone. Feature-level entitlements can be added
back later as a separate `tenant.features` flag if needed.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import uuid
from datetime import datetime, timezone

import razorpay
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from db import get_db
from auth import get_current_user, require_role

logger = logging.getLogger("kanda.plans")
router = APIRouter()


# One-time price per additional location, in INR. First location is free.
LOCATION_PRICE_INR = 1999.0
CURRENCY = "INR"


def _client() -> razorpay.Client:
    kid = os.environ.get("RAZORPAY_KEY_ID", "").strip()
    sec = os.environ.get("RAZORPAY_KEY_SECRET", "").strip()
    if not kid or not sec:
        raise HTTPException(status_code=500, detail="Razorpay not configured on server")
    return razorpay.Client(auth=(kid, sec))


async def _tenant_slots(db, tenant_id: str) -> dict:
    """Compute how many location slots the tenant has and has used.

    Every tenant gets 1 free slot. Additional slots come from paid one-time
    location purchases (tenant.paid_slots)."""
    doc = await db.tenants.find_one(
        {"id": tenant_id}, {"_id": 0, "paid_slots": 1}
    )
    paid = int((doc or {}).get("paid_slots", 0))
    total_slots = 1 + paid  # 1 always-free + paid ones
    used = await db.locations.count_documents(
        {"tenant_id": tenant_id, "active": {"$ne": False}}
    )
    return {
        "free_slots": 1,
        "paid_slots": paid,
        "total_slots": total_slots,
        "used": used,
        "remaining": max(0, total_slots - used),
        "price_per_location": LOCATION_PRICE_INR,
        "currency": CURRENCY,
    }


@router.get("/plans")
async def billing_info(user: dict = Depends(get_current_user)):
    """Simplified billing summary used by the Locations header + upgrade
    dialog. Keeps the /plans route so the frontend `plansApi` still works."""
    db = get_db()
    slots = await _tenant_slots(db, user["tenant_id"])
    return {
        "model": "pay_per_location",
        **slots,
        # For backwards-compat with the existing UI copy.
        "current": {
            "id": "pay_as_you_grow",
            "name": "Pay as you grow",
            "location_quota": slots["total_slots"],
        },
    }


# -------------------------------------------------------------------
# Buy one extra location slot
# -------------------------------------------------------------------
@router.post("/payments/purchase-location")
async def purchase_location(user: dict = Depends(require_role("Manager"))):
    """Create a Razorpay Order for one extra location slot (₹1999)."""
    client = _client()
    amount_paise = int(LOCATION_PRICE_INR * 100)
    receipt = f"kanda_loc_{uuid.uuid4().hex[:12]}"
    try:
        order = client.order.create({
            "amount": amount_paise,
            "currency": CURRENCY,
            "receipt": receipt,
            "payment_capture": 1,
            "notes": {
                "purpose": "location_slot",
                "tenant_id": user["tenant_id"],
                "user_id": user.get("id") or "",
                "user_name": user.get("name") or "",
            },
        })
    except Exception as exc:  # noqa: BLE001
        logger.exception("Razorpay order.create failed")
        raise HTTPException(status_code=502, detail=f"Razorpay error: {exc}")

    db = get_db()
    await db.payment_transactions.insert_one({
        "provider": "razorpay",
        "purpose": "location_slot",
        "order_id": order["id"],
        "receipt": receipt,
        "tenant_id": user["tenant_id"],
        "amount": LOCATION_PRICE_INR,
        "amount_paise": amount_paise,
        "currency": CURRENCY,
        "user_id": user.get("id"),
        "user_name": user.get("name"),
        "status": "initiated",
        "payment_status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    return {
        "order_id": order["id"],
        "amount": amount_paise,
        "currency": CURRENCY,
        "key_id": os.environ["RAZORPAY_KEY_ID"],
        "description": "One additional location slot",
        "price": LOCATION_PRICE_INR,
    }


# -------------------------------------------------------------------
# Verify signature + credit the slot
# -------------------------------------------------------------------
class VerifyRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


@router.post("/payments/verify")
async def verify_payment(payload: VerifyRequest, user: dict = Depends(get_current_user)):
    key_secret = os.environ["RAZORPAY_KEY_SECRET"].encode()
    body = f"{payload.razorpay_order_id}|{payload.razorpay_payment_id}".encode()
    expected = hmac.new(key_secret, body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, payload.razorpay_signature):
        raise HTTPException(status_code=400, detail="Signature verification failed")

    db = get_db()
    record = await db.payment_transactions.find_one(
        {"order_id": payload.razorpay_order_id}, {"_id": 0}
    )
    if not record:
        raise HTTPException(status_code=404, detail="Order not found")
    if record.get("tenant_id") != user["tenant_id"]:
        raise HTTPException(status_code=403, detail="Wrong tenant for this order")

    await _apply_paid(db, payload.razorpay_order_id, payload.razorpay_payment_id, record)
    slots = await _tenant_slots(db, user["tenant_id"])
    return {"ok": True, "payment_status": "paid", "slots": slots}


async def _apply_paid(db, order_id: str, payment_id: str, record: dict) -> None:
    """Idempotent — mark txn paid AND grant one location slot."""
    if record.get("payment_status") == "paid":
        return
    tenant_id = record.get("tenant_id")
    r = await db.payment_transactions.update_one(
        {"order_id": order_id, "payment_status": {"$ne": "paid"}},
        {"$set": {
            "status": "completed", "payment_status": "paid",
            "razorpay_payment_id": payment_id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    # Only credit slot if THIS call actually flipped the status (guards against
    # webhook + client-verify race conditions).
    if r.modified_count and tenant_id and record.get("purpose") == "location_slot":
        await db.tenants.update_one(
            {"id": tenant_id},
            {"$inc": {"paid_slots": 1},
             "$set": {"last_slot_purchased_at": datetime.now(timezone.utc).isoformat()}},
        )
        logger.info("Tenant %s granted +1 location slot via Razorpay", tenant_id)


@router.get("/payments/status/{order_id}")
async def get_status(order_id: str, user: dict = Depends(get_current_user)):
    db = get_db()
    record = await db.payment_transactions.find_one(
        {"order_id": order_id, "tenant_id": user["tenant_id"]}, {"_id": 0}
    )
    if not record:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return {
        "order_id": record["order_id"],
        "status": record["status"],
        "payment_status": record["payment_status"],
        "purpose": record.get("purpose"),
    }


@router.post("/webhook/razorpay")
async def razorpay_webhook(request: Request):
    """Defence-in-depth webhook — same idempotent credit if the browser
    verify call gets interrupted."""
    body = await request.body()
    signature = request.headers.get("x-razorpay-signature", "")
    secret = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "").strip()
    if secret:
        try:
            _client().utility.verify_webhook_signature(body.decode(), signature, secret)
        except Exception as exc:
            logger.warning("Invalid Razorpay webhook signature: %s", exc)
            raise HTTPException(status_code=400, detail="Invalid signature")
    else:
        logger.warning("Razorpay webhook received without RAZORPAY_WEBHOOK_SECRET set")

    import json as _json
    try:
        payload = _json.loads(body.decode() or "{}")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event = payload.get("event", "")
    if event not in ("payment.captured", "order.paid"):
        return {"status": "ignored", "event": event}

    entity = (payload.get("payload", {}).get("payment", {}).get("entity", {})
              or payload.get("payload", {}).get("order", {}).get("entity", {}))
    order_id = entity.get("order_id") or entity.get("id")
    payment_id = entity.get("id")
    if not order_id:
        return {"status": "ignored"}

    db = get_db()
    record = await db.payment_transactions.find_one({"order_id": order_id}, {"_id": 0})
    if record:
        await _apply_paid(db, order_id, payment_id, record)
    return {"status": "ok"}
