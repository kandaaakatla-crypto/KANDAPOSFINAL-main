"""Aggregator surge / peak pricing: rule CRUD + validation, and the order
recording how much of its bill was surge (routes/surge.py, orders.py).

Uses the seeded demo tenant (Manager PIN 1234). Margherita is sent at a
surged ₹220 over a ₹200 base (+10%); restaurant GST is 5% exclusive.
"""
import pytest

DEMO_MANAGER_PIN = "1234"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def token(client) -> str:
    r = client.post(
        "/api/auth/login",
        json={"pin": DEMO_MANAGER_PIN},
        headers={"X-Forwarded-For": "203.0.113.71"},
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


def test_surge_rule_crud_separate_and_combined(client, token):
    h = _auth(token)
    swiggy = client.post("/api/pricing/surge-rules", json={
        "name": "Swiggy markup", "channels": ["swiggy"], "pct": 10,
    }, headers=h)
    assert swiggy.status_code == 200, swiggy.text
    assert swiggy.json()["start_time"] is None  # all day

    combined = client.post("/api/pricing/surge-rules", json={
        "name": "Weekend dinner peak", "channels": ["zomato", "swiggy", "swiggy"], "pct": 5,
        "days": [7, 5, 6], "start_time": "19:00", "end_time": "23:00",
    }, headers=h)
    assert combined.status_code == 200, combined.text
    body = combined.json()
    assert body["channels"] == ["swiggy", "zomato"]
    assert body["days"] == [5, 6, 7]

    listed = {r["id"] for r in client.get("/api/pricing/surge-rules", headers=h).json()}
    assert {swiggy.json()["id"], body["id"]} <= listed

    upd = client.put(f"/api/pricing/surge-rules/{body['id']}", json={"pct": 7.5, "all_day": True}, headers=h)
    assert upd.status_code == 200, upd.text
    assert upd.json()["pct"] == 7.5
    assert upd.json()["start_time"] is None and upd.json()["end_time"] is None

    assert client.delete(f"/api/pricing/surge-rules/{body['id']}", headers=h).status_code == 200
    listed = {r["id"] for r in client.get("/api/pricing/surge-rules", headers=h).json()}
    assert body["id"] not in listed
    assert client.delete(f"/api/pricing/surge-rules/{body['id']}", headers=h).status_code == 404


@pytest.mark.parametrize("payload", [
    {"name": "   ", "channels": ["swiggy"], "pct": 10},  # blank name
    {"name": "x", "channels": [], "pct": 10},  # no aggregator
    {"name": "x", "channels": ["in-store"], "pct": 10},  # not an aggregator
    {"name": "x", "channels": ["swiggy"], "pct": 0},  # no markup
    {"name": "x", "channels": ["swiggy"], "pct": 0.001},  # would round to 0%
    {"name": "x", "channels": ["swiggy"], "pct": 150},  # over the cap
    {"name": "x", "channels": ["swiggy"], "pct": 10, "start_time": "19:00"},  # half a window
    {"name": "x", "channels": ["swiggy"], "pct": 10, "start_time": "25:00", "end_time": "23:00"},
    {"name": "x", "channels": ["swiggy"], "pct": 10, "start_time": "19:00", "end_time": "19:00"},
    {"name": "x", "channels": ["swiggy"], "pct": 10, "days": [0]},
])
def test_surge_rule_rejects_bad_input(client, token, payload):
    r = client.post("/api/pricing/surge-rules", json=payload, headers=_auth(token))
    assert r.status_code in (400, 422), r.text


def test_order_records_surge_amount(client, token):
    h = _auth(token)
    r = client.post("/api/orders", json={
        "type": "delivery", "source": "swiggy",
        "customer": {"name": "Swiggy #123"},
        "items": [{"name": "Margherita", "qty": 2, "price": 220, "base_price": 200, "surge_pct": 10}],
        "total": 462, "payment": "unpaid",
    }, headers=h)
    assert r.status_code == 200, r.text
    order = r.json()
    assert order["surgeAmount"] == 40
    assert order["items"][0]["base_price"] == 200
    assert order["items"][0]["surge_pct"] == 10
    assert order["subtotal"] == 440  # GST is on the surged price

    r = client.post(f"/api/orders/{order['id']}/append", json={
        "items": [{"name": "Margherita", "qty": 1, "price": 220, "base_price": 200, "surge_pct": 10}],
    }, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["surgeAmount"] == 60


def test_plain_order_has_no_surge(client, token):
    r = client.post("/api/orders", json={
        "type": "collection", "customer": {"name": "Walk-in"},
        "items": [{"name": "Margherita", "qty": 1, "price": 200}],
        "total": 210, "payment": "unpaid",
    }, headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json()["surgeAmount"] == 0
