"""Every QR order at a table created a new order and pointed the table at
it, so after a guest's second round the POS table only showed the last
round and the earlier rounds fell off the bill. A table now has one
running bill: a QR order at a table with an open bill adds to it, the
same way staff add items to an occupied table.
"""
import os
import uuid

import pytest
from pymongo import MongoClient


@pytest.fixture(autouse=True)
def _qr_otp_off(monkeypatch):
    # These cover the running bill, not phone sign-in (see test_qr_otp.py).
    monkeypatch.setenv("QR_OTP_REQUIRED", "0")


@pytest.fixture
def table(client, db_name):
    tag = uuid.uuid4().hex[:6]
    tid, slug = f"t_rb{tag}", f"rb{tag}"
    db = MongoClient(os.environ["MONGO_URL"])[db_name]
    db.tenants.insert_one({"id": tid, "slug": slug, "name": "Running Bill", "status": "active",
                           "business_type": "restaurant", "features": {}})
    db.categories.insert_one({"id": f"c{tag}", "tenant_id": tid, "name": "Mains", "sort_order": 1, "tax_rate": 5})
    for iid, name, price in ((f"m1{tag}", "Dosa", 100), (f"m2{tag}", "Coffee", 40)):
        db.menu_items.insert_one({"id": iid, "tenant_id": tid, "cat_id": f"c{tag}", "name": name, "price": price,
                                  "available": True, "deleted_at": None})
    db.tables.insert_one({"id": f"tb{tag}", "tenant_id": tid, "number": 7, "seats": 4, "status": "available", "order_id": None})
    return {"slug": slug, "tid": tid, "db": db, "dosa": f"m1{tag}", "coffee": f"m2{tag}"}


def _order(client, t, item_id, qty=1):
    r = client.post(f"/api/storefront/{t['slug']}/table/7/order", json={"items": [{"item_id": item_id, "qty": qty}]})
    assert r.status_code == 200, r.text
    return r.json()


def test_second_round_adds_to_the_same_bill(client, table):
    first = _order(client, table, table["dosa"], 2)
    second = _order(client, table, table["coffee"], 1)

    assert second["orderId"] == first["orderId"]
    order = table["db"].orders.find_one({"id": first["orderId"]})
    assert [(i["name"], i["qty"]) for i in order["items"]] == [("Dosa", 2), ("Coffee", 1)]
    assert order["subtotal"] == 240
    assert order["total"] == pytest.approx(252.0)  # 240 + 5% GST
    assert second["total"] == pytest.approx(252.0)
    assert order["status"] == "new"  # kitchen re-alerted for the new round
    assert table["db"].orders.count_documents({"tenant_id": table["tid"]}) == 1
    assert table["db"].tables.find_one({"tenant_id": table["tid"], "number": 7})["order_id"] == first["orderId"]


def test_paid_bill_starts_a_new_one(client, table):
    first = _order(client, table, table["dosa"])
    table["db"].orders.update_one({"id": first["orderId"]}, {"$set": {"payment": "upi"}})
    second = _order(client, table, table["coffee"])
    assert second["orderId"] != first["orderId"]


def test_staff_bill_on_the_table_is_added_to(client, table):
    """A table staff opened on the POS keeps one bill when guests order by QR."""
    staff = _order(client, table, table["dosa"])
    table["db"].orders.update_one({"id": staff["orderId"]}, {"$set": {"source": "pos"}})
    qr = _order(client, table, table["coffee"])
    assert qr["orderId"] == staff["orderId"]
