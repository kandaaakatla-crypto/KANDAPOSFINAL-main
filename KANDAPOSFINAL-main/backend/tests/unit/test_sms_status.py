"""Master Test Report P1: SMS sends "failed - Twilio not configured" yet the UI
let managers keep sending. The server now reports whether SMS is usable."""
import sms_service


def test_not_configured_without_credentials(monkeypatch):
    monkeypatch.setenv("SMS_ENABLED", "1")
    for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"):
        monkeypatch.delenv(k, raising=False)
    ok, reason = sms_service.sms_configured()
    assert ok is False and "Twilio" in reason


def test_needs_a_sender_number(monkeypatch):
    monkeypatch.setenv("SMS_ENABLED", "1")
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "ACx")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "tok")
    monkeypatch.delenv("TWILIO_FROM_NUMBER", raising=False)
    ok, reason = sms_service.sms_configured()
    assert ok is False and "sender" in reason.lower()


def test_configured(monkeypatch):
    monkeypatch.setenv("SMS_ENABLED", "1")
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "ACx")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "tok")
    monkeypatch.setenv("TWILIO_FROM_NUMBER", "+15550001111")
    assert sms_service.sms_configured() == (True, "")
