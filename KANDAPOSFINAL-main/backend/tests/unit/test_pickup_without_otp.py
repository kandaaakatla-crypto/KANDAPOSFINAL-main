"""Pickup ordering from the QR/online page only worked after an SMS OTP
sign-in. SMS is switched off for launch, so no customer could place a pickup
order at all. Like Petpooja, the customer now just gives a name and mobile
number at checkout; a signed-in customer still works as before.
"""
import os
import uuid

import pytest
from pymongo import MongoClient

SUFFIX = uuid.uuid4().hex[:6]
TID = f"pk{SUFFIX}"


@pytest.fixture(scope="module")
def store(client, db_name):
    d = MongoClient(os.environ["MONGO_URL"])[db_name]
    d.tenants.insert_one({"id": TID, "slug": TID, "name": "Idli House", "business_type": "restaurant", "features": {}})
    d.categories.insert_one({"id": f"c{SUFFIX}", "tenant_id": TID, "name": "Tiffins", "color": "#f00", "sort_order": 1})
    d.menu_items.insert_one({"id": f"m{SUFFIX}", "tenant_id": TID, "name": "Idli", "cat_id": f"c{SUFFIX}",
                             "price": 40, "available": True, "deleted_at": None})
    return d


def _line():
    return [{"item_id": f"m{SUFFIX}", "qty": 2}]


def test_pickup_order_with_name_and_phone_and_no_sign_in(client, store):
    r = client.post(f"/api/storefront/{TID}/pickup/order",
                    json={"items": _line(), "customer_name": "Lakshmi", "customer_phone": "98765 43210"})
    assert r.status_code == 200, r.text
    o = store.orders.find_one({"id": r.json()["orderId"]})
    assert o["type"] == "collection"
    assert o["customer"]["name"] == "Lakshmi" and o["customer"]["phone"] == "+919876543210"


@pytest.mark.parametrize("body", [
    {"customer_name": "", "customer_phone": "9876543210"},
    {"customer_name": "Lakshmi", "customer_phone": "12345"},
    {},
])
def test_pickup_needs_a_name_and_a_valid_mobile(client, store, body):
    r = client.post(f"/api/storefront/{TID}/pickup/order", json={"items": _line(), **body})
    assert r.status_code in (400, 422), r.text
