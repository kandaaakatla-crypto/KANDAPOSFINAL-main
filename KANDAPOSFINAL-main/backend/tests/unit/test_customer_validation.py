"""Master Test Report P1: customers accepted phone "abc" and a duplicate phone."""
import uuid

import pytest
from pydantic import ValidationError

from models import CustomerCreate, CustomerUpdate


def test_bad_phone_rejected_by_schema():
    for bad in ("abc", "", "   ", "123"):
        with pytest.raises(ValidationError):
            CustomerCreate(name="A", phone=bad)
    with pytest.raises(ValidationError):
        CustomerUpdate(phone="abc")
    assert CustomerCreate(name="A", phone="+91 90001 11122").phone == "+91 90001 11122"


def _login(client):
    r = client.post("/api/auth/login", json={"pin": "1234"}, headers={"X-Forwarded-For": "203.0.113.90"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _phone():
    return "+9190" + str(uuid.uuid4().int)[:8]


def test_duplicate_phone_rejected_on_create_and_update(client):
    h = _login(client)
    phone = _phone()
    a = client.post("/api/customers", json={"name": "A", "phone": phone}, headers=h)
    assert a.status_code == 200, a.text
    # same number, formatted differently, is still a duplicate
    spaced = phone[:3] + " " + phone[3:8] + " " + phone[8:]
    dup = client.post("/api/customers", json={"name": "B", "phone": spaced}, headers=h)
    assert dup.status_code == 409, dup.text
    assert "phone" in dup.json()["detail"].lower()

    b = client.post("/api/customers", json={"name": "B", "phone": _phone()}, headers=h)
    assert b.status_code == 200, b.text
    clash = client.put(f"/api/customers/{b.json()['id']}", json={"phone": phone}, headers=h)
    assert clash.status_code == 409, clash.text
    # re-saving a customer's own number is fine
    same = client.put(f"/api/customers/{a.json()['id']}", json={"phone": phone, "name": "A2"}, headers=h)
    assert same.status_code == 200, same.text
