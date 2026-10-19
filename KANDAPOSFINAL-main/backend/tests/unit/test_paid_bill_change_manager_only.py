"""Any staff member could change how a settled bill was paid, including
flipping it back to unpaid or switching a cash sale to UPI after the fact,
which takes the cash out of the drawer count with no manager involved.
Settling an unpaid bill stays open to every role (cashiers at the till,
drivers collecting cash on delivery); changing a bill that is already paid
now needs a manager.
"""
import uuid

import pytest


def _h(client, pin, ip):
    r = client.post("/api/auth/login", json={"pin": pin}, headers={"X-Forwarded-For": ip})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture
def cashier(client):
    return _h(client, "2345", "203.0.113.171")


@pytest.fixture
def manager(client):
    return _h(client, "1234", "203.0.113.172")


def _order(client, h, payment="unpaid"):
    r = client.post("/api/orders", headers=h, json={
        "type": "collection", "customer": {"name": "Walk-in"}, "payment": payment,
        "items": [{"name": "Masala Dosa", "qty": 1, "price": 200}], "total": 210,
        "client_ref": f"lo_{uuid.uuid4().hex}"})
    assert r.status_code == 200, r.text
    return r.json()


def _pay(client, h, order, payment):
    return client.patch(f"/api/orders/{order['id']}/payment", json={"payment": payment}, headers=h)


def test_cashier_can_settle_an_unpaid_bill(client, cashier):
    r = _pay(client, cashier, _order(client, cashier), "cash")
    assert r.status_code == 200, r.text
    assert r.json()["payment"] == "cash"


@pytest.mark.parametrize("change_to", ["unpaid", "upi"])
def test_cashier_cannot_change_a_paid_bill(client, cashier, change_to):
    paid = _order(client, cashier, payment="cash")
    r = _pay(client, cashier, paid, change_to)
    assert r.status_code == 403, r.text


def test_manager_can_correct_a_paid_bill(client, cashier, manager):
    paid = _order(client, cashier, payment="cash")
    r = _pay(client, manager, paid, "upi")
    assert r.status_code == 200, r.text
    assert r.json()["payment"] == "upi"
