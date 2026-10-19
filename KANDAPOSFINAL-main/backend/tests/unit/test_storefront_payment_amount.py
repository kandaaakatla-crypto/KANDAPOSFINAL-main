"""A customer paying for a QR order chose the amount: the browser sent
`amount` and the server charged exactly that, then marked the whole order
paid. Anyone could pay ₹1 for a ₹900 bill. The server now charges the
order's own total and refuses orders that are already paid.
"""
import os
import uuid

import pytest
from pymongo import MongoClient

import routes.storefront as storefront


class _FakeRzpOrders:
    def __init__(self):
        self.created = []

    def create(self, data):
        self.created.append(data)
        return {"id": f"order_{uuid.uuid4().hex[:10]}", **data}


class _FakeRzp:
    def __init__(self):
        self.order = _FakeRzpOrders()


@pytest.fixture
def qr_order(client, db_name, monkeypatch):
    os.environ.setdefault("RAZORPAY_KEY_ID", "rzp_test_unit")
    fake = _FakeRzp()
    monkeypatch.setattr(storefront, "_get_razorpay_client", lambda: fake)
    tag = uuid.uuid4().hex[:6]
    tid, oid = f"t_qr{tag}", f"o_qr{tag}"
    db = MongoClient(os.environ["MONGO_URL"])[db_name]
    db.tenants.insert_one({"id": tid, "slug": f"qr{tag}", "name": "QR Store", "features": {"online_payments": True}})
    db.orders.insert_one({"id": oid, "tenant_id": tid, "source": "qr", "total": 900.0, "payment": "unpaid"})
    return {"slug": f"qr{tag}", "id": oid, "db": db, "rzp": fake}


def test_charges_the_order_total_not_the_amount_sent(client, qr_order):
    r = client.post(f"/api/storefront/{qr_order['slug']}/payments/order",
                    json={"order_id": qr_order["id"], "amount": 1})
    assert r.status_code == 200, r.text
    assert r.json()["amount"] == 90000
    assert qr_order["rzp"].order.created[-1]["amount"] == 90000


def test_amount_can_be_left_out(client, qr_order):
    r = client.post(f"/api/storefront/{qr_order['slug']}/payments/order", json={"order_id": qr_order["id"]})
    assert r.status_code == 200, r.text
    assert r.json()["amount"] == 90000


def test_already_paid_order_is_refused(client, qr_order):
    qr_order["db"].orders.update_one({"id": qr_order["id"]}, {"$set": {"payment": "card"}})
    r = client.post(f"/api/storefront/{qr_order['slug']}/payments/order", json={"order_id": qr_order["id"]})
    assert r.status_code == 409, r.text
