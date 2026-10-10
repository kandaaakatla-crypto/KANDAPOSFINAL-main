"""Dashboard role access: owner sees every store in their brand; a manager is
held to one store and an area manager to the stores the owner gives them;
the owner decides which dashboard sections each of them can use. All of it
enforced by the API, not only by the dashboard's nav.

Before this change every dashboard token was stamped `role: Manager` and
passed every `require_role("Manager")` route, so a store manager could pull
payroll, toggle store features or buy a location slot by calling the API
directly, and an area manager could not reach more than one store at all.

Builds its own three-store fixture (two stores in one brand, one outside it)
directly in Mongo so it never touches the seeded demo tenant other tests use.
"""
import os
import uuid

import bcrypt
import pytest
from pymongo import MongoClient

PW = "Passw0rd!x"
SUFFIX = uuid.uuid4().hex[:6]
BRAND = f"brand_acc{SUFFIX}"
HOME = f"acchome{SUFFIX}"
SECOND = f"accsecond{SUFFIX}"
OUTSIDE = f"accoutside{SUFFIX}"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _login(client, email: str) -> dict:
    r = client.post("/api/dash/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def world(client, db_name):
    m = MongoClient(os.environ["MONGO_URL"])
    d = m[db_name]
    for tid, brand in ((HOME, BRAND), (SECOND, BRAND), (OUTSIDE, None)):
        d.tenants.insert_one({
            "id": tid, "slug": tid, "name": f"Store {tid}", "status": "active",
            "business_type": "restaurant", "features": {}, "brand_id": brand,
        })
    pw_hash = bcrypt.hashpw(PW.encode(), bcrypt.gensalt()).decode()
    users = {
        "owner": {"dash_role": "owner", "tenant_id": HOME, "brand_id": BRAND},
        "manager": {"dash_role": "manager", "tenant_id": HOME},
        "outsider": {"dash_role": "manager", "tenant_id": OUTSIDE},
    }
    for key, extra in users.items():
        d.dashboard_users.insert_one({
            "id": f"da_{key}_{SUFFIX}", "email": f"{key}{SUFFIX}@acc.test", "name": key.title(),
            "password_hash": pw_hash, "active": True, "must_change_password": False,
            "location_ids": [], **extra,
        })
    yield {k: f"{k}{SUFFIX}@acc.test" for k in users}
    m.close()


def test_manager_is_blocked_from_payroll_by_default(client, world):
    tok = _login(client, world["manager"])["token"]
    r = client.get("/api/payroll/summary", headers=_auth(tok))
    assert r.status_code == 403, r.text


def test_owner_reaches_payroll(client, world):
    tok = _login(client, world["owner"])["token"]
    r = client.get("/api/payroll/summary", headers=_auth(tok))
    assert r.status_code == 200, r.text


def test_manager_cannot_buy_a_location_or_toggle_features(client, world):
    tok = _login(client, world["manager"])["token"]
    r = client.post("/api/locations", json={"name": "Sneaky"}, headers=_auth(tok))
    assert r.status_code == 403, r.text
    r = client.patch("/api/tenant/features", json={"loyalty": False}, headers=_auth(tok))
    assert r.status_code == 403, r.text


def test_manager_keeps_pos_checkout_endpoints(client, world):
    """Gating dashboard sections must not break lookups the till needs."""
    tok = _login(client, world["manager"])["token"]
    assert client.get("/api/customers/search?phone=9999999999", headers=_auth(tok)).status_code == 200
    assert client.get("/api/menu/items", headers=_auth(tok)).status_code == 200


def test_owner_grant_takes_effect_on_existing_token(client, world):
    owner = _login(client, world["owner"])["token"]
    mgr = _login(client, world["manager"])["token"]
    r = client.patch(f"/api/dash/team/da_manager_{SUFFIX}",
                     json={"permissions": {"payroll": True}}, headers=_auth(owner))
    assert r.status_code == 200, r.text
    assert r.json()["permissions"]["payroll"] is True
    assert client.get("/api/payroll/summary", headers=_auth(mgr)).status_code == 200
    # ...and revoking does too.
    r = client.patch(f"/api/dash/team/da_manager_{SUFFIX}",
                     json={"permissions": {"payroll": False}}, headers=_auth(owner))
    assert r.status_code == 200, r.text
    assert client.get("/api/payroll/summary", headers=_auth(mgr)).status_code == 403


def test_only_owner_manages_team(client, world):
    mgr = _login(client, world["manager"])["token"]
    assert client.get("/api/dash/team", headers=_auth(mgr)).status_code == 403
    r = client.patch(f"/api/dash/team/da_manager_{SUFFIX}",
                     json={"permissions": {"payroll": True}}, headers=_auth(mgr))
    assert r.status_code == 403, r.text


def test_owner_team_view_is_limited_to_their_stores(client, world):
    owner = _login(client, world["owner"])["token"]
    r = client.get("/api/dash/team", headers=_auth(owner))
    assert r.status_code == 200, r.text
    body = r.json()
    assert {s["id"] for s in body["stores"]} == {HOME, SECOND}
    ids = {m["id"] for m in body["members"]}
    assert f"da_manager_{SUFFIX}" in ids
    assert f"da_outsider_{SUFFIX}" not in ids
    r = client.patch(f"/api/dash/team/da_outsider_{SUFFIX}",
                     json={"permissions": {"payroll": True}}, headers=_auth(owner))
    assert r.status_code == 404, r.text


def test_area_manager_switches_only_to_assigned_stores(client, world):
    owner = _login(client, world["owner"])["token"]
    email = f"area{SUFFIX}@acc.test"
    r = client.post("/api/dash/team", json={
        "email": email, "name": "Area", "dash_role": "area_manager",
        "store_ids": [HOME, SECOND],
    }, headers=_auth(owner))
    assert r.status_code == 200, r.text
    member = r.json()["member"]
    temp_pw = r.json()["temp_password"]

    r = client.post("/api/dash/auth/login", json={"email": email, "password": temp_pw})
    assert r.status_code == 200, r.text
    area = r.json()["token"]

    r = client.get("/api/dash/stores", headers=_auth(area))
    assert {s["id"] for s in r.json()} == {HOME, SECOND}

    r = client.post("/api/dash/brand/switch", json={"tenant_id": SECOND}, headers=_auth(area))
    assert r.status_code == 200, r.text
    switched = r.json()["token"]
    assert client.get("/api/tenant/info", headers=_auth(switched)).json()["id"] == SECOND

    r = client.post("/api/dash/brand/switch", json={"tenant_id": OUTSIDE}, headers=_auth(area))
    assert r.status_code == 403, r.text

    # Owner takes the second store away: the already-issued token for it
    # stops working at once.
    r = client.patch(f"/api/dash/team/{member['id']}", json={"store_ids": [HOME]}, headers=_auth(owner))
    assert r.status_code == 200, r.text
    assert client.get("/api/tenant/info", headers=_auth(switched)).status_code == 401
    assert client.get("/api/dash/auth/me", headers=_auth(switched)).status_code == 401


def test_manager_is_held_to_one_store(client, world):
    owner = _login(client, world["owner"])["token"]
    r = client.patch(f"/api/dash/team/da_manager_{SUFFIX}",
                     json={"store_ids": [HOME, SECOND]}, headers=_auth(owner))
    assert r.status_code == 400, r.text
    mgr = _login(client, world["manager"])["token"]
    r = client.post("/api/dash/brand/switch", json={"tenant_id": SECOND}, headers=_auth(mgr))
    assert r.status_code == 403, r.text


def test_owner_cannot_assign_a_store_outside_their_brand(client, world):
    owner = _login(client, world["owner"])["token"]
    r = client.post("/api/dash/team", json={
        "email": f"bad{SUFFIX}@acc.test", "name": "Bad", "dash_role": "manager",
        "store_ids": [OUTSIDE],
    }, headers=_auth(owner))
    assert r.status_code == 403, r.text


def test_owner_sees_every_store_in_brand(client, world):
    owner = _login(client, world["owner"])["token"]
    r = client.get("/api/dash/stores", headers=_auth(owner))
    assert r.status_code == 200, r.text
    assert {s["id"] for s in r.json()} == {HOME, SECOND}


def test_deactivated_member_loses_access(client, world):
    owner = _login(client, world["owner"])["token"]
    email = f"temp{SUFFIX}@acc.test"
    r = client.post("/api/dash/team", json={
        "email": email, "name": "Temp", "dash_role": "manager", "store_ids": [SECOND],
    }, headers=_auth(owner))
    assert r.status_code == 200, r.text
    mid, pw = r.json()["member"]["id"], r.json()["temp_password"]
    tok = client.post("/api/dash/auth/login", json={"email": email, "password": pw}).json()["token"]
    assert client.get("/api/tenant/info", headers=_auth(tok)).json()["id"] == SECOND
    r = client.patch(f"/api/dash/team/{mid}", json={"active": False}, headers=_auth(owner))
    assert r.status_code == 200, r.text
    assert client.get("/api/tenant/info", headers=_auth(tok)).status_code == 401


def test_every_gated_route_exists():
    """A typo or renamed route in dash_access._RULES would silently ungate it."""
    from server import app
    import dash_access
    real = {getattr(r, "path", None) for r in app.routes}
    missing = [p for p in dash_access.all_rule_paths() if p not in real]
    assert not missing, missing
