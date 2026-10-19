"""The AI phone agent recorded every call without telling the caller, and its
instructions told it to deny being automated ("say you're the staff on
duty") even when a caller asked. Callers now hear that the call may be
recorded before the agent picks up, and the agent answers honestly if asked
whether it is a person.
"""
import os
import uuid

from pymongo import MongoClient
from twilio.request_validator import RequestValidator

from routes.voice import _system_instructions

TENANT = {"id": "t", "name": "Spice Hub", "store": {"name": "Spice Hub"}, "voice": {"default_language": "en"}}


def test_agent_is_not_told_to_deny_being_automated():
    text = _system_instructions(TENANT, "menu")
    assert "say you're the staff on duty" not in text
    assert "NEVER mention you are an AI" not in text
    assert "if a caller asks" in text.lower() and "automated" in text.lower()


def test_outbound_agent_mentions_recording_and_is_honest():
    text = _system_instructions(TENANT, "menu", outbound_ctx={"purpose": "order ready"})
    assert "Do NOT mention that you are an AI" not in text
    assert "recorded" in text


def test_inbound_caller_hears_recording_notice_before_the_agent(client, db_name, monkeypatch):
    num = "+1555" + str(uuid.uuid4().int % 10**7).zfill(7)
    d = MongoClient(os.environ["MONGO_URL"])[db_name]
    tid = f"vd{uuid.uuid4().hex[:6]}"
    d.tenants.insert_one({"id": tid, "slug": tid, "name": "Spice Hub", "features": {},
                          "voice": {"twilio_number": num, "enabled": True}})
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "unit-test-twilio-token")
    monkeypatch.delenv("PUBLIC_BACKEND_URL", raising=False)
    form = {"To": num, "From": "+919000000009", "CallSid": "CA" + uuid.uuid4().hex}
    url = "http://testserver/api/voice/twilio-incoming"
    sig = RequestValidator("unit-test-twilio-token").compute_signature(url, form)
    r = client.post("/api/voice/twilio-incoming", data=form, headers={"X-Twilio-Signature": sig})
    assert r.status_code == 200, r.text
    xml = r.text
    assert "<Say" in xml and "recorded" in xml
    assert xml.index("<Say") < xml.index("<Connect")
