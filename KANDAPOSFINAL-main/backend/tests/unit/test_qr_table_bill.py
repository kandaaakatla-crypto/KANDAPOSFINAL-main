"""QR guests had no way to see what their table had ordered or pay the
bill from their phone: the page only showed the cart for the next round,
and online payment only worked for orders the QR page itself created, so
a table opened by staff couldn't be paid by QR at all. The table's running
bill is now readable from the table QR and payable online.
"""
import os
import uuid

import pytest
from pymongo import MongoClient

import routes.storefront as storefront


class _FakeRzp:
    class order:  # noqa: N801 - mirrors razorpay.Client().order
        created = []

        @classmethod
        def create(cls, data):
            cls.created.append(data)
            return {"id": f"order_{uuid.uuid4().hex[:10]}", **data}


@pytest.fixture
def table(client, db_name, monkeypatch):
    os.environ.setdefault("RAZORPAY_KEY_ID", "rzp_test_unit")
    monkeypatch.setattr(storefront, "_get_razorpay_client", lambda: _FakeRzp)
    tag = uuid.uuid4().hex[:6]
    tid, slug = f"t_bl{tag}", f"bl{tag}"
    db = MongoClient(os.environ["MONGO_URL"])[db_name]
    db.tenants.insert_one({"id": tid, "slug": slug, "name": "Bill Cafe", "status": "active",
                           "business_type": "restaurant", "features": {"online_payments": True}})
    db.categories.insert_one({"id": f"c{tag}", "tenant_id": tid, "name": "Mains", "sort_order": 1, "tax_rate": 5})
    for iid, name, price in ((f"m1{tag}", "Idli", 60), (f"m2{tag}", "Vada", 50)):
        db.menu_items.insert_one({"id": iid, "tenant_id": tid, "cat_id": f"c{tag}", "name": name, "price": price,
                                  "available": True, "deleted_at": None})
    for n in (3, 4):
        db.tables.insert_one({"id": f"tb{n}{tag}", "tenant_id": tid, "number": n, "seats": 4,
                              "status": "available", "order_id": None})
    return {"slug": slug, "tid": tid, "db": db, "idli": f"m1{tag}", "vada": f"m2{tag}"}


def _order(client, t, item_id, qty=1, table_no=3):
    r = client.post(f"/api/storefront/{t['slug']}/table/{table_no}/order", json={"items": [{"item_id": item_id, "qty": qty}]})
    assert r.status_code == 200, r.text
    return r.json()


def test_table_bill_shows_every_round(client, table):
    _order(client, table, table["idli"], 2)
    placed = _order(client, table, table["vada"], 1)

    r = client.get(f"/api/storefront/{table['slug']}/table/3/bill")
    assert r.status_code == 200, r.text
    bill = r.json()
    assert bill["open"] is True and bill["paid"] is False
    assert bill["orderId"] == placed["orderId"]
    assert [(i["name"], i["qty"], i["price"]) for i in bill["items"]] == [("Idli", 2, 60), ("Vada", 1, 50)]
    assert bill["subtotal"] == 170 and bill["total"] == pytest.approx(178.5)
    assert "customer" not in bill and "phone" not in str(bill)


def test_empty_table_has_no_bill(client, table):
    r = client.get(f"/api/storefront/{table['slug']}/table/4/bill")
    assert r.status_code == 200, r.text
    assert r.json() == {"open": False}


def test_unknown_table_404(client, table):
    assert client.get(f"/api/storefront/{table['slug']}/table/99/bill").status_code == 404


def test_staff_opened_table_bill_can_be_paid_by_qr(client, table):
    placed = _order(client, table, table["idli"], 1)
    table["db"].orders.update_one({"id": placed["orderId"]}, {"$set": {"source": "in-store"}})

    r = client.post(f"/api/storefront/{table['slug']}/payments/order", json={"order_id": placed["orderId"]})
    assert r.status_code == 200, r.text
    assert r.json()["amount"] == 6300


def test_paid_bill_shows_as_paid(client, table):
    placed = _order(client, table, table["idli"], 1)
    table["db"].orders.update_one({"id": placed["orderId"]}, {"$set": {"payment": "card"}})
    bill = client.get(f"/api/storefront/{table['slug']}/table/3/bill").json()
    assert bill["open"] is True and bill["paid"] is True
