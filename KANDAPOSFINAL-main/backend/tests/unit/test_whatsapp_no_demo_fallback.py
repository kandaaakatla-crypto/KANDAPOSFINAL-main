"""An incoming WhatsApp message to a number no store owns was filed under the
public demo store, so a real customer's message (name, phone, text) landed
in an inbox anyone with the published demo logins could read. Unmatched
messages are now dropped.
"""
import os
import uuid

from pymongo import MongoClient
from twilio.request_validator import RequestValidator


def _post_signed(client, monkeypatch, form):
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "unit-test-twilio-token")
    monkeypatch.delenv("TWILIO_SIGNATURE_VALIDATION", raising=False)
    monkeypatch.delenv("PUBLIC_BACKEND_URL", raising=False)
    url = "http://testserver/api/whatsapp/incoming"
    sig = RequestValidator("unit-test-twilio-token").compute_signature(url, form)
    return client.post("/api/whatsapp/incoming", data=form, headers={"X-Twilio-Signature": sig})


def test_message_to_an_unknown_number_is_not_filed_under_the_demo_store(client, db_name, monkeypatch):
    phone = f"+9198{uuid.uuid4().int % 10**8:08d}"
    r = _post_signed(client, monkeypatch, {
        "From": f"whatsapp:{phone}", "To": "whatsapp:+919999000111",
        "Body": "Hi, is the restaurant open?", "MessageSid": f"SM{uuid.uuid4().hex}", "NumMedia": "0",
    })
    assert r.status_code == 200, r.text
    db = MongoClient(os.environ["MONGO_URL"])[db_name]
    assert db.wa_conversations.count_documents({"phone": phone}) == 0
    assert db.wa_messages.count_documents({"phone": phone}) == 0
