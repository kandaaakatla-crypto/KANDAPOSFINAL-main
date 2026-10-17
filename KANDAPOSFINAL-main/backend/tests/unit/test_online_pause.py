"""Pausing online orders (routes/online_pause.py): an owner stops new
website and pickup orders for a while when the kitchen is slammed, and they
resume on their own when the pause runs out."""
import os
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from pymongo import MongoClient

DEMO_MANAGER_PIN = "1234"
PAUSE = "/api/tenant/online-pause"
INGEST = "/api/integrations/website/orders"


def _manager_headers(client):
    r = client.post("/api/auth/login", json={"pin": DEMO_MANAGER_PIN},
                    headers={"X-Forwarded-For": "203.0.113.91"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _item_id(client, headers):
    r = client.get("/api/menu/items", headers=headers)
    assert r.status_code == 200, r.text
    return next(i for i in r.json()
                if i.get("available", True) and not i.get("isPizza") and not i.get("variants") and i.get("price"))["id"]


def _website_order(item_id, paid):
    return {
        "external_id": f"WC-{uuid.uuid4().hex[:8]}",
        "type": "collection",
        "customer": {"name": "Asha", "phone": "+919800000000"},
        "items": [{"item_id": item_id, "qty": 1}],
        "paid": paid,
    }


def _storefront_headers(tenant_id):
    token = jwt.encode({
        "sub": "+919811111111", "name": "Ravi", "tenant_id": tenant_id, "iss": "storefront",
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
    }, os.environ["JWT_SECRET"], algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def test_pause_blocks_new_online_orders_until_resumed(client):
    headers = _manager_headers(client)
    info = client.get("/api/tenant/info", headers=headers).json()
    slug, tenant_id = info["slug"], info["id"]
    key = client.post("/api/integrations/website/key", headers=headers).json()["key"]
    item = _item_id(client, headers)
    pickup = f"/api/storefront/{slug}/pickup/order"
    cart = {"items": [{"item_id": item, "qty": 1}]}

    r = client.put(PAUSE, json={"minutes": 30}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["paused"] is True
    assert client.get(PAUSE, headers=headers).json()["paused"] is True

    # Unpaid website order and storefront pickup are refused while paused…
    r = client.post(INGEST, json=_website_order(item, paid=False), headers={"X-Kanda-Key": key})
    assert r.status_code == 409, r.text
    r = client.post(pickup, json=cart, headers=_storefront_headers(tenant_id))
    assert r.status_code == 409, r.text
    # …but a website order the customer already paid for is never dropped.
    r = client.post(INGEST, json=_website_order(item, paid=True), headers={"X-Kanda-Key": key})
    assert r.status_code == 200, r.text

    r = client.put(PAUSE, json={"resume": True}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["paused"] is False
    r = client.post(INGEST, json=_website_order(item, paid=False), headers={"X-Kanda-Key": key})
    assert r.status_code == 200, r.text
    r = client.post(pickup, json=cart, headers=_storefront_headers(tenant_id))
    assert r.status_code == 200, r.text


def test_expired_pause_lifts_itself(client, db_name):
    headers = _manager_headers(client)
    info = client.get("/api/tenant/info", headers=headers).json()
    key = client.post("/api/integrations/website/key", headers=headers).json()["key"]
    item = _item_id(client, headers)

    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    m = MongoClient(os.environ["MONGO_URL"])
    try:
        m[db_name].tenants.update_one({"id": info["id"]}, {"$set": {"online_paused_until": past}})
    finally:
        m.close()
    assert client.get(PAUSE, headers=headers).json()["paused"] is False
    r = client.post(INGEST, json=_website_order(item, paid=False), headers={"X-Kanda-Key": key})
    assert r.status_code == 200, r.text


def test_pause_until_reopened_and_bad_durations(client):
    headers = _manager_headers(client)
    r = client.put(PAUSE, json={"minutes": None}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"paused": True, "until": None}
    assert client.put(PAUSE, json={"minutes": 7}, headers=headers).status_code == 422
    assert client.put(PAUSE, json={"resume": True}, headers=headers).json()["paused"] is False
