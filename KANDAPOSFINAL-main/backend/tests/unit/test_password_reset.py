"""Self-service password reset for restaurant owners: emailed single-use link,
30-minute expiry. Managers / area managers are reset by their owner on the Team
screen instead, so they never get a self-service email."""
import os
import re
import uuid

import bcrypt
import pytest
from pymongo import MongoClient

PW = "Passw0rd!x"
SUFFIX = uuid.uuid4().hex[:6]
TENANT = f"pwreset{SUFFIX}"


@pytest.fixture(scope="module")
def world(client, db_name):
    m = MongoClient(os.environ["MONGO_URL"])
    d = m[db_name]
    d.tenants.insert_one({"id": TENANT, "slug": TENANT, "name": TENANT, "status": "active",
                          "business_type": "restaurant", "features": {}})
    h = bcrypt.hashpw(PW.encode(), bcrypt.gensalt()).decode()
    for key, role in (("owner", "owner"), ("mgr", "manager")):
        d.dashboard_users.insert_one({"id": f"da_{key}_{SUFFIX}", "email": f"{key}{SUFFIX}@pw.test", "name": key,
                                      "password_hash": h, "active": True, "must_change_password": False,
                                      "location_ids": [], "dash_role": role, "tenant_id": TENANT})
    yield {"owner": f"owner{SUFFIX}@pw.test", "mgr": f"mgr{SUFFIX}@pw.test", "db": d}
    m.close()


@pytest.fixture()
def outbox(monkeypatch):
    sent = []

    async def fake_send(to, subject, html):
        sent.append({"to": to, "subject": subject, "html": html})
        return {"id": "x"}

    monkeypatch.setattr("routes.dash_auth.send_email", fake_send)
    return sent


def _token(html):
    return re.search(r"token=([A-Za-z0-9_\-]+)", html).group(1)


def test_owner_can_reset_and_token_is_single_use(client, world, outbox):
    r = client.post("/api/dash/auth/forgot", json={"email": world["owner"]})
    assert r.status_code == 200, r.text
    assert len(outbox) == 1 and outbox[0]["to"] == world["owner"]
    tok = _token(outbox[0]["html"])

    assert client.post("/api/dash/auth/reset", json={"token": tok, "new_password": "short"}).status_code == 400
    ok = client.post("/api/dash/auth/reset", json={"token": tok, "new_password": "BrandNew#2026"})
    assert ok.status_code == 200, ok.text
    login = client.post("/api/dash/auth/login", json={"email": world["owner"], "password": "BrandNew#2026"})
    assert login.status_code == 200, login.text
    assert client.post("/api/dash/auth/login", json={"email": world["owner"], "password": PW}).status_code == 401
    again = client.post("/api/dash/auth/reset", json={"token": tok, "new_password": "Another#2026x"})
    assert again.status_code == 400  # already used


def test_unknown_and_non_owner_get_the_same_answer_and_no_email(client, world, outbox):
    for email in ("nobody@pw.test", world["mgr"]):
        r = client.post("/api/dash/auth/forgot", json={"email": email})
        assert r.status_code == 200 and r.json() == {"ok": True}
    assert outbox == []


def test_expired_token_rejected(client, world, outbox):
    client.post("/api/dash/auth/forgot", json={"email": world["owner"]})
    tok = _token(outbox[-1]["html"])
    world["db"].password_resets.update_many({}, {"$set": {"expires_at": "2000-01-01T00:00:00+00:00"}})
    r = client.post("/api/dash/auth/reset", json={"token": tok, "new_password": "Whatever#2026"})
    assert r.status_code == 400
