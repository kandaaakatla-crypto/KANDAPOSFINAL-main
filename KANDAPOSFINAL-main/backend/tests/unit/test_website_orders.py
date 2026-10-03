"""Website order ingest (routes/website_orders.py): a store's own online
shop pushes orders into the POS with a per-store key."""
import os
import uuid

from pymongo import MongoClient

DEMO_MANAGER_PIN = "1234"
INGEST = "/api/integrations/website/orders"


def _manager_headers(client):
    r = client.post("/api/auth/login", json={"pin": DEMO_MANAGER_PIN},
                    headers={"X-Forwarded-For": "203.0.113.90"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _new_key(client, headers):
    r = client.post("/api/integrations/website/key", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["key"]


def _simple_item(client, headers):
    r = client.get("/api/menu/items", headers=headers)
    assert r.status_code == 200, r.text
    item = next(i for i in r.json()
                if i.get("available", True) and not i.get("isPizza") and not i.get("variants") and i.get("price"))
    return item


def _order(item_id, **extra):
    body = {
        "external_id": f"WC-{uuid.uuid4().hex[:8]}",
        "type": "delivery",
        "customer": {"name": "Asha", "phone": "+919800000000", "address": "12 MG Road", "email": "asha@example.com"},
        "items": [{"item_id": item_id, "qty": 2}],
        "paid": True,
        "delivery_fee": 40,
    }
    body.update(extra)
    return body


def test_ingest_requires_valid_key(client):
    headers = _manager_headers(client)
    item = _simple_item(client, headers)
    assert client.post(INGEST, json=_order(item["id"])).status_code == 401
    r = client.post(INGEST, json=_order(item["id"]), headers={"X-Kanda-Key": "wsk_not-a-real-key"})
    assert r.status_code == 401, r.text


def test_website_order_lands_on_the_pos_priced_from_the_menu(client):
    headers = _manager_headers(client)
    key = _new_key(client, headers)
    item = _simple_item(client, headers)

    r = client.post(INGEST, json=_order(item["id"]), headers={"X-Kanda-Key": key})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["duplicate"] is False

    orders = client.get("/api/orders", headers=headers)
    assert orders.status_code == 200, orders.text
    order = next(o for o in orders.json() if o["id"] == body["orderId"])
    assert order["source"] == "website"
    assert order["type"] == "delivery"
    assert order["payment"] == "card"
    assert order["status"] == "new"
    assert order["customer"]["name"] == "Asha"
    assert order["deliveryFee"] == 40
    assert order["items"][0]["price"] == float(item["price"])
    assert order["items"][0]["qty"] == 2
    assert order["total"] == body["total"]
    assert order["total"] >= round(float(item["price"]) * 2 + 40, 2) - 0.01


def test_retried_webhook_does_not_duplicate(client):
    headers = _manager_headers(client)
    key = _new_key(client, headers)
    item = _simple_item(client, headers)
    payload = _order(item["id"])

    first = client.post(INGEST, json=payload, headers={"X-Kanda-Key": key})
    second = client.post(INGEST, json=payload, headers={"X-Kanda-Key": key})
    assert first.status_code == 200 and second.status_code == 200, (first.text, second.text)
    assert second.json()["duplicate"] is True
    assert second.json()["orderId"] == first.json()["orderId"]


def test_sku_maps_to_menu_barcode_and_unknown_sku_is_400(client, db_name):
    headers = _manager_headers(client)
    key = _new_key(client, headers)
    item = _simple_item(client, headers)
    sku = f"SKU-{uuid.uuid4().hex[:6]}"
    m = MongoClient(os.environ["MONGO_URL"])
    try:
        m[db_name].menu_items.update_one({"id": item["id"]}, {"$set": {"barcode": sku}})
    finally:
        m.close()

    ok = client.post(INGEST, json=_order(None, items=[{"sku": sku}]), headers={"X-Kanda-Key": key})
    assert ok.status_code == 200, ok.text

    bad = client.post(INGEST, json=_order(None, items=[{"sku": "NOPE-404"}]), headers={"X-Kanda-Key": key})
    assert bad.status_code == 400, bad.text
    assert "NOPE-404" in bad.json()["detail"]


def test_rotating_or_revoking_the_key_cuts_off_the_old_one(client):
    headers = _manager_headers(client)
    item = _simple_item(client, headers)
    old = _new_key(client, headers)
    new = _new_key(client, headers)
    assert client.post(INGEST, json=_order(item["id"]), headers={"X-Kanda-Key": old}).status_code == 401
    assert client.post(INGEST, json=_order(item["id"]), headers={"X-Kanda-Key": new}).status_code == 200

    status = client.get("/api/integrations/website", headers=headers).json()
    assert status["enabled"] is True and status["keyHint"] == new[-4:]
    assert "key" not in status

    assert client.delete("/api/integrations/website/key", headers=headers).status_code == 200
    assert client.post(INGEST, json=_order(item["id"]), headers={"X-Kanda-Key": new}).status_code == 401
    assert client.get("/api/integrations/website", headers=headers).json()["enabled"] is False


def test_key_is_stored_hashed(client, db_name):
    headers = _manager_headers(client)
    key = _new_key(client, headers)
    m = MongoClient(os.environ["MONGO_URL"])
    try:
        tenant = m[db_name].tenants.find_one({"integrations.website": {"$exists": True}})
    finally:
        m.close()
    assert key not in str(tenant)


def test_key_management_needs_a_manager(client):
    assert client.post("/api/integrations/website/key").status_code in (401, 403)
    assert client.get("/api/integrations/website").status_code in (401, 403)
