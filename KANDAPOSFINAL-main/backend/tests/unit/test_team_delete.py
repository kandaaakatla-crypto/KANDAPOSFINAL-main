"""Master Test Report P1: team members could only be blocked; DELETE
/api/dash/team/{id} returned 405. The owner can now remove one for good."""
import os
import uuid

import bcrypt
import pytest
from pymongo import MongoClient

PW = "Passw0rd!x"
SUFFIX = uuid.uuid4().hex[:6]
BRAND = f"brand_td{SUFFIX}"
HOME = f"tdhome{SUFFIX}"
OTHER = f"tdother{SUFFIX}"


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _login(client, email):
    r = client.post("/api/dash/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def world(client, db_name):
    m = MongoClient(os.environ["MONGO_URL"])
    d = m[db_name]
    for tid, brand in ((HOME, BRAND), (OTHER, None)):
        d.tenants.insert_one({"id": tid, "slug": tid, "name": tid, "status": "active",
                              "business_type": "restaurant", "features": {}, "brand_id": brand})
    pw = bcrypt.hashpw(PW.encode(), bcrypt.gensalt()).decode()
    for key, extra in {"owner": {"dash_role": "owner", "tenant_id": HOME, "brand_id": BRAND},
                       "manager": {"dash_role": "manager", "tenant_id": HOME},
                       "stranger": {"dash_role": "manager", "tenant_id": OTHER}}.items():
        d.dashboard_users.insert_one({"id": f"da_{key}_{SUFFIX}", "email": f"{key}{SUFFIX}@td.test", "name": key,
                                      "password_hash": pw, "active": True, "must_change_password": False,
                                      "location_ids": [], **extra})
    yield {k: f"{k}{SUFFIX}@td.test" for k in ("owner", "manager", "stranger")}
    m.close()


def test_owner_can_delete_a_member_and_their_login_dies(client, world):
    owner = _login(client, world["owner"])
    mgr = _login(client, world["manager"])
    r = client.delete(f"/api/dash/team/da_manager_{SUFFIX}", headers=_auth(owner))
    assert r.status_code == 200, r.text
    members = client.get("/api/dash/team", headers=_auth(owner)).json()["members"]
    assert all(m["id"] != f"da_manager_{SUFFIX}" for m in members)
    assert client.get("/api/dash/auth/me", headers=_auth(mgr)).status_code == 401
    assert client.post("/api/dash/auth/login", json={"email": world["manager"], "password": PW}).status_code in (401, 403)


def test_cannot_delete_outside_scope_or_as_manager(client, world):
    owner = _login(client, world["owner"])
    assert client.delete(f"/api/dash/team/da_stranger_{SUFFIX}", headers=_auth(owner)).status_code == 404
    assert client.delete(f"/api/dash/team/da_owner_{SUFFIX}", headers=_auth(owner)).status_code == 404
    stranger = _login(client, world["stranger"])
    assert client.delete(f"/api/dash/team/da_owner_{SUFFIX}", headers=_auth(stranger)).status_code == 403
