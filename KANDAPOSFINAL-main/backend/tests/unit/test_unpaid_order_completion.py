"""Master Test Report P0-4: an unpaid order could be advanced to Completed,
after which Bill/Pay vanished and void was refused — the money was stuck."""


def _token(client) -> str:
    r = client.post("/api/auth/login", json={"pin": "1234"}, headers={"X-Forwarded-For": "203.0.113.91"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _place(client, h, **overrides) -> dict:
    payload = {
        "type": "collection", "customer": {"name": "Walk-in"},
        "items": [{"name": "Margherita", "qty": 1, "price": 200}],
        "total": 210, "payment": "unpaid",
    }
    payload.update(overrides)
    r = client.post("/api/orders", json=payload, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_unpaid_order_cannot_be_completed(client):
    h = {"Authorization": f"Bearer {_token(client)}"}
    o = _place(client, h)
    r = client.patch(f"/api/orders/{o['id']}/status", json={"status": "completed"}, headers=h)
    assert r.status_code == 409, r.text
    assert "payment" in r.json()["detail"].lower()


def test_paid_order_can_be_completed(client):
    h = {"Authorization": f"Bearer {_token(client)}"}
    o = _place(client, h)
    r = client.patch(f"/api/orders/{o['id']}/payment", json={"payment": "cash"}, headers=h)
    assert r.status_code == 200, r.text
    r = client.patch(f"/api/orders/{o['id']}/status", json={"status": "completed"}, headers=h)
    assert r.status_code == 200, r.text


def test_cash_on_delivery_can_still_be_completed_by_the_driver(client):
    h = {"Authorization": f"Bearer {_token(client)}"}
    o = _place(client, h, type="delivery", customer={"name": "Cust", "phone": "+919876543210", "address": "Road 1"})
    r = client.patch(f"/api/orders/{o['id']}/status", json={"status": "completed"}, headers=h)
    assert r.status_code == 200, r.text


def test_unpaid_completed_order_can_be_voided_but_paid_cannot(client):
    h = {"Authorization": f"Bearer {_token(client)}"}
    # An unpaid completed order (COD delivery) has nothing to refund — voidable.
    o = _place(client, h, type="delivery", customer={"name": "Cust", "phone": "+919876543211", "address": "Road 2"})
    client.patch(f"/api/orders/{o['id']}/status", json={"status": "completed"}, headers=h)
    r = client.post(f"/api/orders/{o['id']}/void", json={"reason": "never collected"}, headers=h)
    assert r.status_code == 200, r.text

    # A paid completed order still goes through refund, not void.
    p = _place(client, h, payment="cash")
    client.patch(f"/api/orders/{p['id']}/status", json={"status": "completed"}, headers=h)
    r = client.post(f"/api/orders/{p['id']}/void", json={"reason": "x"}, headers=h)
    assert r.status_code == 400, r.text
