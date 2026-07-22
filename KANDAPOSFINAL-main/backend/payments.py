"""Razorpay payment integration for Kanda POS.

Flow per order:
  1. Frontend hits POST /api/payments/order with {orderId, amount} (amount in major units, e.g. 19.56).
  2. Backend creates a Razorpay order (amount in paise), persists razorpay_order_id on the POS order.
  3. Frontend opens the Razorpay Checkout modal using the returned razorpay_order_id + public key.
  4. On successful capture, frontend hits POST /api/payments/verify with {razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId}.
  5. Backend verifies the signature, marks the POS order as paid (payment="card"), and stores payment metadata.
"""
import os
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
import razorpay

from auth import get_current_user
from db import get_db
from ws import schedule_broadcast
from tenants import tenant_filter


payments_router = APIRouter(prefix="/payments")

_client = None


def _get_client() -> razorpay.Client:
    global _client
    if _client is None:
        kid = os.environ.get("RAZORPAY_KEY_ID")
        sec = os.environ.get("RAZORPAY_KEY_SECRET")
        if not kid or not sec:
            raise HTTPException(status_code=500, detail="Razorpay credentials not configured")
        _client = razorpay.Client(auth=(kid, sec))
    return _client


class CreatePaymentOrderRequest(BaseModel):
    orderId: str
    amount: float  # major units (e.g. ₹19.56)


class CreatePaymentOrderResponse(BaseModel):
    razorpayOrderId: str
    razorpayKeyId: str
    amount: int        # paise
    currency: str
    posOrderId: str


class VerifyPaymentRequest(BaseModel):
    orderId: str
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


@payments_router.post("/order", response_model=CreatePaymentOrderResponse)
async def create_payment_order(payload: CreatePaymentOrderRequest, user: dict = Depends(get_current_user)):
    db = get_db()
    order = await db.orders.find_one(tenant_filter(user, {"id": payload.orderId}), {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="POS order not found")

    currency = os.environ.get("CURRENCY", "INR")
    amount_paise = int(round(payload.amount * 100))
    if amount_paise <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")

    client = _get_client()
    receipt = f"pos_{payload.orderId}"[:40]
    rzp_order = client.order.create({
        "amount": amount_paise,
        "currency": currency,
        "receipt": receipt,
        "payment_capture": 1,
    })

    await db.orders.update_one(
        tenant_filter(user, {"id": payload.orderId}),
        {"$set": {
            "razorpayOrderId": rzp_order["id"],
            "razorpayStatus": "created",
        }},
    )

    return CreatePaymentOrderResponse(
        razorpayOrderId=rzp_order["id"],
        razorpayKeyId=os.environ["RAZORPAY_KEY_ID"],
        amount=amount_paise,
        currency=currency,
        posOrderId=payload.orderId,
    )


@payments_router.post("/verify")
async def verify_payment(payload: VerifyPaymentRequest, user: dict = Depends(get_current_user)):
    client = _get_client()
    try:
        client.utility.verify_payment_signature({
            "razorpay_order_id": payload.razorpay_order_id,
            "razorpay_payment_id": payload.razorpay_payment_id,
            "razorpay_signature": payload.razorpay_signature,
        })
    except razorpay.errors.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid payment signature")

    db = get_db()
    updated = await db.orders.find_one_and_update(
        tenant_filter(user, {"id": payload.orderId, "razorpayOrderId": payload.razorpay_order_id}),
        {"$set": {
            "payment": "card",
            "razorpayPaymentId": payload.razorpay_payment_id,
            "razorpayStatus": "captured",
        }},
        return_document=True,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="POS order or Razorpay order id mismatch")
    updated.pop("_id", None)
    schedule_broadcast("order.upserted", updated, user["tenant_id"])
    return {"ok": True, "order": updated}
