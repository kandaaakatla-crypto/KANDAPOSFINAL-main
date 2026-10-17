"""UrbanPiper order intake (routes/urbanpiper.py): Swiggy/Zomato orders
relayed by UrbanPiper land on the POS with a per-store key.

The payload mirrors the shape of UrbanPiper's order relay webhook (only the
fields the POS reads). Uses the seeded demo tenant (Manager PIN 1234).
"""
import os
import random

from pymongo import MongoClient

DEMO_MANAGER_PIN = "1234"
INGEST = "/api/integrations/urbanpiper/orders"


def _manager_headers(client):
    r = client.post("/api/auth/login", json={"pin": DEMO_MANAGER_PIN},
                    headers={"X-Forwarded-For": "203.0.113.91"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _new_key(client, headers):
    r = client.post("/api/integrations/urbanpiper/key", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["key"]


def _simple_item(client, headers):
    r = client.get("/api/menu/items", headers=headers)
    assert r.status_code == 200, r.text
    return next(i for i in r.json()
                if i.get("available", True) and not i.get("isPizza") and not i.get("variants") and i.get("price"))


def _relay(items, channel="swiggy", **details):
    d = {
        "id": random.randint(10**8, 10**9),
        "channel": channel,
        "order_type": "delivery",
        "order_state": "Placed",
        "discount": 0,
        "charges": [{"title": "Packaging charge", "value": 20}],
        "instructions": "Less spicy",
    }
    d.update(details)
    return {
        "order": {
            "details": d,
            "items": items,
            "store": {"merchant_ref_id": "demo", "id": 1234},
            "payment": [{"option": "payment_gateway", "amount": 0}],
            "next_states": ["Acknowledged", "Food Ready", "Dispatched", "Completed"],
        },
        "customer": {
            "name": "Ravi", "phone": "+919811111111", "email": "ravi@example.com",
            "address": {"line_1": "Flat 4", "sub_locality": "Indiranagar", "city": "Bengaluru", "pin": "560038"},
        },
    }


def _line(item_id, price, qty=1, **extra):
    return {"merchant_id": item_id, "title": "Agg title", "quantity": qty, "price": price, **extra}


def _get_order(client, headers, order_id):
    r = client.get("/api/orders", headers=headers)
    assert r.status_code == 200, r.text
    return next(o for o in r.json() if o["id"] == order_id)


def test_intake_requires_valid_key(client):
    headers = _manager_headers(client)
    item = _simple_item(client, headers)
    body = _relay([_line(item["id"], 100)])
    assert client.post(INGEST, json=body).status_code == 401
    assert client.post(INGEST, json=body, headers={"X-Kanda-Key": "upk_wrong"}).status_code == 401
    # A website key must not open the UrbanPiper endpoint.
    wsk = client.post("/api/integrations/website/key", headers=headers).json()["key"]
    assert client.post(INGEST, json=body, headers={"X-Kanda-Key": wsk}).status_code == 401


def test_swiggy_order_lands_at_aggregator_price_with_pos_name(client, db_name):
    headers = _manager_headers(client)
    key = _new_key(client, headers)
    item = _simple_item(client, headers)
    agg_price = round(float(item["price"]) + 30, 2)  # aggregator menus are often marked up
    body = _relay([_line(item["id"], agg_price, qty=2,
                         options_to_add=[{"title": "Extra cheese", "price": 15}])])

    r = client.post(INGEST, json=body, headers={"X-Kanda-Key": key})
    assert r.status_code == 200, r.text
    assert r.json()["duplicate"] is False

    order = _get_order(client, headers, r.json()["orderId"])
    assert order["source"] == "swiggy"
    assert order["type"] == "delivery"
    assert order["status"] == "new"
    assert order["payment"] == "card"
    assert order["customer"]["name"] == "Ravi"
    assert "Indiranagar" in order["customer"]["address"]
    line = order["items"][0]
    assert line["name"] == item["name"]
    assert line["price"] == agg_price + 15
    assert line["qty"] == 2
    assert "Extra cheese" in line["mods"]
    assert order["deliveryFee"] == 20
    assert order["total"] >= round((agg_price + 15) * 2 + 20, 2) - 0.01

    stored = _stored(db_name, order["id"])
    assert stored["aggregator"] == "swiggy"
    assert stored["external_ref"] == f"urbanpiper:{body['order']['details']['id']}"
    assert stored["sync_warnings"] == []


def test_unmapped_item_still_creates_the_order_with_a_warning(client, db_name):
    headers = _manager_headers(client)
    key = _new_key(client, headers)
    body = _relay([_line("not-on-pos", 199, title="Mystery Biryani")], channel="zomato")
    body["order"]["items"][0]["title"] = "Mystery Biryani"

    r = client.post(INGEST, json=body, headers={"X-Kanda-Key": key})
    assert r.status_code == 200, r.text
    stored = _stored(db_name, r.json()["orderId"])
    assert stored["source"] == "zomato"
    assert stored["items"][0]["name"] == "Mystery Biryani"
    assert stored["items"][0]["price"] == 199
    assert any("Mystery Biryani" in w for w in stored["sync_warnings"])


def test_other_channels_are_recorded_as_other(client, db_name):
    headers = _manager_headers(client)
    key = _new_key(client, headers)
    item = _simple_item(client, headers)
    r = client.post(INGEST, json=_relay([_line(item["id"], 100)], channel="magicpin", order_type="pickup"),
                    headers={"X-Kanda-Key": key})
    assert r.status_code == 200, r.text
    stored = _stored(db_name, r.json()["orderId"])
    assert stored["source"] == "other"
    assert stored["aggregator"] == "magicpin"
    assert stored["type"] == "collection"


def test_long_title_does_not_reject_a_paid_order(client, db_name):
    headers = _manager_headers(client)
    key = _new_key(client, headers)
    body = _relay([_line("not-on-pos", 150)])
    body["order"]["items"][0]["title"] = "X" * 500
    r = client.post(INGEST, json=body, headers={"X-Kanda-Key": key})
    assert r.status_code == 200, r.text
    assert len(_stored(db_name, r.json()["orderId"])["items"][0]["name"]) == 200


def test_brand_outlet_orders_route_by_store_ref(client, db_name):
    """One UrbanPiper webhook (one key) serving several outlets of a brand:
    the order's store merchant_ref_id picks the outlet; a ref outside the
    brand stays on the key's store with a warning."""
    headers = _manager_headers(client)
    key = _new_key(client, headers)
    m = MongoClient(os.environ["MONGO_URL"])
    db = m[db_name]
    brand = f"brand_up_{random.randint(1000, 9999)}"
    outlet = f"outlet_up_{random.randint(1000, 9999)}"
    stranger = f"stranger_up_{random.randint(1000, 9999)}"
    try:
        db.tenants.update_one({"id": "demo"}, {"$set": {"brand_id": brand}})
        db.tenants.insert_many([
            {"id": outlet, "slug": outlet, "name": "Outlet 2", "brand_id": brand, "business_type": "restaurant", "status": "active"},
            {"id": stranger, "slug": stranger, "name": "Other brand", "brand_id": "brand_other", "business_type": "restaurant", "status": "active"},
        ])
        body = _relay([_line("not-on-pos", 120)])
        body["order"]["store"]["merchant_ref_id"] = outlet
        r = client.post(INGEST, json=body, headers={"X-Kanda-Key": key})
        assert r.status_code == 200, r.text
        assert _stored(db_name, r.json()["orderId"])["tenant_id"] == outlet

        body = _relay([_line("not-on-pos", 120)])
        body["order"]["store"]["merchant_ref_id"] = stranger
        r = client.post(INGEST, json=body, headers={"X-Kanda-Key": key})
        assert r.status_code == 200, r.text
        stored = _stored(db_name, r.json()["orderId"])
        assert stored["tenant_id"] == "demo"
        assert any(w.startswith("unknown_aggregator_store") for w in stored["sync_warnings"])
    finally:
        db.tenants.update_one({"id": "demo"}, {"$unset": {"brand_id": ""}})
        db.tenants.delete_many({"id": {"$in": [outlet, stranger]}})
        m.close()


def test_retried_webhook_does_not_duplicate(client):
    headers = _manager_headers(client)
    key = _new_key(client, headers)
    item = _simple_item(client, headers)
    body = _relay([_line(item["id"], 100)])
    first = client.post(INGEST, json=body, headers={"X-Kanda-Key": key})
    second = client.post(INGEST, json=body, headers={"X-Kanda-Key": key})
    assert first.status_code == 200 and second.status_code == 200, (first.text, second.text)
    assert second.json()["duplicate"] is True
    assert second.json()["orderId"] == first.json()["orderId"]


def test_total_mismatch_is_flagged(client, db_name):
    headers = _manager_headers(client)
    key = _new_key(client, headers)
    item = _simple_item(client, headers)
    r = client.post(INGEST, json=_relay([_line(item["id"], 100)], order_total=99999),
                    headers={"X-Kanda-Key": key})
    assert r.status_code == 200, r.text
    stored = _stored(db_name, r.json()["orderId"])
    assert stored["aggregatorTotal"] == 99999
    assert any(w.startswith("aggregator_total_mismatch") for w in stored["sync_warnings"])


def test_rotating_or_revoking_the_key_cuts_off_the_old_one(client):
    headers = _manager_headers(client)
    item = _simple_item(client, headers)
    old = _new_key(client, headers)
    new = _new_key(client, headers)
    assert client.post(INGEST, json=_relay([_line(item["id"], 100)]), headers={"X-Kanda-Key": old}).status_code == 401
    assert client.post(INGEST, json=_relay([_line(item["id"], 100)]), headers={"X-Kanda-Key": new}).status_code == 200
    status = client.get("/api/integrations/urbanpiper", headers=headers).json()
    assert status["enabled"] is True and status["keyHint"] == new[-4:]
    assert status["webhookUrl"].endswith("/api/integrations/urbanpiper/orders")

    assert client.delete("/api/integrations/urbanpiper/key", headers=headers).status_code == 200
    assert client.post(INGEST, json=_relay([_line(item["id"], 100)]), headers={"X-Kanda-Key": new}).status_code == 401
    assert client.get("/api/integrations/urbanpiper", headers=headers).json()["enabled"] is False


def _stored(db_name, order_id):
    m = MongoClient(os.environ["MONGO_URL"])
    try:
        return m[db_name].orders.find_one({"id": order_id})
    finally:
        m.close()
