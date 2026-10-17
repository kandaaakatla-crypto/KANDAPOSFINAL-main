"""Kanda Driver app: the driver-scoped feed, duty toggle, and the guard rails
on what a Driver token may change on an order.

Uses the seeded demo tenant: Manager PIN 1234, drivers Karthik Rao (4567)
and Sanjay Kumar (9012).
"""
import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _login(client, pin: str, ip: str) -> str:
    r = client.post("/api/auth/login", json={"pin": pin}, headers={"X-Forwarded-For": ip})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def manager(client) -> str:
    return _login(client, "1234", "203.0.113.81")


@pytest.fixture(scope="module")
def karthik(client) -> str:
    return _login(client, "4567", "203.0.113.82")


@pytest.fixture(scope="module")
def sanjay(client) -> str:
    return _login(client, "9012", "203.0.113.83")


def _delivery(client, manager, *, payment="unpaid", status="ready") -> dict:
    r = client.post("/api/orders", json={
        "type": "delivery",
        "customer": {"name": "Priya", "phone": "+919800000001", "address": "12 MG Road"},
        "items": [{"name": "Margherita", "qty": 1, "price": 200}],
        "deliveryFee": 30,
        "tip": 20,
        "total": 260,
        "payment": payment,
    }, headers=_auth(manager))
    assert r.status_code == 200, r.text
    order = r.json()
    if status != "new":
        r = client.patch(f"/api/orders/{order['id']}/status", json={"status": status}, headers=_auth(manager))
        assert r.status_code == 200, r.text
    return order


def _feed(client, token) -> dict:
    r = client.get("/api/driver/feed", headers=_auth(token))
    assert r.status_code == 200, r.text
    return r.json()


def _ids(orders):
    return {o["id"] for o in orders}


def test_feed_is_drivers_only(client, manager):
    assert client.get("/api/driver/feed", headers=_auth(manager)).status_code == 403


def test_available_orders_hide_the_customer_phone_until_claimed(client, manager, karthik):
    order = _delivery(client, manager)
    feed = _feed(client, karthik)
    avail = next(o for o in feed["available"] if o["id"] == order["id"])
    assert avail["customer"]["address"] == "12 MG Road"
    assert "phone" not in avail["customer"]

    r = client.post(f"/api/orders/{order['id']}/claim", headers=_auth(karthik))
    assert r.status_code == 200, r.text
    assert r.json()["driver_id"]
    assert "claimed" in r.json()["statusTimes"]

    feed = _feed(client, karthik)
    assert order["id"] not in _ids(feed["available"])
    mine = next(o for o in feed["active"] if o["id"] == order["id"])
    assert mine["customer"]["phone"] == "+919800000001"


def test_feed_never_includes_non_delivery_orders(client, manager, karthik):
    r = client.post("/api/orders", json={
        "type": "collection", "customer": {"name": "Walk-in", "phone": "+919800000009"},
        "items": [{"name": "Margherita", "qty": 1, "price": 200}], "total": 210, "payment": "unpaid",
    }, headers=_auth(manager))
    oid = r.json()["id"]
    feed = _feed(client, karthik)
    assert oid not in _ids(feed["available"] + feed["active"] + feed["completed"])


