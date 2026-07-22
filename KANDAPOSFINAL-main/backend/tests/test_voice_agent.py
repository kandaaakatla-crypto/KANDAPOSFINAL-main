"""Voice agent — REST contract tests.

These cover the safe-to-test surface: config CRUD, the Twilio incoming
webhook (which returns TwiML), and the call-log endpoints. The actual
WebSocket bridge to OpenAI Realtime requires live credit on the OpenAI
account and a real phone, so it has its own manual smoke probe at
`tests/manual/probe_voice_bridge.py`.
"""
import os
import re
from dotenv import load_dotenv
from pathlib import Path
from twilio.request_validator import RequestValidator

load_dotenv(Path("/app/backend/.env"))


def _sign(url: str, params: dict) -> str:
    """Produce a valid X-Twilio-Signature for the test's URL+params so the
    webhook signature check accepts our simulated request."""
    validator = RequestValidator(os.environ["TWILIO_AUTH_TOKEN"])
    return validator.compute_signature(url, params)


def test_voice_config_default_shape(authed, base_url):
    r = authed.get(f"{base_url}/voice/config", headers={"X-Tenant-Slug": "demo"})
    assert r.status_code == 200, r.text
    cfg = r.json()
    for k in ("enabled", "twilio_number", "default_language", "voice", "greeting", "persona", "webhook_url"):
        assert k in cfg, f"missing key {k}"
    assert cfg["webhook_url"].endswith("/api/voice/twilio-incoming")


def test_voice_config_update_round_trip_normalises_number(authed, base_url):
    payload = {
        "enabled": True,
        "twilio_number": "19086498077",  # no plus → server should normalise
        "default_language": "hi",
        "greeting": "Namaste, welcome!",
    }
    r = authed.put(f"{base_url}/voice/config", json=payload, headers={"X-Tenant-Slug": "demo"})
    assert r.status_code == 200, r.text
    cfg = r.json()
    assert cfg["enabled"] is True
    assert cfg["twilio_number"] == "+19086498077"
    assert cfg["default_language"] == "hi"
    assert "Namaste" in cfg["greeting"]


def test_twilio_incoming_webhook_returns_twiml(authed, base_url, api_client):
    # Make sure the demo tenant has a matching number wired in.
    authed.put(
        f"{base_url}/voice/config",
        json={"enabled": True, "twilio_number": "+19086498077"},
        headers={"X-Tenant-Slug": "demo"},
    )
    url = f"{base_url}/voice/twilio-incoming"
    params = {"To": "+19086498077", "From": "+14155551234", "CallSid": "CAtestxyz"}
    r = api_client.post(
        url, data=params,
        headers={"Content-Type": "application/x-www-form-urlencoded",
                 "X-Twilio-Signature": _sign(url, params)},
    )
    assert r.status_code == 200, r.text
    body = r.text
    assert "<Response>" in body
    assert "<Connect>" in body
    assert "<Stream " in body
    # After the SEC-001 fix we no longer expose the raw tenant_id — we pass a
    # signed token instead. Verify that.
    assert 'name="token"' in body
    m = re.search(r'url="(wss://[^"]+/api/voice/twilio-stream)"', body)
    assert m, f"Stream wss URL not found in TwiML: {body[:400]}"


def test_twilio_incoming_rejects_missing_signature(api_client, base_url):
    """Anyone hitting the webhook without a valid X-Twilio-Signature must be
    rejected — this is the fix for SEC-001 (unauth OpenAI credit burn)."""
    r = api_client.post(
        f"{base_url}/voice/twilio-incoming",
        data={"To": "+19086498077", "From": "+14155551234", "CallSid": "CAx"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert r.status_code == 403, f"Unsigned webhook should be 403, got {r.status_code}: {r.text}"


def test_twilio_incoming_unknown_number_hangs_up(api_client, base_url):
    url = f"{base_url}/voice/twilio-incoming"
    params = {"To": "+19999999999", "From": "+14155551234", "CallSid": "CAxyz"}
    r = api_client.post(
        url, data=params,
        headers={"Content-Type": "application/x-www-form-urlencoded",
                 "X-Twilio-Signature": _sign(url, params)},
    )
    assert r.status_code == 200
    body = r.text
    assert "<Say" in body
    assert "<Hangup" in body


def test_voice_calls_list_returns_array(authed, base_url):
    r = authed.get(f"{base_url}/voice/calls", headers={"X-Tenant-Slug": "demo"})
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_voice_calls_get_unknown(authed, base_url):
    r = authed.get(f"{base_url}/voice/calls/vc_doesnotexist", headers={"X-Tenant-Slug": "demo"})
    assert r.status_code == 404
