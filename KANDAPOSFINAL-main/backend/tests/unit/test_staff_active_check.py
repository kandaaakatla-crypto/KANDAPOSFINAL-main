"""Regression test for P0-5 (docs/p0-remediation/FINDINGS.md): deactivated
staff kept working access. `DELETE /api/staff/{id}` sets `active: False`
and invalidates the user cache, but `auth.get_current_user`'s staff branch
never looked at `active` — so a token issued before deactivation kept
working until it expired (ACCESS_TOKEN_HOURS). The dashboard-user branch
already rejected `active is False`; staff now mirror it.
"""
import os
import random

import pytest
from pymongo import MongoClient

import cache

DEMO_MANAGER_PIN = "1234"


class _FakeRedis:
    """Just enough of redis.asyncio.Redis for cache.py's get/set/delete, so
    the auth user cache is actually exercised (with no REDIS_URL it's a
    permanent miss). Anything else another caller reaches for (ratelimit's
    incr, ws's publish) raises AttributeError, which those callers already
    catch and degrade from."""

    def __init__(self):
        self.store: dict = {}

    async def get(self, key):
        return self.store.get(key)

    async def set(self, key, value, ex=None):
        self.store[key] = value

    async def delete(self, *keys):
        for k in keys:
            self.store.pop(k, None)


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _manager_token(client) -> str:
    r = client.post(
        "/api/auth/login",
        json={"pin": DEMO_MANAGER_PIN},
        headers={"X-Forwarded-For": "203.0.113.50"},
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _create_staff_and_sign_in(client, manager_token: str) -> tuple[str, str]:
    """Creates a Cashier with a fresh PIN and signs in as them. Returns
    (staff_id, staff_token)."""
    for _ in range(50):
        pin = f"{random.randint(0, 9999):04d}"
        if pin == DEMO_MANAGER_PIN:
            continue
        r = client.post(
            "/api/staff",
            json={"name": "Test Cashier", "role": "Cashier", "pin": pin},
            headers=_auth(manager_token),
        )
        if r.status_code == 409:  # PIN already taken in the seeded tenant
            continue
        assert r.status_code == 200, r.text
        staff_id = r.json()["id"]
        break
    else:
        pytest.fail("could not find a free 4-digit PIN")

    r = client.post(
        "/api/auth/login",
        json={"pin": pin},
        headers={"X-Forwarded-For": "203.0.113.51"},
    )
    assert r.status_code == 200, r.text
    return staff_id, r.json()["token"]


def test_deactivated_staff_token_is_rejected(client):
    manager = _manager_token(client)
    staff_id, staff_token = _create_staff_and_sign_in(client, manager)

    r = client.get("/api/auth/me", headers=_auth(staff_token))
    assert r.status_code == 200, r.text

    r = client.delete(f"/api/staff/{staff_id}", headers=_auth(manager))
    assert r.status_code == 200, r.text

    r = client.get("/api/auth/me", headers=_auth(staff_token))
    assert r.status_code == 401, r.text


def test_deactivated_staff_token_is_rejected_with_warm_user_cache(client, monkeypatch):
    """Same as above, but with the user cache live and primed by a request
    before deactivation, so the 60s cache TTL can't open a window."""
    fake = _FakeRedis()
    monkeypatch.setattr(cache, "_client", fake)
    monkeypatch.setattr(cache, "_checked", True)

    manager = _manager_token(client)
    staff_id, staff_token = _create_staff_and_sign_in(client, manager)

    r = client.get("/api/auth/me", headers=_auth(staff_token))
    assert r.status_code == 200, r.text
    # Prove the cached path is really in play, not a silent miss.
    assert any(staff_id in k for k in fake.store), fake.store

    r = client.delete(f"/api/staff/{staff_id}", headers=_auth(manager))
    assert r.status_code == 200, r.text

    r = client.get("/api/auth/me", headers=_auth(staff_token))
    assert r.status_code == 401, r.text
    r = client.get("/api/auth/me", headers=_auth(staff_token))
    assert r.status_code == 401, r.text


def test_staff_without_active_field_still_authenticate(client, db_name):
    """Legacy rows (seed.py, owner_routes.py, routes/brands.py inserts) may
    have no `active` field at all. Absent must mean active, or every such
    user is locked out."""
    manager = _manager_token(client)
    staff_id, staff_token = _create_staff_and_sign_in(client, manager)

    m = MongoClient(os.environ["MONGO_URL"])
    try:
        res = m[db_name].users.update_one({"id": staff_id}, {"$unset": {"active": ""}})
        assert res.modified_count == 1
    finally:
        m.close()

    r = client.get("/api/auth/me", headers=_auth(staff_token))
    assert r.status_code == 200, r.text
