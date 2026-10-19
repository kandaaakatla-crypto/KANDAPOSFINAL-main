"""Any store could put another store's phone number into its AI phone agent
settings. Incoming calls are routed by that number, so the second store could
take the first store's calls, orders and caller details. The numbers list also
showed every store's name next to the number it uses. A number already used
by another store can no longer be claimed, and the list no longer names
other stores.
"""
import os
import uuid
from types import SimpleNamespace

import bcrypt
import pytest
from pymongo import MongoClient

import routes.voice as voice

PW = "Passw0rd!x"
SUFFIX = uuid.uuid4().hex[:6]
A, B = f"vna{SUFFIX}", f"vnb{SUFFIX}"
A_NUM = "+15550001" + SUFFIX[:3].translate(str.maketrans("abcdef", "123456"))


@pytest.fixture(scope="module")
def stores(client, db_name):
    d = MongoClient(os.environ["MONGO_URL"])[db_name]
    d.tenants.insert_one({"id": A, "slug": A, "name": "Store A Secret Name", "business_type": "restaurant",
                          "features": {}, "voice": {"twilio_number": A_NUM, "enabled": True}})
    d.tenants.insert_one({"id": B, "slug": B, "name": "Store B", "business_type": "restaurant", "features": {}})
    d.dashboard_users.insert_one({
        "id": f"da_b_{SUFFIX}", "email": f"b{SUFFIX}@vn.test", "name": "Owner B", "dash_role": "owner",
        "tenant_id": B, "password_hash": bcrypt.hashpw(PW.encode(), bcrypt.gensalt()).decode(),
        "active": True, "must_change_password": False, "location_ids": [],
    })
    r = client.post("/api/dash/auth/login", json={"email": f"b{SUFFIX}@vn.test", "password": PW})
    assert r.status_code == 200, r.text
    return {"h": {"Authorization": f"Bearer {r.json()['token']}"}, "db": d}


def test_cannot_claim_another_stores_number(client, stores):
    r = client.put("/api/voice/config", json={"twilio_number": A_NUM}, headers=stores["h"])
    assert r.status_code == 409, r.text
    assert stores["db"].tenants.find_one({"id": B}).get("voice", {}).get("twilio_number") in (None, "")


def test_can_claim_a_free_number(client, stores):
    r = client.put("/api/voice/config", json={"twilio_number": "+15559990000"}, headers=stores["h"])
    assert r.status_code == 200, r.text
    assert r.json()["twilio_number"] == "+15559990000"


def test_numbers_list_does_not_name_other_stores(client, stores, monkeypatch):
    fake_num = SimpleNamespace(sid="PN1", phone_number=A_NUM, friendly_name="x", voice_url="", sms_url="",
                               capabilities={"voice": True})
    fake = SimpleNamespace(incoming_phone_numbers=SimpleNamespace(list=lambda limit=100: [fake_num]))
    monkeypatch.setattr(voice, "_twilio_client", lambda: fake)
    r = client.get("/api/voice/numbers/owned", headers=stores["h"])
    assert r.status_code == 200, r.text
    assert "Store A Secret Name" not in r.text and A not in r.text
    assert r.json()["results"][0]["claimed_by"] == {"other_store": True}
