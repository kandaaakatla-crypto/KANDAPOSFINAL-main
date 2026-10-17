"""Live delivery tracking: the customer's tracking link + delivery OTP, the
driver GPS feed behind it, and the rule that the OTP never leaks to staff
or drivers.

Seeded demo tenant: Manager PIN 1234, drivers Karthik Rao (4567) and
Sanjay Kumar (9012).
"""
import os
import time

import pytest
from pymongo import MongoClient

import routes.tracking as tracking


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _login(client, pin: str, ip: str) -> str:
    r = client.post("/api/auth/login", json={"pin": pin}, headers={"X-Forwarded-For": ip})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def manager(client) -> str:
    return _login(client, "1234", "203.0.113.91")


@pytest.fixture(scope="module")
def karthik(client) -> str:
    return _login(client, "4567", "203.0.113.92")


@pytest.fixture(scope="module")
def sanjay(client) -> str:
    return _login(client, "9012", "203.0.113.93")


@pytest.fixture
def sent(monkeypatch):
    """Stand-in for Twilio WhatsApp: records each message and succeeds."""
    calls = []

    async def fake_send(db, tenant_id, phone, order, store_name, url, body):
        calls.append({"phone": phone, "url": url, "body": body})
        return None

    monkeypatch.setattr(tracking, "_send_whatsapp", fake_send)
    return calls


def _delivery(client, manager, *, phone="+919800000002", payment="card") -> dict:
    customer = {"name": "Priya Sharma", "address": "12 MG Road"}
    if phone:
        customer["phone"] = phone
    r = client.post("/api/orders", json={
        "type": "delivery", "customer": customer,
        "items": [{"name": "Margherita", "qty": 1, "price": 200}],
        "deliveryFee": 30, "total": 240, "payment": payment,
    }, headers=_auth(manager))
    assert r.status_code == 200, r.text
    oid = r.json()["id"]
    assert client.patch(f"/api/orders/{oid}/status", json={"status": "ready"}, headers=_auth(manager)).status_code == 200
    return r.json()


def _feed_order(client, token, oid):
    feed = client.get("/api/driver/feed", headers=_auth(token)).json()
    for o in feed["available"] + feed["active"] + feed["completed"]:
        if o["id"] == oid:
            return o
    return None


def _wait_notified(client, token, oid):
    for _ in range(50):
        o = _feed_order(client, token, oid)
        if o and o.get("trackingNotified"):
            return o
        time.sleep(0.05)
    raise AssertionError("customer was never notified")


@pytest.fixture(scope="module")
def mongo(client, db_name):
    """Sync handle on the test database (the shared async `db` fixture is
    bound to the first test's event loop)."""
    m = MongoClient(os.environ["MONGO_URL"])
    yield m[db_name]
    m.close()


def _stored(mongo, oid):
    return mongo.orders.find_one({"id": oid}, {"_id": 0})


def _pick_up(client, driver, oid):
    assert client.post(f"/api/orders/{oid}/claim", headers=_auth(driver)).status_code == 200
    r = client.patch(f"/api/orders/{oid}/status", json={"status": "out-for-delivery"}, headers=_auth(driver))
    assert r.status_code == 200, r.text
    return r.json()


def test_going_out_for_delivery_sends_the_customer_link_and_otp(client, mongo, manager, karthik, sent):
    order = _delivery(client, manager)
    _pick_up(client, karthik, order["id"])
    fed = _wait_notified(client, karthik, order["id"])

    stored = _stored(mongo, order["id"])
    assert len(stored["deliveryOtp"]) == 4 and stored["deliveryOtp"].isdigit()
    assert len(stored["trackingToken"]) >= 16
    assert stored["trackingNotified"]["ok"] is True, stored["trackingNotified"]
    assert stored["trackingNotified"]["channel"] == "whatsapp"
    msg = sent[-1]
    assert msg["phone"] == "+919800000002"
    assert msg["url"].endswith(f"/track/{stored['trackingToken']}")
    assert stored["trackingToken"] in msg["body"] and stored["deliveryOtp"] in msg["body"]
    assert fed["otpRequired"] is True


def test_otp_and_token_never_reach_staff_or_drivers(client, mongo, manager, karthik, sent):
    order = _delivery(client, manager)
    claimed = client.post(f"/api/orders/{order['id']}/claim", headers=_auth(karthik)).json()
    out = client.patch(f"/api/orders/{order['id']}/status", json={"status": "out-for-delivery"},
                       headers=_auth(karthik)).json()
    fed = _wait_notified(client, karthik, order["id"])
    staff_view = next(o for o in client.get("/api/orders", headers=_auth(manager)).json() if o["id"] == order["id"])
    stored = _stored(mongo, order["id"])
    for seen in (claimed, out, fed, staff_view):
        assert "deliveryOtp" not in seen and "trackingToken" not in seen
        assert stored["deliveryOtp"] not in str({k: v for k, v in seen.items() if k not in ("number", "id")})


