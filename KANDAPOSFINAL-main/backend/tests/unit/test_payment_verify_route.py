"""Two handlers were registered at POST /api/payments/verify: the location-slot
purchase (routes/plans.py) and POS card payments (payments.py). The plans one
was mounted first and won, so every POS card payment came back 404
"Order not found". The slot purchase now verifies at /payments/location/verify.
"""
import asyncio
import hashlib
import hmac
import os

from motor.motor_asyncio import AsyncIOMotorClient

os.environ.setdefault("RAZORPAY_KEY_ID", "rzp_test_unit")
os.environ.setdefault("RAZORPAY_KEY_SECRET", "unit-test-razorpay-secret")


def _sig(order_id: str, payment_id: str) -> str:
    secret = os.environ["RAZORPAY_KEY_SECRET"].encode()
    return hmac.new(secret, f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()


def _headers(client):
    r = client.post("/api/auth/login", json={"pin": "1234"}, headers={"X-Forwarded-For": "203.0.113.141"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _set_rzp_order(db_name, order_id, rzp_order_id):
    async def go():
        m = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            await m[db_name].orders.update_one({"id": order_id}, {"$set": {"razorpayOrderId": rzp_order_id}})
        finally:
            m.close()
    asyncio.run(go())


def test_only_one_handler_owns_payments_verify(client):
    hits = [r for r in client.app.routes
            if getattr(r, "path", None) == "/api/payments/verify" and "POST" in getattr(r, "methods", set())]
    assert len(hits) == 1, [h.endpoint.__module__ for h in hits]
    assert hits[0].endpoint.__module__ == "payments"


def test_pos_card_payment_verifies(client, db_name):
    h = _headers(client)
    order = client.post("/api/orders", headers=h, json={
        "type": "collection", "customer": {"name": "Walk-in"},
        "items": [{"name": "Margherita", "qty": 1, "price": 200}],
        "total": 210, "payment": "unpaid",
    })
    assert order.status_code == 200, order.text
    oid = order.json()["id"]
    _set_rzp_order(db_name, oid, "order_UNIT123")

    r = client.post("/api/payments/verify", headers=h, json={
        "orderId": oid, "razorpay_order_id": "order_UNIT123",
        "razorpay_payment_id": "pay_UNIT123", "razorpay_signature": _sig("order_UNIT123", "pay_UNIT123"),
    })
    assert r.status_code == 200, r.text
    assert r.json()["order"]["payment"] == "card"


def test_location_slot_verify_has_its_own_path(client):
    h = _headers(client)
    r = client.post("/api/payments/location/verify", headers=h, json={
        "razorpay_order_id": "order_NOPE", "razorpay_payment_id": "pay_NOPE",
        "razorpay_signature": _sig("order_NOPE", "pay_NOPE"),
    })
    assert r.status_code == 404, r.text
    assert r.json()["detail"] == "Order not found"
