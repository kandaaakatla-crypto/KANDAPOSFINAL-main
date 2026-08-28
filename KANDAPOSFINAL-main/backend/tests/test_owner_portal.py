"""P3b - Platform Owner Portal end-to-end backend tests.

Covers: two-step login (password + TOTP bypass), KPIs, tenants list/detail,
tenant create with auto Manager seed, impersonation full vs auditor write-block.
"""

import pytest

pytestmark = pytest.mark.integration
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_EMAIL = "owner@kanda.app"
OWNER_PASS = "OwnerPass#2025"
OWNER_TOTP = "000000"  # test bypass


# ---------- session-scoped owner token ----------
@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{API}/owner/auth/login", json={
        "email": OWNER_EMAIL, "password": OWNER_PASS,
    }, timeout=10)
    assert r.status_code == 200, r.text
    pre = r.json()["pre2faToken"]
    assert isinstance(pre, str) and len(pre) > 0

    v = requests.post(f"{API}/owner/auth/verify",
                      json={"code": OWNER_TOTP},
                      headers={"Authorization": f"Bearer {pre}"},
                      timeout=10)
    assert v.status_code == 200, v.text
    data = v.json()
    assert data["owner"]["email"] == OWNER_EMAIL
    return data["token"]


@pytest.fixture()
def owner_h(owner_token):
    return {"Authorization": f"Bearer {owner_token}"}


# ---------- Auth ----------
class TestOwnerAuth:
    def test_login_bad_password(self):
        r = requests.post(f"{API}/owner/auth/login", json={
            "email": OWNER_EMAIL, "password": "nope"})
        assert r.status_code == 401

    def test_login_unknown_email(self):
        r = requests.post(f"{API}/owner/auth/login", json={
            "email": "nobody@kanda.app", "password": "x"})
        assert r.status_code == 401

    def test_verify_requires_pre2fa(self):
        r = requests.post(f"{API}/owner/auth/verify", json={"code": "000000"})
        assert r.status_code == 401

    def test_verify_bad_totp(self):
        r = requests.post(f"{API}/owner/auth/login", json={
            "email": OWNER_EMAIL, "password": OWNER_PASS}).json()
        v = requests.post(f"{API}/owner/auth/verify", json={"code": "111111"},
                          headers={"Authorization": f"Bearer {r['pre2faToken']}"})
        assert v.status_code == 401

    def test_me(self, owner_h):
        r = requests.get(f"{API}/owner/auth/me", headers=owner_h)
        assert r.status_code == 200
        assert r.json()["email"] == OWNER_EMAIL

    def test_me_requires_owner_token(self):
        r = requests.get(f"{API}/owner/auth/me")
        assert r.status_code == 401


# ---------- KPIs + Tenants ----------
class TestOwnerKpisAndTenants:
    def test_kpis(self, owner_h):
        r = requests.get(f"{API}/owner/kpis", headers=owner_h)
        assert r.status_code == 200
        d = r.json()
        for k in ("totalTenants", "activeTenants", "activeToday",
                  "gmvToday", "ordersToday", "gmvMonth", "ordersMonth"):
            assert k in d
        assert d["totalTenants"] >= 1  # demo tenant

    def test_kpis_requires_owner(self):
        assert requests.get(f"{API}/owner/kpis").status_code == 401

    def test_tenants_list_has_demo(self, owner_h):
        r = requests.get(f"{API}/owner/tenants", headers=owner_h)
        assert r.status_code == 200
        slugs = [t["slug"] for t in r.json()]
        assert "demo" in slugs

    def test_demo_detail(self, owner_h):
        r = requests.get(f"{API}/owner/tenants/demo", headers=owner_h)
        assert r.status_code == 200
        d = r.json()
        assert d["tenant"]["slug"] == "demo"
        for k in ("ordersToday", "ordersMonth", "gmvToday", "gmvMonth",
                  "menuItems", "customers", "lowStockItems"):
            assert k in d["kpis"]
        assert isinstance(d["staff"], list) and len(d["staff"]) >= 1

    def test_tenant_404(self, owner_h):
        assert requests.get(f"{API}/owner/tenants/no_such",
                            headers=owner_h).status_code == 404