def test_driver_needs_the_customers_otp_to_deliver(client, mongo, manager, karthik, sent):
    order = _delivery(client, manager)
    oid = order["id"]
    _pick_up(client, karthik, oid)
    _wait_notified(client, karthik, oid)
    otp = (_stored(mongo, oid))["deliveryOtp"]
    wrong = "0000" if otp != "0000" else "1111"

    r = client.patch(f"/api/orders/{oid}/status", json={"status": "completed"}, headers=_auth(karthik))
    assert r.status_code == 422
    r = client.patch(f"/api/orders/{oid}/status", json={"status": "completed", "otp": wrong}, headers=_auth(karthik))
    assert r.status_code == 422
    r = client.patch(f"/api/orders/{oid}/status", json={"status": "completed", "otp": otp}, headers=_auth(karthik))
    assert r.status_code == 200, r.text


def test_otp_locks_after_repeated_wrong_guesses(client, mongo, manager, karthik, sent):
    order = _delivery(client, manager)
    oid = order["id"]
    _pick_up(client, karthik, oid)
    _wait_notified(client, karthik, oid)
    otp = (_stored(mongo, oid))["deliveryOtp"]
    wrong = "0000" if otp != "0000" else "1111"
    for _ in range(5):
        client.patch(f"/api/orders/{oid}/status", json={"status": "completed", "otp": wrong}, headers=_auth(karthik))
    r = client.patch(f"/api/orders/{oid}/status", json={"status": "completed", "otp": otp}, headers=_auth(karthik))
    assert r.status_code == 429
    # The store can still close it.
    r = client.patch(f"/api/orders/{oid}/status", json={"status": "completed"}, headers=_auth(manager))
    assert r.status_code == 200


def test_no_otp_when_the_customer_was_never_sent_one(client, manager, karthik, monkeypatch):
    """Twilio not configured / message failed: the customer has no code, so
    the driver must not be stuck at the door."""
    async def failing(*a, **k):
        return "Twilio not configured"
    monkeypatch.setattr(tracking, "_send_whatsapp", failing)
    order = _delivery(client, manager)
    oid = order["id"]
    _pick_up(client, karthik, oid)
    fed = _wait_notified(client, karthik, oid)
    assert fed["trackingNotified"]["ok"] is False and fed["otpRequired"] is False
    r = client.patch(f"/api/orders/{oid}/status", json={"status": "completed"}, headers=_auth(karthik))
    assert r.status_code == 200, r.text


def test_public_tracking_page_follows_the_driver(client, mongo, manager, karthik, sent):
    order = _delivery(client, manager)
    oid = order["id"]
    client.post(f"/api/orders/{oid}/claim", headers=_auth(karthik))
    token = (_stored(mongo, oid))["trackingToken"]

    page = client.get(f"/api/track/{token}").json()
    assert page["number"] == order["number"] and page["status"] == "ready"
    assert page["otp"] is None and page["location"] is None
    assert page["customer"] == {"name": "Priya", "address": "12 MG Road"}
    assert page["store"]["name"]

    assert client.post("/api/driver/location", json={"lat": 17.4483, "lng": 78.3915, "accuracy": 8},
                       headers=_auth(karthik)).status_code == 200
    client.patch(f"/api/orders/{oid}/status", json={"status": "out-for-delivery"}, headers=_auth(karthik))
    _wait_notified(client, karthik, oid)
    page = client.get(f"/api/track/{token}").json()
    assert page["status"] == "out-for-delivery"
    assert page["location"]["lat"] == pytest.approx(17.4483)
    assert page["otp"] == (_stored(mongo, oid))["deliveryOtp"]
    assert page["driver"] == {"name": "Karthik"}

    assert client.get("/api/track/not-a-real-token-at-all").status_code == 404


def test_location_is_drivers_only_and_validated(client, manager, karthik):
    assert client.post("/api/driver/location", json={"lat": 1, "lng": 1}, headers=_auth(manager)).status_code == 403
    assert client.post("/api/driver/location", json={"lat": 120, "lng": 1}, headers=_auth(karthik)).status_code == 422


def test_drivers_only_list_their_own_orders(client, manager, karthik, sanjay):
    mine = _delivery(client, manager)
    client.post(f"/api/orders/{mine['id']}/claim", headers=_auth(karthik))
    other = _delivery(client, manager)
    listed = {o["id"] for o in client.get("/api/orders", headers=_auth(karthik)).json()}
    assert mine["id"] in listed and other["id"] not in listed
    assert all(o["type"] == "delivery" for o in client.get("/api/orders", headers=_auth(sanjay)).json())


def test_resend_tracking(client, manager, karthik, sanjay, sent):
    order = _delivery(client, manager)
    oid = order["id"]
    _pick_up(client, karthik, oid)
    _wait_notified(client, karthik, oid)
    assert client.post(f"/api/driver/orders/{oid}/resend-tracking", headers=_auth(sanjay)).status_code == 404
    # Just sent on pickup — throttled.
    assert client.post(f"/api/driver/orders/{oid}/resend-tracking", headers=_auth(karthik)).status_code == 429


def test_push_token_registration(client, karthik, manager):
    assert client.post("/api/driver/push-token", json={"token": "fcm-token-abcdef123456"},
                       headers=_auth(karthik)).status_code == 200
    assert client.post("/api/driver/push-token", json={"token": "fcm-token-abcdef123456"},
                       headers=_auth(manager)).status_code == 403
