"""Tests for /api/whatsapp/* — two-way WhatsApp chat via Twilio (iteration 14)."""

import pytest

pytestmark = pytest.mark.integration
import os
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path
from twilio.request_validator import RequestValidator

load_dotenv(Path("/app/frontend/.env"))
load_dotenv(Path("/app/backend/.env"))
API = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") + "/api"
TENANT = {"X-Tenant-Slug": "demo"}
TEST_PHONE = "+916303435484"


def _sign(url: str, params: dict) -> str:
    return RequestValidator(os.environ["TWILIO_AUTH_TOKEN"]).compute_signature(url, params)


@pytest.fixture(scope="module")
def mgr_headers():
    r = requests.post(f"{API}/auth/login", json={"pin": "1234"}, headers=TENANT, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}", **TENANT}


# --- /whatsapp/send ---
def test_send_requires_auth():
    r = requests.post(f"{API}/whatsapp/send", json={"to": TEST_PHONE, "body": "hi"}, timeout=15)
    assert r.status_code in (401, 403)


def test_send_manager_returns_message_shape(mgr_headers):
    r = requests.post(
        f"{API}/whatsapp/send",
        json={"to": TEST_PHONE, "body": "iter14 whatsapp test"},
        headers=mgr_headers,
        timeout=45,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert set(["ok", "message", "error"]).issubset(j.keys())
    m = j["message"]
    for k in ("id", "body", "direction", "status", "at", "conversation_id", "phone"):
        assert k in m, f"missing {k} in message: {m}"
    assert m["direction"] == "out"
    assert m["body"] == "iter14 whatsapp test"
    # JSON serialisable — no ObjectId leaked
    assert "_id" not in m
    # Persisted regardless: status is 'sent' if ok, else 'failed'
    if j["ok"]:
        assert m["status"] == "sent"
        assert j["error"] is None
    else:
        assert m["status"] == "failed"
        assert isinstance(j["error"], str) and len(j["error"]) > 0


# --- /whatsapp/conversations/start ---
def test_conversations_start_upserts(mgr_headers):
    r = requests.post(
        f"{API}/whatsapp/conversations/start",
        json={"to": TEST_PHONE, "body": "seed"},
        headers=mgr_headers, timeout=15,
    )
    assert r.status_code == 200, r.text
    conv = r.json()
    for k in ("id", "tenant_id", "phone", "unread_count"):
        assert k in conv, f"missing {k}"
    assert conv["phone"] == TEST_PHONE
    assert conv["unread_count"] == 0
    assert "_id" not in conv


# --- /whatsapp/conversations (list) ---
def test_list_conversations_sorted(mgr_headers):
    r = requests.get(f"{API}/whatsapp/conversations", headers=mgr_headers, timeout=15)
    assert r.status_code == 200
    rows = r.json()
    assert isinstance(rows, list)
    assert len(rows) > 0, "expected at least the seeded conversation"
    ats = [row.get("last_at", "") for row in rows]
    assert ats == sorted(ats, reverse=True), "conversations not sorted last_at desc"
    for row in rows:
        assert "_id" not in row


def test_list_conversations_requires_auth():
    r = requests.get(f"{API}/whatsapp/conversations", timeout=15)
    assert r.status_code in (401, 403)


# --- /whatsapp/conversations/{id}/messages ---
def test_messages_and_read(mgr_headers):
    # Find the conv we just created
    convs = requests.get(f"{API}/whatsapp/conversations", headers=mgr_headers, timeout=15).json()
    conv = next((c for c in convs if c["phone"] == TEST_PHONE), None)
    assert conv is not None
    r = requests.get(
        f"{API}/whatsapp/conversations/{conv['id']}/messages",
        headers=mgr_headers, timeout=15,
    )
    assert r.status_code == 200
    j = r.json()
    assert "conversation" in j and "messages" in j
    assert j["conversation"]["id"] == conv["id"]
    assert isinstance(j["messages"], list)
    for m in j["messages"]:
        assert "_id" not in m

    # 404 for unknown
    bad = requests.get(f"{API}/whatsapp/conversations/wac_doesnotexist/messages",
                       headers=mgr_headers, timeout=15)
    assert bad.status_code == 404

    # Read
    rd = requests.post(f"{API}/whatsapp/conversations/{conv['id']}/read",
                       headers=mgr_headers, timeout=15)
    assert rd.status_code == 200
    assert rd.json().get("ok") is True

    bad_rd = requests.post(f"{API}/whatsapp/conversations/wac_nope/read",
                           headers=mgr_headers, timeout=15)
    assert bad_rd.status_code == 404


# --- /whatsapp/incoming (signed webhook) ---
def test_incoming_webhook_signed(mgr_headers):
    url = f"{API}/whatsapp/incoming"
    from_phone = "+919000111133"
    params = {
        "From": f"whatsapp:{from_phone}",
        "To": "whatsapp:+14155238886",
        "Body": "hello from customer iter14",
        "MessageSid": "SMtestwa123",
        "ProfileName": "Iter14 Tester",
        "NumMedia": "0",
    }
    r = requests.post(
        url, data=params,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Twilio-Signature": _sign(url, params),
        }, timeout=15,
    )
    assert r.status_code == 200, r.text
    assert "<Response" in r.text

    # Verify conversation bumped
    convs = requests.get(f"{API}/whatsapp/conversations", headers=mgr_headers, timeout=15).json()
    conv = next((c for c in convs if c["phone"] == from_phone), None)
    assert conv is not None, "incoming did not create conversation"
    assert conv["unread_count"] >= 1
    # message present with direction=in
    msgs = requests.get(f"{API}/whatsapp/conversations/{conv['id']}/messages",
                        headers=mgr_headers, timeout=15).json()["messages"]
    assert any(m["direction"] == "in" and "hello from customer" in m["body"] for m in msgs)


def test_incoming_bad_signature_rejected():
    r = requests.post(
        f"{API}/whatsapp/incoming",
        data={"From": "whatsapp:+919000111144", "To": "whatsapp:+14155238886", "Body": "spoof"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=15,
    )
    assert r.status_code == 403
