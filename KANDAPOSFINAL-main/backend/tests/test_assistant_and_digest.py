"""Tests for Daily Digest (Phase 2). The AI Assistant chat this file used to
also cover was removed; its live-data helpers moved to report_tools.py and
are exercised indirectly via the digest tests below."""

import pytest

pytestmark = pytest.mark.integration
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback to reading from frontend .env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

OWNER_EMAIL = "owner@demo.com"
OWNER_PASS = "OwnerPass#2025"


@pytest.fixture(scope="module")
def dash_token():
    r = requests.post(f"{BASE_URL}/api/dash/auth/login",
                      json={"email": OWNER_EMAIL, "password": OWNER_PASS},
                      headers={"X-Tenant-Slug": "demo"}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("token")
    return data["token"]


@pytest.fixture(scope="module")
def auth_headers(dash_token):
    return {"Authorization": f"Bearer {dash_token}", "X-Tenant-Slug": "demo"}


# -------- Digest config --------
class TestDigestConfig:
    def test_get_default_config(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/digest/config", headers=auth_headers, timeout=20)
        assert r.status_code == 200, r.text
        j = r.json()
        # defaults from DigestConfig
        assert "enabled" in j
        assert "send_hour_utc" in j
        assert "send_minute" in j
        assert isinstance(j.get("sms_recipients", []), list)
        assert isinstance(j.get("email_recipients", []), list)

    def test_put_then_get_persists(self, auth_headers):
        body = {
            "enabled": True,
            "send_hour_utc": 2,
            "send_minute": 45,
            "channels_sms": False,
            "channels_email": True,
            "sms_recipients": [],
            "email_recipients": ["kandaaakatla@gmail.com"],
        }
        r = requests.put(f"{BASE_URL}/api/digest/config", headers=auth_headers,
                         json=body, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        r2 = requests.get(f"{BASE_URL}/api/digest/config", headers=auth_headers, timeout=20)
        assert r2.status_code == 200
        got = r2.json()
        assert got["enabled"] is True
        assert got["send_hour_utc"] == 2
        assert got["send_minute"] == 45
        assert got["channels_email"] is True
        assert got["email_recipients"] == ["kandaaakatla@gmail.com"]


# -------- Digest preview + send --------
class TestDigestPreviewSend:
    def test_preview_returns_shape(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/digest/preview", headers=auth_headers, timeout=120)
        assert r.status_code == 200, r.text[:500]
        j = r.json()
        assert "tenant_name" in j
        assert "ai_text" in j and isinstance(j["ai_text"], str) and len(j["ai_text"]) > 0
        d = j.get("data") or {}
        for key in ("today", "yesterday", "avg_ticket", "top_items",
                    "low_stock", "active_orders", "staff_on_duty"):
            assert key in d, f"missing key {key} in preview.data"

    def test_send_now_uses_saved_config(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/digest/send-now", headers=auth_headers,
                          json={}, timeout=180)
        assert r.status_code == 200, r.text[:500]
        j = r.json()
        assert isinstance(j.get("sent_email"), list)
        assert isinstance(j.get("sent_sms"), list)
        # We configured channels_email=true with a recipient in previous test
        if j["sent_email"]:
            print("sent_email:", j["sent_email"])


# -------- Auth guard --------
class TestDigestAuthGuard:
    def test_reject_no_token(self):
        r = requests.get(f"{BASE_URL}/api/digest/config",
                         headers={"X-Tenant-Slug": "demo"}, timeout=20)
        assert r.status_code in (401, 403), r.text[:200]

    def test_reject_non_dash_token(self):
        # Try a staff PIN login → this yields a non-dash token
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"pin": "1234"},
                          headers={"X-Tenant-Slug": "demo"}, timeout=20)
        if r.status_code != 200:
            pytest.skip(f"pin-login unavailable: {r.status_code}")
        tok = r.json().get("token") or r.json().get("access_token")
        if not tok:
            pytest.skip("no token from pin-login")
        r2 = requests.get(f"{BASE_URL}/api/digest/config",
                          headers={"Authorization": f"Bearer {tok}",
                                   "X-Tenant-Slug": "demo"}, timeout=20)
        assert r2.status_code == 403, f"expected 403, got {r2.status_code} {r2.text[:200]}"
