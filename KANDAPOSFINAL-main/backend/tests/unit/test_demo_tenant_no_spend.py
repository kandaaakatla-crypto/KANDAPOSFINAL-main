"""The public demo store's logins are printed on the sign-in pages, and in
production it had SMS, WhatsApp and the AI phone agent switched on. Anyone
could sign in and send SMS/WhatsApp, buy phone numbers or place calls billed
to Kanda's own Twilio/OpenAI accounts. The demo store may not use paid
channels, and they are switched off for it on every boot.
"""
import asyncio
import os

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

PAID = [
    ("post", "/api/sms/send", {"to": "+919000000001", "body": "hi"}),
    ("post", "/api/sms/broadcast", {"body": "hi"}),
    ("put", "/api/voice/config", {"twilio_number": "+15550000000"}),
    ("post", "/api/voice/configure-twilio", {}),
    ("post", "/api/voice/numbers/purchase", {"phone_number": "+15550000000"}),
    ("post", "/api/voice/call", {"to": "+919000000001"}),
    ("post", "/api/whatsapp/send", {"to": "+919000000001", "body": "hi"}),
    ("post", "/api/whatsapp/send-template", {"to": "+919000000001", "template": "x"}),
]


def _manager(client):
    r = client.post("/api/auth/login", json={"pin": "1234"}, headers={"X-Forwarded-For": "203.0.113.151"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.mark.parametrize("method,path,body", PAID)
def test_demo_store_cannot_use_paid_channels(client, method, path, body):
    r = getattr(client, method)(path, json=body, headers=_manager(client))
    assert r.status_code == 403, f"{path}: {r.status_code} {r.text}"
    assert "demo" in r.json()["detail"].lower()


def test_paid_features_are_switched_off_for_the_demo_store(client, db_name):
    async def go():
        m = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            db = m[db_name]
            # Simulate production, where the demo tenant was created with them on.
            await db.tenants.update_one({"id": "demo"}, {"$set": {
                "features.voice_agent": True, "features.customer_sms": True, "features.whatsapp": True}})
            from seed import seed_all
            await seed_all(db)
            return (await db.tenants.find_one({"id": "demo"}))["features"]
        finally:
            m.close()
    f = asyncio.run(go())
    assert (f["voice_agent"], f["customer_sms"], f["whatsapp"]) == (False, False, False)
