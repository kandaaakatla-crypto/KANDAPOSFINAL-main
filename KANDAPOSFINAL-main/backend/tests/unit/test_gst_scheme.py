"""Small restaurants are often under the GST composition scheme or not GST
registered at all. They may not charge GST and must issue a "Bill of
Supply", not a tax invoice. Kanda charged every store 5% GST and titled
every bill a tax invoice. A store can now say how it is registered; for
composition and unregistered stores orders carry no GST and bills say
"Bill of Supply" (with the composition declaration where it applies).
"""
import os
import uuid

import bcrypt
import pytest
from pymongo import MongoClient

PW = "Passw0rd!x"
SUFFIX = uuid.uuid4().hex[:6]
TID = f"gst{SUFFIX}"


@pytest.fixture(scope="module")
def store(client, db_name):
    d = MongoClient(os.environ["MONGO_URL"])[db_name]
    d.tenants.insert_one({"id": TID, "slug": TID, "name": "Chai Point", "status": "active",
                          "business_type": "restaurant", "features": {}})
    d.categories.insert_one({"id": f"c{SUFFIX}", "tenant_id": TID, "name": "Snacks", "color": "#f00", "sort_order": 1})
    d.menu_items.insert_one({"id": f"m{SUFFIX}", "tenant_id": TID, "name": "Samosa", "cat_id": f"c{SUFFIX}", "price": 100,
                             "available": True, "deleted_at": None})
    d.dashboard_users.insert_one({
        "id": f"da_g_{SUFFIX}", "email": f"g{SUFFIX}@gst.test", "name": "Owner", "dash_role": "owner",
        "tenant_id": TID, "password_hash": bcrypt.hashpw(PW.encode(), bcrypt.gensalt()).decode(),
        "active": True, "must_change_password": False, "location_ids": [],
    })
    r = client.post("/api/dash/auth/login", json={"email": f"g{SUFFIX}@gst.test", "password": PW})
    assert r.status_code == 200, r.text
    return {"h": {"Authorization": f"Bearer {r.json()['token']}"}, "db": d}


def _set_scheme(client, store, scheme):
    r = client.put("/api/tenant/store", json={"name": "Chai Point", "gst_scheme": scheme}, headers=store["h"])
    assert r.status_code == 200, r.text


def _order(client, store):
    r = client.post("/api/orders", headers=store["h"], json={
        "type": "collection", "customer": {"name": "Walk-in"}, "payment": "cash",
        "items": [{"name": "Samosa", "qty": 2, "price": 100}], "total": 210, "client_ref": f"lo_{uuid.uuid4().hex}"})
    assert r.status_code == 200, r.text
    return r.json()


def test_regular_store_charges_gst(client, store):
    _set_scheme(client, store, "regular")
    o = _order(client, store)
    assert o["taxTotal"] > 0 and o["total"] > 200


@pytest.mark.parametrize("scheme", ["composition", "unregistered"])
def test_composition_and_unregistered_stores_charge_no_gst(client, store, scheme):
    _set_scheme(client, store, scheme)
    o = _order(client, store)
    assert o["taxTotal"] == 0 and o["total"] == 200
    assert all((it.get("tax_rate") or 0) == 0 for it in o["items"])


def test_bill_title_and_declaration():
    from receipts import bill_title_lines
    assert bill_title_lines({"gst_scheme": "regular", "tax_id": "37AAPFU0939F1ZV"}) == ["TAX INVOICE"]
    assert bill_title_lines({"gst_scheme": "composition", "tax_id": "37AAPFU0939F1ZV"}) == [
        "BILL OF SUPPLY", "Composition taxable person, not eligible to collect tax on supplies"]
    assert bill_title_lines({"gst_scheme": "unregistered"}) == ["BILL OF SUPPLY"]
    assert bill_title_lines({}) == ["TAX INVOICE"]


def test_unknown_scheme_is_rejected(client, store):
    r = client.put("/api/tenant/store", json={"name": "Chai Point", "gst_scheme": "exempt-ish"}, headers=store["h"])
    assert r.status_code == 422, r.text
