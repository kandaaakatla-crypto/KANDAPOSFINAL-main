"""QR guests had no way to tell the kitchen "less spicy": the cart sent no
per-line note. A short note (up to 140 characters) can now be added to a
cart line; it reaches the order items, the KDS ticket and the kitchen
receipt data.
"""
import os
import uuid

import pytest
from pymongo import MongoClient

from kds import _kds_view
from receipts import _build_escpos


@pytest.fixture
def table(client, db_name, monkeypatch):
    monkeypatch.setenv("QR_OTP_REQUIRED", "0")
    tag = uuid.uuid4().hex[:6]
    tid = f"t_note{tag}"
    db = MongoClient(os.environ["MONGO_URL"])[db_name]
    db.tenants.insert_one({"id": tid, "slug": tid, "name": "Notes", "status": "active",
                           "business_type": "restaurant", "features": {}})
    db.categories.insert_one({"id": f"c{tag}", "tenant_id": tid, "name": "Mains", "sort_order": 1})
    db.menu_items.insert_one({"id": f"m{tag}", "tenant_id": tid, "cat_id": f"c{tag}", "name": "Biryani",
                              "price": 250, "available": True, "deleted_at": None})
    db.tables.insert_one({"id": f"tb{tag}", "tenant_id": tid, "number": 2, "seats": 2, "status": "available", "order_id": None})
    return {"slug": tid, "db": db, "item": f"m{tag}"}


def _order(client, t, line):
    return client.post(f"/api/storefront/{t['slug']}/table/2/order", json={"items": [{"item_id": t["item"], **line}]})


def test_note_reaches_order_kds_and_kitchen_ticket(client, table):
    r = _order(client, table, {"note": "  less spicy  "})
    assert r.status_code == 200, r.text
    order = table["db"].orders.find_one({"id": r.json()["orderId"]}, {"_id": 0})
    assert order["items"][0]["mods"] == ["Note: less spicy"]
    assert _kds_view(order, None)["items"][0]["mods"] == ["Note: less spicy"]
    assert b"Note: less spicy" in _build_escpos(order, {"name": "Notes"}, "kitchen")


def test_blank_note_adds_nothing(client, table):
    r = _order(client, table, {"note": "   "})
    assert r.status_code == 200, r.text
    assert table["db"].orders.find_one({"id": r.json()["orderId"]})["items"][0]["mods"] == []


def test_note_is_capped_at_140_characters(client, table):
    assert _order(client, table, {"note": "x" * 140}).status_code == 200
    r = _order(client, table, {"note": "x" * 141})
    assert r.status_code == 422, r.text
