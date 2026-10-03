"""POS tills must be unlocked once by a manager before staff PINs work.

Before this, anyone who knew (or guessed) a restaurant's ID could open
/pos/<id>/login on any browser and sign in with a 4-digit staff PIN, and
the same went for the /pos/<id>/clock punch. Now a till is unlocked once
with a dashboard owner/manager email + password (POST /api/pos-devices/
register), which returns a long-lived device token the till keeps and sends
as X-Device-Token. Staff PIN sign-in and clock punches for that restaurant
require a live (not removed) device token. The public demo tenant is exempt.
"""
import os
import uuid

import bcrypt
import pytest
from pymongo import MongoClient

from auth import hash_pin

SLUG = f"devtest{uuid.uuid4().hex[:6]}"
OTHER_SLUG = f"devother{uuid.uuid4().hex[:6]}"
STAFF_PIN = "4321"
MANAGER_EMAIL = f"mgr-{SLUG}@example.com"
MANAGER_PW = "correct-horse-battery"
OTHER_MANAGER_EMAIL = f"mgr-{OTHER_SLUG}@example.com"


def _ip(n: int) -> dict:
    return {"X-Forwarded-For": f"198.51.100.{n}"}


@pytest.fixture(scope="module")
def tenant(client, db_name):
    m = MongoClient(os.environ["MONGO_URL"])
    db = m[db_name]
    pw_hash = bcrypt.hashpw(MANAGER_PW.encode(), bcrypt.gensalt()).decode()
    for slug, email in ((SLUG, MANAGER_EMAIL), (OTHER_SLUG, OTHER_MANAGER_EMAIL)):
        tid = f"t_{slug}"
        db.tenants.insert_one({"id": tid, "slug": slug, "name": slug, "status": "active",
                               "plan": "none", "business_type": "restaurant"})
        db.users.insert_one({"id": f"u_{slug}", "tenant_id": tid, "name": "Cashier", "role": "Cashier",
                             "initials": "CA", "pin_hash": hash_pin(STAFF_PIN), "active": True})
        db.dashboard_users.insert_one({"id": f"d_{slug}", "tenant_id": tid, "email": email,
                                       "name": "Manager", "dash_role": "manager",
                                       "password_hash": pw_hash, "active": True})
    yield {"id": f"t_{SLUG}"}
    m.close()


def _register(client, slug=SLUG, email=MANAGER_EMAIL, password=MANAGER_PW, ip=60):
    return client.post("/api/pos-devices/register",
                       json={"email": email, "password": password, "name": "Front till"},
                       headers={"X-Tenant-Slug": slug, **_ip(ip)})


def test_pin_login_without_device_token_is_refused(client, tenant):
    r = client.post("/api/auth/login", json={"pin": STAFF_PIN},
                    headers={"X-Tenant-Slug": SLUG, **_ip(1)})
    assert r.status_code == 403, r.text
    assert r.json()["detail"]["code"] == "device_not_registered"


def test_clock_punch_without_device_token_is_refused(client, tenant):
    r = client.post("/api/timeclock/punch", json={"pin": STAFF_PIN},
                    headers={"X-Tenant-Slug": SLUG, **_ip(2)})
    assert r.status_code == 403, r.text


def test_manager_unlocks_till_then_pin_login_works(client, tenant):
    r = _register(client)
    assert r.status_code == 200, r.text
    device_token = r.json()["device_token"]
    r = client.post("/api/auth/login", json={"pin": STAFF_PIN},
                    headers={"X-Tenant-Slug": SLUG, "X-Device-Token": device_token, **_ip(3)})
    assert r.status_code == 200, r.text
    r = client.post("/api/timeclock/punch", json={"pin": STAFF_PIN},
                    headers={"X-Tenant-Slug": SLUG, "X-Device-Token": device_token, **_ip(4)})
    assert r.status_code == 200, r.text


def test_wrong_password_cannot_unlock(client, tenant):
    r = _register(client, password="nope", ip=61)
    assert r.status_code == 401, r.text


def test_manager_of_another_restaurant_cannot_unlock(client, tenant):
    r = _register(client, email=OTHER_MANAGER_EMAIL, ip=62)
    assert r.status_code == 403, r.text


def test_device_token_is_bound_to_its_restaurant(client, tenant):
    token = _register(client, ip=63).json()["device_token"]
    r = client.post("/api/auth/login", json={"pin": STAFF_PIN},
                    headers={"X-Tenant-Slug": OTHER_SLUG, "X-Device-Token": token, **_ip(5)})
    assert r.status_code == 403, r.text


def test_removed_till_is_locked_again(client, tenant):
    r = _register(client, ip=64)
    token, device_id = r.json()["device_token"], r.json()["device"]["id"]
    staff = client.post("/api/auth/login", json={"pin": STAFF_PIN},
                        headers={"X-Tenant-Slug": SLUG, "X-Device-Token": token, **_ip(6)})
    staff_auth = {"Authorization": f"Bearer {staff.json()['token']}"}
    # A Cashier can't remove tills; it needs Manager or above.
    assert client.delete(f"/api/pos-devices/{device_id}", headers=staff_auth).status_code == 403

    login = client.post("/api/dash/auth/login", json={"email": MANAGER_EMAIL, "password": MANAGER_PW})
    dash_auth = {"Authorization": f"Bearer {login.json()['token']}"}
    listed = client.get("/api/pos-devices", headers=dash_auth)
    assert listed.status_code == 200 and any(d["id"] == device_id for d in listed.json())
    assert all("token" not in k for d in listed.json() for k in d)
    assert client.delete(f"/api/pos-devices/{device_id}", headers=dash_auth).status_code == 200

    r = client.post("/api/auth/login", json={"pin": STAFF_PIN},
                    headers={"X-Tenant-Slug": SLUG, "X-Device-Token": token, **_ip(7)})
    assert r.status_code == 403, r.text


def test_demo_tenant_needs_no_device(client):
    r = client.post("/api/auth/login", json={"pin": "1234"},
                    headers={"X-Tenant-Slug": "demo", **_ip(8)})
    assert r.status_code == 200, r.text