# ---------- Create tenant ----------
class TestCreateTenant:
    SLUG = f"qatest{int(time.time()) % 100000}"

    def test_create_tenant_and_manager_login(self, owner_h):
        slug = self.SLUG
        payload = {
            "slug": slug,
            "name": "QA Test Pizza",
            "contact_email": "qa@kanda.app",
            "store": {"name": "QA Test Pizza",
                      "address": "1 QA Lane",
                      "phone": "+91 9000000001",
                      "tax_id": "QATAX",
                      "footer": "thanks"},
            "manager_name": "QA Manager",
            "manager_pin": "9999",
            "plan": "trial",
        }
        r = requests.post(f"{API}/owner/tenants", json=payload, headers=owner_h)
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["slug"] == slug
        assert t["status"] == "active"

        # Appears in list
        listed = requests.get(f"{API}/owner/tenants", headers=owner_h).json()
        assert slug in [x["slug"] for x in listed]

        # Manager can sign in via the tenant POS using PIN 9999
        login = requests.post(f"{API}/auth/login",
                              json={"pin": "9999"},
                              headers={"X-Tenant-Slug": slug})
        assert login.status_code == 200, login.text
        body = login.json()
        assert body["user"]["role"] == "Manager"
        assert body["user"]["name"] == "QA Manager"

    def test_create_tenant_bad_slug(self, owner_h):
        r = requests.post(f"{API}/owner/tenants", json={
            "slug": "Has-Dash", "name": "X",
            "contact_email": "x@y.com",
            "store": {"name": "x", "address": "x", "phone": "x"},
            "manager_pin": "1234",
        }, headers=owner_h)
        assert r.status_code == 400

    def test_create_tenant_bad_pin(self, owner_h):
        r = requests.post(f"{API}/owner/tenants", json={
            "slug": f"badpin{int(time.time())}",
            "name": "X", "contact_email": "x@y.com",
            "store": {"name": "x", "address": "x", "phone": "x"},
            "manager_pin": "ab",
        }, headers=owner_h)
        assert r.status_code == 400

    def test_create_tenant_requires_owner(self):
        r = requests.post(f"{API}/owner/tenants", json={"slug": "x"})
        assert r.status_code == 401


# ---------- Impersonation ----------
class TestImpersonation:
    def test_impersonate_full(self, owner_h):
        r = requests.post(f"{API}/owner/tenants/demo/impersonate",
                          json={"mode": "full"}, headers=owner_h)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["mode"] == "full"
        assert d["tenantSlug"] == "demo"
        assert isinstance(d["token"], str) and len(d["token"]) > 20

        # FULL token can do write ops
        token = d["token"]
        h = {"Authorization": f"Bearer {token}"}
        # create a customer (writeable in full mode)
        cust = requests.post(f"{API}/customers", json={
            "name": "TEST_ImpFull", "phone": "+91 9000000099",
            "pincode": "500001"}, headers=h)
        assert cust.status_code in (200, 201), cust.text

    def test_impersonate_auditor_needs_reason(self, owner_h):
        r = requests.post(f"{API}/owner/tenants/demo/impersonate",
                          json={"mode": "auditor"}, headers=owner_h)
        assert r.status_code == 400

    def test_impersonate_auditor_blocks_writes(self, owner_h):
        r = requests.post(f"{API}/owner/tenants/demo/impersonate",
                          json={"mode": "auditor", "reason": "QA audit run"},
                          headers=owner_h)
        assert r.status_code == 200
        token = r.json()["token"]
        h = {"Authorization": f"Bearer {token}"}

        # GETs should still work (read-only)
        g = requests.get(f"{API}/menu/items", headers=h)
        assert g.status_code == 200

        # POST/PUT/PATCH/DELETE should be blocked with 403
        bad = requests.post(f"{API}/customers", json={
            "name": "TEST_BlockedAuditor",
            "phone": "+91 9000000098",
            "pincode": "500001"}, headers=h)
        assert bad.status_code == 403, bad.text

    def test_impersonate_unknown_tenant(self, owner_h):
        r = requests.post(f"{API}/owner/tenants/no_such/impersonate",
                          json={"mode": "full"}, headers=owner_h)
        assert r.status_code == 404

    def test_impersonate_requires_owner_token(self):
        r = requests.post(f"{API}/owner/tenants/demo/impersonate",
                          json={"mode": "full"})
        assert r.status_code == 401
