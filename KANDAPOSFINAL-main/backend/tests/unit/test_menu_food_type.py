"""Indian menus mark every dish veg, egg or non-veg (the green/brown dot),
and QR guests filter on it. Menu items had no such field, so the QR menu
could show neither the mark nor a veg-only filter. Items now carry an
optional foodType that the dashboard sets and the public menu returns.
"""
import os
import uuid

import bcrypt
import pytest
from pymongo import MongoClient

PW = "Passw0rd!x"
SUFFIX = uuid.uuid4().hex[:6]
TID = f"veg{SUFFIX}"
CAT = f"c{SUFFIX}"


@pytest.fixture(scope="module")
def store(client, db_name):
    d = MongoClient(os.environ["MONGO_URL"])[db_name]
    d.tenants.insert_one({"id": TID, "slug": TID, "name": "Veg Point", "status": "active",
                          "business_type": "restaurant", "features": {}})
    d.categories.insert_one({"id": CAT, "tenant_id": TID, "name": "Mains", "color": "#f00", "sort_order": 1})
    d.dashboard_users.insert_one({
        "id": f"da_v_{SUFFIX}", "email": f"v{SUFFIX}@veg.test", "name": "Owner", "dash_role": "owner",
        "tenant_id": TID, "password_hash": bcrypt.hashpw(PW.encode(), bcrypt.gensalt()).decode(),
        "active": True, "must_change_password": False, "location_ids": [],
    })
    r = client.post("/api/dash/auth/login", json={"email": f"v{SUFFIX}@veg.test", "password": PW})
    assert r.status_code == 200, r.text
    return {"h": {"Authorization": f"Bearer {r.json()['token']}"}}


def _public_item(client, item_id):
    r = client.get(f"/api/storefront/{TID}/menu")
    assert r.status_code == 200, r.text
    return next(i for i in r.json()["items"] if i["id"] == item_id)


def test_food_type_is_saved_and_shown_on_the_qr_menu(client, store):
    r = client.post("/api/menu/items", headers=store["h"],
                    json={"catId": CAT, "name": "Dal Makhani", "price": 220, "foodType": "veg"})
    assert r.status_code == 200, r.text
    item_id = r.json()["id"]
    assert r.json()["foodType"] == "veg"
    assert _public_item(client, item_id)["foodType"] == "veg"

    r = client.put(f"/api/menu/items/{item_id}", headers=store["h"], json={"foodType": "nonveg"})
    assert r.status_code == 200, r.text
    assert _public_item(client, item_id)["foodType"] == "nonveg"

    r = client.put(f"/api/menu/items/{item_id}", headers=store["h"], json={"foodType": None})
    assert r.status_code == 200, r.text
    assert _public_item(client, item_id)["foodType"] is None


def test_food_type_is_optional(client, store):
    r = client.post("/api/menu/items", headers=store["h"], json={"catId": CAT, "name": "Water", "price": 20})
    assert r.status_code == 200, r.text
    assert r.json()["foodType"] is None


def test_unknown_food_type_rejected(client, store):
    r = client.post("/api/menu/items", headers=store["h"],
                    json={"catId": CAT, "name": "Mystery", "price": 50, "foodType": "vegan-ish"})
    assert r.status_code == 422
