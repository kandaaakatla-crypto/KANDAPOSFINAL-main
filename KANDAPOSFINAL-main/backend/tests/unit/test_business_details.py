"""A restaurant had no way to enter its own GSTIN, FSSAI licence, address or
bill footer: only Kanda could set them when creating the store. A store with
nothing set printed the demo restaurant's address and GSTIN on its bills.
Owners can now edit their business details, bills print the FSSAI number,
and nothing from the demo store is ever printed on another store's bill.
"""
import os
import uuid

import bcrypt
import pytest
from pymongo import MongoClient

PW = "Passw0rd!x"
SUFFIX = uuid.uuid4().hex[:6]
TID = f"biz{SUFFIX}"


@pytest.fixture(scope="module")
def owner(client, db_name):
    d = MongoClient(os.environ["MONGO_URL"])[db_name]
    d.tenants.insert_one({"id": TID, "slug": TID, "name": "Sri Sai Tiffins", "status": "active",
                          "business_type": "restaurant", "features": {}})
    d.dashboard_users.insert_one({
        "id": f"da_o_{SUFFIX}", "email": f"o{SUFFIX}@biz.test", "name": "Owner", "dash_role": "owner",
        "tenant_id": TID, "password_hash": bcrypt.hashpw(PW.encode(), bcrypt.gensalt()).decode(),
        "active": True, "must_change_password": False, "location_ids": [],
    })
    r = client.post("/api/dash/auth/login", json={"email": f"o{SUFFIX}@biz.test", "password": PW})
    assert r.status_code == 200, r.text
    return {"h": {"Authorization": f"Bearer {r.json()['token']}"}, "db": d}


GOOD = {"name": "Sri Sai Tiffins", "address": "12 MG Road, Vijayawada 520010", "phone": "+91 98490 12345",
        "gstin": "37AAPFU0939F1ZV", "fssai": "10019043001234", "footer": "Thank you, visit again!"}


def test_owner_can_save_business_details(client, owner):
    r = client.put("/api/tenant/store", json=GOOD, headers=owner["h"])
    assert r.status_code == 200, r.text
    store = owner["db"].tenants.find_one({"id": TID})["store"]
    assert store["tax_id"] == "37AAPFU0939F1ZV"
    assert store["fssai"] == "10019043001234"
    assert store["address"] == GOOD["address"]


@pytest.mark.parametrize("field,value", [("gstin", "37AAPFU0939F1Z"), ("gstin", "hello"), ("fssai", "12345")])
def test_bad_registration_numbers_are_rejected(client, owner, field, value):
    r = client.put("/api/tenant/store", json={**GOOD, field: value}, headers=owner["h"])
    assert r.status_code == 422, r.text


def test_bill_prints_fssai_and_never_the_demo_store():
    from receipts import _header_lines, FALLBACK_STORE
    lines = _header_lines({"name": "Sri Sai Tiffins", "fssai": "10019043001234", "tax_id": "37AAPFU0939F1ZV"})
    assert "FSSAI Lic. No. 10019043001234" in lines
    assert "GSTIN 37AAPFU0939F1ZV" in lines
    assert "36ABCDE1234F1Z5" not in str(FALLBACK_STORE) and "HiTech" not in str(FALLBACK_STORE)
