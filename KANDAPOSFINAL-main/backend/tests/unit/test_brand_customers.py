"""Unified customer profiles for a brand: one profile per person across every
store in the brand, matched by phone number. Customers are stored per tenant
(store), so the same person shows up once per store they've visited, often
with the phone typed differently ("+91 98765 43210" vs "09876543210").
"""
import os
import uuid

import pytest
from pymongo import MongoClient

from routes.dash_auth import _create_dash_token


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def brand(client, db_name):
    """A brand of two stores, one store outside it, and a brand-owner token.
    Customers are inserted straight into Mongo, as the POS would have."""
    tag = uuid.uuid4().hex[:6]
    brand_id = f"brand_t{tag}"
    store_a, store_b, outsider = f"t_a{tag}", f"t_b{tag}", f"t_x{tag}"
    owner = {"id": f"du_{tag}", "email": f"o{tag}@x.test", "tenant_id": store_a,
             "dash_role": "owner", "brand_id": brand_id, "active": True}
    m = MongoClient(os.environ["MONGO_URL"])
    db = m[db_name]
    db.brands.insert_one({"id": brand_id, "slug": f"b{tag}", "name": "Test Brand", "royalty_percent": 0})
    db.tenants.insert_many([
        {"id": store_a, "slug": f"a{tag}", "name": "Store A", "brand_id": brand_id},
        {"id": store_b, "slug": f"b{tag}", "name": "Store B", "brand_id": brand_id},
        {"id": outsider, "slug": f"x{tag}", "name": "Not In Brand"},
    ])
    db.dashboard_users.insert_one(dict(owner))
    db.customers.insert_many([
        {"id": f"cu_a1{tag}", "tenant_id": store_a, "name": "Priya", "phone": "+91 98765 43210",
         "orders": 3, "loyalty_points": 40, "store_credit": 10.0, "loyalty_lifetime_spend": 900.0,
         "updated_at": "2026-09-01T10:00:00+05:30", "deleted_at": None},
        {"id": f"cu_b1{tag}", "tenant_id": store_b, "name": "Priya Sharma", "phone": "09876543210",
         "email": "priya@x.test", "orders": 2, "loyalty_points": 15, "loyalty_lifetime_spend": 400.0,
         "updated_at": "2026-09-20T10:00:00+05:30", "deleted_at": None},
        {"id": f"cu_a2{tag}", "tenant_id": store_a, "name": "Ravi", "phone": "9123456780",
         "orders": 1, "updated_at": "2026-09-05T10:00:00+05:30", "deleted_at": None},
        # soft-deleted in store B: must not be merged in
        {"id": f"cu_b2{tag}", "tenant_id": store_b, "name": "Ravi old", "phone": "9123456780",
         "orders": 9, "updated_at": "2026-09-06T10:00:00+05:30", "deleted_at": "2026-09-07T10:00:00+05:30"},
        # same phone, store outside the brand: must not leak in
        {"id": f"cu_x1{tag}", "tenant_id": outsider, "name": "Priya elsewhere", "phone": "9876543210",
         "orders": 50, "updated_at": "2026-09-25T10:00:00+05:30", "deleted_at": None},
    ])
    db.orders.insert_many([
        {"id": f"o1{tag}", "number": 1, "tenant_id": store_a, "customer": {"id": f"cu_a1{tag}", "name": "Priya"},
         "total": 300.0, "placedAt": "2026-09-01T12:00:00+05:30"},
        {"id": f"o2{tag}", "number": 2, "tenant_id": store_b, "customer": {"id": f"cu_b1{tag}", "name": "Priya Sharma"},
         "total": 200.0, "placedAt": "2026-09-20T12:00:00+05:30"},
        {"id": f"o3{tag}", "number": 3, "tenant_id": store_b, "customer": {"id": f"cu_b1{tag}", "name": "Priya Sharma"},
         "total": 999.0, "placedAt": "2026-09-21T12:00:00+05:30", "voided": True},
        {"id": f"o4{tag}", "number": 4, "tenant_id": outsider, "customer": {"id": f"cu_x1{tag}", "name": "x"},
         "total": 5000.0, "placedAt": "2026-09-22T12:00:00+05:30"},
    ])
    m.close()
    return {"id": brand_id, "a": store_a, "b": store_b, "tag": tag, "token": _create_dash_token(owner)}


def test_profiles_merge_by_phone_across_brand_stores(client, brand):
    r = client.get(f"/api/brand/{brand['id']}/customers", headers=_auth(brand["token"]))
    assert r.status_code == 200, r.text
    body = r.json()
    by_phone = {c["phone"]: c for c in body["customers"]}
    assert set(by_phone) == {"9876543210", "9123456780"}, by_phone
    assert body["total"] == 2

    priya = by_phone["9876543210"]
    assert priya["name"] == "Priya Sharma"  # most recently updated store record wins
    assert priya["email"] == "priya@x.test"
    assert priya["orders"] == 5
    assert priya["loyalty_points"] == 55
    assert priya["store_credit"] == 10.0
    assert priya["lifetime_spend"] == 1300.0
    assert sorted(s["store_name"] for s in priya["stores"]) == ["Store A", "Store B"]

    ravi = by_phone["9123456780"]
    assert ravi["orders"] == 1  # soft-deleted store B row ignored
    assert [s["store_name"] for s in ravi["stores"]] == ["Store A"]

    # busiest customer first
    assert body["customers"][0]["phone"] == "9876543210"


def test_search_by_phone_fragment_and_name(client, brand):
    h = _auth(brand["token"])
    r = client.get(f"/api/brand/{brand['id']}/customers", params={"q": "43210"}, headers=h)
    assert [c["phone"] for c in r.json()["customers"]] == ["9876543210"]
    r = client.get(f"/api/brand/{brand['id']}/customers", params={"q": "ravi"}, headers=h)
    assert [c["phone"] for c in r.json()["customers"]] == ["9123456780"]


def test_profile_detail_has_cross_store_orders(client, brand):
    # any spelling of the number resolves to the same profile
    r = client.get(f"/api/brand/{brand['id']}/customers/+91-98765-43210", headers=_auth(brand["token"]))
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["phone"] == "9876543210"
    assert len(p["stores"]) == 2
    ids = [o["id"] for o in p["recent_orders"]]
    assert ids == [f"o2{brand['tag']}", f"o1{brand['tag']}"]  # newest first, voided + outsider excluded
    assert p["recent_orders"][0]["store_name"] == "Store B"
    assert p["order_spend"] == 500.0

    r = client.get(f"/api/brand/{brand['id']}/customers/9000000000", headers=_auth(brand["token"]))
    assert r.status_code == 404


def test_other_brand_cannot_read_profiles(client, brand):
    r = client.get(f"/api/brand/brand_someoneelse/customers", headers=_auth(brand["token"]))
    assert r.status_code == 403
    r = client.get(f"/api/brand/brand_someoneelse/customers/9876543210", headers=_auth(brand["token"]))
    assert r.status_code == 403
