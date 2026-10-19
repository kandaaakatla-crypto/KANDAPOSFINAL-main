"""SMS is off for launch. Kanda still sent SMS from several places (order
confirmations after phone orders, reservation reminders, birthday bonuses,
manager broadcasts, OTP codes) whenever Twilio credentials were present, and
without them the OTP endpoint handed the code back in its own response, so
anyone could sign in as any phone number and read its order history. Every
SMS now goes nowhere unless SMS_ENABLED=1, and SMS sign-in is refused.
"""
import asyncio

import pytest

import sms_service


SENT = []


class _FakeTwilio:
    class messages:  # noqa: N801
        @staticmethod
        def create(**kw):
            SENT.append(kw)
            return type("Msg", (), {"sid": "SM1"})()


@pytest.fixture
def twilio_present(monkeypatch):
    monkeypatch.delenv("SMS_ENABLED", raising=False)
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "ACx")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "tok")
    monkeypatch.setenv("TWILIO_FROM_NUMBER", "+15550001111")
    SENT.clear()
    monkeypatch.setattr(sms_service, "_get_client", lambda: _FakeTwilio)


def test_send_sms_does_nothing_while_off(twilio_present):
    assert asyncio.run(sms_service.send_sms("+919876543210", "hi")) is False
    res = asyncio.run(sms_service.send_sms_detailed("+919876543210", "hi"))
    assert res["ok"] is False and "off" in res["error"].lower()
    assert SENT == []


def test_status_says_sms_is_off(twilio_present):
    ok, reason = sms_service.sms_configured()
    assert ok is False and "off" in reason.lower()


def test_sms_sign_in_is_refused_and_never_leaks_a_code(client, monkeypatch):
    monkeypatch.delenv("SMS_ENABLED", raising=False)
    monkeypatch.delenv("TWILIO_ACCOUNT_SID", raising=False)
    r = client.post("/api/storefront/demo/otp/request", json={"name": "X", "phone": "9876543210"})
    assert r.status_code == 410, r.text
    assert "dev_code" not in r.text
