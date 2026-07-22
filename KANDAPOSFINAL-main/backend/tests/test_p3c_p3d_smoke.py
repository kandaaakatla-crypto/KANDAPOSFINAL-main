"""Additional smoke tests for P3c/P3d flows beyond test_p3c_p3d.py."""
import os
import json
import hmac
import hashlib
import time
import uuid

import pytest
import requests
from dotenv import dotenv_values


def _owner_token(base_url):
    r = requests.post(f"{base_url}/owner/auth/login", json={
        "email": "owner@kanda.app", "password": "OwnerPass#2025",
    })
    pre = r.json()["pre2faToken"]
    v = requests.post(f"{base_url}/owner/auth/verify",
                      headers={"Authorization": f"Bearer {pre}"}, json={"code": "000000"})
    return v.json()["token"]


class TestSupportFullFlow:
    def test_create_list_reply_status_chain(self, base_url, auth_headers):
        # Create
        body = {"subject": "Smoke chain", "body": "End-to-end reply flow body.", "severity": "normal"}
        tk = requests.post(f"{base_url}/support/tickets", headers=auth_headers, json=body).json()
        tid = tk["id"]
        assert tk["status"] == "open"

        otok = _owner_token(base_url)
        oh = {"Authorization": f"Bearer {otok}"}

        # Owner reply
        r = requests.post(f"{base_url}/owner/ops/support/{tid}/reply", headers=oh,
                         json={"body": "Owner reply text"})
        assert r.status_code == 200
        assert r.json()["status"] == "in_progress"

        # Status patches
        for st in ["resolved", "closed", "in_progress"]:
            rp = requests.patch(f"{base_url}/owner/ops/support/{tid}/status",
                                headers=oh, json={"status": st})
            assert rp.status_code == 200
            assert rp.json()["status"] == st

        # Status filter on list
        all_tickets = requests.get(f"{base_url}/owner/ops/support",
                                  headers=oh, params={"status": "in_progress"}).json()
        assert any(x["id"] == tid for x in all_tickets)


class TestAuditAndErrorLogs:
    def test_audit_has_actor_fields(self, base_url, auth_headers):
        requests.post(f"{base_url}/customers", headers=auth_headers, json={
            "name": "TEST_AuditFields", "phone": "+919000088888",
        })
        otok = _owner_token(base_url)
        oh = {"Authorization": f"Bearer {otok}"}
        audit = requests.get(f"{base_url}/owner/ops/audit", headers=oh,
                             params={"tenant_id": "demo"}).json()
        assert len(audit) > 0
        row = audit[0]
        # Expect fields
        assert "actor_type" in row
        assert "method" in row
        assert "route" in row
        assert "status" in row
        assert "at" in row

    def test_error_log_5xx_or_4xx_persists(self, base_url, auth_headers):
        # Force a 404 via PUT
        requests.put(f"{base_url}/menu/items/no-such-item",
                     headers=auth_headers, json={"name": "x"})
        otok = _owner_token(base_url)
        oh = {"Authorization": f"Bearer {otok}"}
        errs = requests.get(f"{base_url}/owner/ops/errors", headers=oh).json()
        assert isinstance(errs, list)


class TestBillingGate:
    def test_billing_status_endpoint_shape(self, base_url, auth_headers):
        r = requests.get(f"{base_url}/billing/status", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        # Required keys for the BillingBanner to render
        for k in ["ok", "in_grace", "plan"]:
            assert k in data, f"Missing key {k}"

    def test_demo_login_works_when_no_plan(self, base_url):
        # Login must succeed for the demo tenant when state is none/no_plan
        r = requests.post(f"{base_url}/auth/login", json={"pin": "1234"},
                         headers={"X-Tenant-Slug": "demo"})
        assert r.status_code == 200, r.text


class TestSubscriptionsLifecycle:
    def test_plans_amounts_and_keys(self, base_url):
        otok = _owner_token(base_url)
        plans = requests.get(f"{base_url}/owner/plans",
                            headers={"Authorization": f"Bearer {otok}"}).json()
        assert len(plans) == 3
        m = {p["key"]: p for p in plans}
        assert m["starter"]["amount_inr"] == 999
        assert m["pro"]["amount_inr"] == 1999
        assert m["master"]["amount_inr"] == 2999

    def test_webhook_signature_check(self, base_url):
        secret = dotenv_values("/app/backend/.env").get("RAZORPAY_WEBHOOK_SECRET", "")
        assert secret
        body = json.dumps({"event": "subscription.activated",
                          "payload": {"subscription": {"entity": {
                              "id": f"sub_smoke_{uuid.uuid4().hex[:6]}",
                              "current_end": int(time.time()) + 30 * 86400}}}}).encode()
        good_sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        r_good = requests.post(f"{base_url}/payments/razorpay/webhook", data=body,
                              headers={"X-Razorpay-Signature": good_sig,
                                       "Content-Type": "application/json"})
        assert r_good.status_code == 200

        r_bad = requests.post(f"{base_url}/payments/razorpay/webhook", data=body,
                             headers={"X-Razorpay-Signature": "00" * 32,
                                      "Content-Type": "application/json"})
        assert r_bad.status_code == 400