def test_full_delivery_flow_counts_toward_todays_stats(client, manager, karthik):
    before = _feed(client, karthik)["stats"]
    order = _delivery(client, manager)
    oid = order["id"]
    client.post(f"/api/orders/{oid}/claim", headers=_auth(karthik))

    r = client.patch(f"/api/orders/{oid}/status", json={"status": "out-for-delivery"}, headers=_auth(karthik))
    assert r.status_code == 200, r.text
    # Can't hand over an unpaid order without collecting.
    r = client.patch(f"/api/orders/{oid}/status", json={"status": "completed"}, headers=_auth(karthik))
    assert r.status_code == 409
    r = client.patch(f"/api/orders/{oid}/payment", json={"payment": "cash"}, headers=_auth(karthik))
    assert r.status_code == 200, r.text
    r = client.patch(f"/api/orders/{oid}/status", json={"status": "completed"}, headers=_auth(karthik))
    assert r.status_code == 200, r.text
    times = r.json()["statusTimes"]
    assert "out-for-delivery" in times and "completed" in times

    after = _feed(client, karthik)
    assert oid in _ids(after["completed"])
    s = after["stats"]
    assert s["delivered"] == before["delivered"] + 1
    assert s["cashInHand"] == pytest.approx(before["cashInHand"] + r.json()["total"])
    assert s["tips"] == pytest.approx(before["tips"] + 20)
    assert s["deliveryFees"] == pytest.approx(before["deliveryFees"] + 30)
    assert s["avgDeliveryMins"] is not None


def test_driver_cannot_touch_another_drivers_delivery(client, manager, karthik, sanjay):
    order = _delivery(client, manager)
    oid = order["id"]
    client.post(f"/api/orders/{oid}/claim", headers=_auth(karthik))

    assert client.patch(f"/api/orders/{oid}/status", json={"status": "out-for-delivery"},
                        headers=_auth(sanjay)).status_code == 403
    assert client.patch(f"/api/orders/{oid}/payment", json={"payment": "cash"},
                        headers=_auth(sanjay)).status_code == 403
    assert client.post(f"/api/orders/{oid}/claim", headers=_auth(sanjay)).status_code == 404
    assert oid not in _ids(_feed(client, sanjay)["active"])


def test_driver_cannot_skip_steps_or_change_payment_freely(client, manager, karthik):
    order = _delivery(client, manager, status="in-kitchen")
    oid = order["id"]
    client.post(f"/api/orders/{oid}/claim", headers=_auth(karthik))
    # Still cooking: can't be picked up yet.
    assert client.patch(f"/api/orders/{oid}/status", json={"status": "out-for-delivery"},
                        headers=_auth(karthik)).status_code == 409
    # Drivers can't move kitchen statuses or mark card/unpaid.
    assert client.patch(f"/api/orders/{oid}/status", json={"status": "ready"},
                        headers=_auth(karthik)).status_code == 409
    assert client.patch(f"/api/orders/{oid}/payment", json={"payment": "card"},
                        headers=_auth(karthik)).status_code == 403


def test_dispatch_assignment_by_name_still_belongs_to_that_driver(client, manager, karthik):
    order = _delivery(client, manager)
    oid = order["id"]
    r = client.patch(f"/api/orders/{oid}/driver", json={"driver": "Karthik Rao"}, headers=_auth(manager))
    assert r.status_code == 200, r.text
    assert oid in _ids(_feed(client, karthik)["active"])
    r = client.patch(f"/api/orders/{oid}/status", json={"status": "out-for-delivery"}, headers=_auth(karthik))
    assert r.status_code == 200, r.text


def test_staff_other_than_drivers_are_unaffected(client, manager):
    order = _delivery(client, manager, status="new")
    oid = order["id"]
    for status in ("completed", "new", "out-for-delivery"):
        r = client.patch(f"/api/orders/{oid}/status", json={"status": status}, headers=_auth(manager))
        assert r.status_code == 200, r.text
    r = client.patch(f"/api/orders/{oid}/payment", json={"payment": "card"}, headers=_auth(manager))
    assert r.status_code == 200, r.text


def test_duty_toggle(client, karthik, manager):
    r = client.post("/api/driver/duty", json={"online": True}, headers=_auth(karthik))
    assert r.status_code == 200 and r.json()["since"]
    assert _feed(client, karthik)["duty"]["online"] is True
    r = client.post("/api/driver/duty", json={"online": False}, headers=_auth(karthik))
    assert _feed(client, karthik)["duty"] == {"online": False, "since": None}
    assert client.post("/api/driver/duty", json={"online": True}, headers=_auth(manager)).status_code == 403
