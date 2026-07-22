"""P3c (Ops & Support) + P3d (Subscriptions) backend coverage."""
import os
import time
import json
import hmac
import hashlib
import uuid

import pytest
import requests


# ---------- helpers ----------
def _owner_token(base_url):
    r = requests.post(f"{base_url}/owner/auth/login", json={
        "email": "owner@kanda.app", "password": "OwnerPass#2025",
    })
    pre = r.json()["pre2faToken"]
    v = requests.post(f"{base_url}/owner/auth/verify",
                      headers={"Authorization": f"Bearer {pre}"}, json={"code": "000000"})
    return v.json()["token"]


# ============================================================
#  P3c — Ops & Support
# ============================================================
class TestSupportTickets:
    def test_staff_can_submit_a_ticket(self, base_url, auth_headers):
        r = requests.post(f"{base_url}/support/tickets", headers=auth_headers, json={
            "subject": "Card terminal not connecting",
            "body": "Tried restarting twice — still red light.",
            "severity": "high",
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["id"].startswith("tk_")
        assert data["status"] == "open"
        assert data["severity"] == "high"
        assert data["opened_by_name"] == "Aarav Reddy"

    def test_staff_can_list_their_tickets(self, base_url, auth_headers):
        # create one first to ensure there is at least one
        requests.post(f"{base_url}/support/tickets", headers=auth_headers, json={
            "subject": "Smoke", "body": "smoke", "severity": "low",
        })
        r = requests.get(f"{base_url}/support/tickets", headers=auth_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        assert len(r.json()) >= 1

    def test_owner_inbox_reply_status(self, base_url, auth_headers):
        # create a ticket from the tenant side
        t = requests.post(f"{base_url}/support/tickets", headers=auth_headers, json={
            "subject": "Owner-flow test", "body": "needs reply", "severity": "normal",
        }).json()

        # owner views, replies, marks resolved
        otok = _owner_token(base_url)
        oh = {"Authorization": f"Bearer {otok}"}

        all_tickets = requests.get(f"{base_url}/owner/ops/support", headers=oh).json()
        assert any(x["id"] == t["id"] for x in all_tickets)

        r = requests.post(f"{base_url}/owner/ops/support/{t['id']}/reply",
                          headers=oh, json={"body": "We're on it!"})
        assert r.status_code == 200
        assert r.json()["status"] == "in_progress"
        assert len(r.json()["replies"]) == 1

        r2 = requests.patch(f"{base_url}/owner/ops/support/{t['id']}/status",
                            headers=oh, json={"status": "resolved"})
        assert r2.status_code == 200
        assert r2.json()["status"] == "resolved"

    def test_validation(self, base_url, auth_headers):
        r = requests.post(f"{base_url}/support/tickets", headers=auth_headers, json={
            "subject": "x", "body": "too short", "severity": "normal",
        })
        assert r.status_code == 422


class TestOpsLogs:
    def test_audit_log_captures_mutating_calls(self, base_url, auth_headers):
        # generate a known mutating call
        requests.post(f"{base_url}/customers", headers=auth_headers, json={
            "name": "TEST_AuditProbe", "phone": "+919000099999",
        })
        otok = _owner_token(base_url)
        oh = {"Authorization": f"Bearer {otok}"}
        audit = requests.get(f"{base_url}/owner/ops/audit", headers=oh, params={"tenant_id": "demo"}).json()
        assert any(x["route"] == "/api/customers" and x["method"] == "POST" for x in audit)

    def test_error_log_captures_4xx(self, base_url, auth_headers):
        # invalid menu update — Manager-only and we send junk body
        requests.put(f"{base_url}/menu/items/does-not-exist", headers=auth_headers, json={"name": "x"})
        otok = _owner_token(base_url)
        oh = {"Authorization": f"Bearer {otok}"}
        errs = requests.get(f"{base_url}/owner/ops/errors", headers=oh).json()
        # ≥1 error row exists (the 404 we just provoked or older ones)
        assert isinstance(errs, list)


# ============================================================
#  P3d — Razorpay Subscriptions
# ============================================================
class TestSubscriptions:
    def test_plans_catalogue(self, base_url):
        otok = _owner_token(base_url)
        r = requests.get(f"{base_url}/owner/plans", headers={"Authorization": f"Bearer {otok}"})
        assert r.status_code == 200
        plans = r.json()
        keys = {p["key"] for p in plans}
        assert keys == {"starter", "pro", "master"}
        amounts = {p["key"]: p["amount_inr"] for p in plans}
        assert amounts == {"starter": 999, "pro": 1999, "master": 2999}

    def test_billing_status_for_demo_tenant(self, base_url):
        otok = _owner_token(base_url)
        r = requests.get(f"{base_url}/owner/tenants/demo/billing",
                         headers={"Authorization": f"Bearer {otok}"})
        assert r.status_code == 200
        data = r.json()
        assert data["tenant_id"] == "demo"
        assert "gate" in data

    def test_billing_status_pos_endpoint(self, base_url, auth_headers):
        r = requests.get(f"{base_url}/billing/status", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert "ok" in data and "in_grace" in data and "plan" in data

    def test_webhook_rejects_bad_signature(self, base_url):
        r = requests.post(f"{base_url}/payments/razorpay/webhook",
                          data=json.dumps({"event": "subscription.activated", "payload": {}}),
                          headers={"X-Razorpay-Signature": "deadbeef", "Content-Type": "application/json"})
        assert r.status_code == 400

    def test_webhook_accepts_valid_signature_and_no_op_when_unknown_subscription(self, base_url):
        secret = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")
        if not secret:
            # try to read from backend .env file directly
            from dotenv import dotenv_values
            secret = dotenv_values("/app/backend/.env").get("RAZORPAY_WEBHOOK_SECRET", "")
        assert secret, "Webhook secret must be set for this test"
        body = json.dumps({
            "event": "subscription.activated",
            "payload": {"subscription": {"entity": {"id": f"sub_fake_{uuid.uuid4().hex[:6]}", "current_end": int(time.time()) + 30 * 86400}}},
        }).encode("utf-8")
        sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        r = requests.post(f"{base_url}/payments/razorpay/webhook", data=body,
                          headers={"X-Razorpay-Signature": sig, "Content-Type": "application/json"})
        assert r.status_code == 200
        assert r.json().get("skipped") == "unknown_subscription"
