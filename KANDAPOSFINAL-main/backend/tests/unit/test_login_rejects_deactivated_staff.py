"""Regression test for the Master Test Report P0-6: `POST /api/auth/login`
issued a valid token for a deactivated staff member's PIN. Every later call
then 401'd ("User not found"), which the front-end treated as a dead
session. Login must reject a deactivated account up front, with a clear
message, and must not touch the rate-limit counter for it.
"""
import os
import random

import pytest
from pymongo import MongoClient

DEMO_MANAGER_PIN = "1234"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _manager_token(client) -> str:
    r = client.post(
        "/api/auth/login",
        json={"pin": DEMO_MANAGER_PIN},
        headers={"X-Forwarded-For": "203.0.113.60"},
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _create_staff(client, manager_token: str) -> tuple[str, str]:
    for _ in range(50):
        pin = f"{random.randint(0, 9999):04d}"
        if pin == DEMO_MANAGER_PIN:
            continue
        r = client.post(
            "/api/staff",
            json={"name": "Login Test Cashier", "role": "Cashier", "pin": pin},
            headers=_auth(manager_token),
        )
        if r.status_code == 409:
            continue
        assert r.status_code == 200, r.text
        return r.json()["id"], pin
    pytest.fail("could not find a free 4-digit PIN")


def test_deactivated_staff_cannot_log_in(client):
    manager = _manager_token(client)
    staff_id, pin = _create_staff(client, manager)

    r = client.post("/api/auth/login", json={"pin": pin}, headers={"X-Forwarded-For": "203.0.113.61"})
    assert r.status_code == 200, r.text

    r = client.delete(f"/api/staff/{staff_id}", headers=_auth(manager))
    assert r.status_code == 200, r.text

    r = client.post("/api/auth/login", json={"pin": pin}, headers={"X-Forwarded-For": "203.0.113.62"})
    assert r.status_code == 403, r.text
    assert "deactivated" in r.json()["detail"].lower()
    assert "token" not in r.json()


def test_deactivated_pin_attempts_do_not_lock_out_the_source(client):
    """Hitting a deactivated PIN is not a brute-force guess; it must not
    burn the shared terminal's failed-attempt budget."""
    manager = _manager_token(client)
    staff_id, pin = _create_staff(client, manager)
    client.delete(f"/api/staff/{staff_id}", headers=_auth(manager))

    headers = {"X-Forwarded-For": "203.0.113.63"}
    for _ in range(8):
        r = client.post("/api/auth/login", json={"pin": pin}, headers=headers)
        assert r.status_code == 403, r.text
    r = client.post("/api/auth/login", json={"pin": DEMO_MANAGER_PIN}, headers=headers)
    assert r.status_code == 200, r.text


def test_staff_without_active_field_can_still_log_in(client, db_name):
    """Legacy rows may have no `active` field; absent means active."""
    manager = _manager_token(client)
    staff_id, pin = _create_staff(client, manager)

    m = MongoClient(os.environ["MONGO_URL"])
    try:
        m[db_name].users.update_one({"id": staff_id}, {"$unset": {"active": ""}})
    finally:
        m.close()

    r = client.post("/api/auth/login", json={"pin": pin}, headers={"X-Forwarded-For": "203.0.113.64"})
    assert r.status_code == 200, r.text
