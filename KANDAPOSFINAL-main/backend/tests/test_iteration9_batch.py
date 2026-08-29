"""Iteration 9 — Tip/Coupon/Email/Loyalty + Refund/Void + Onboarding + Reports.

Covers the additive feature batch shipped in this iteration:
- Order create with tip, coupon_code, customer_email, send_email_receipt,
  redeem_loyalty_points, splits[]
- POST /orders/{id}/refund and /orders/{id}/void (Manager-only)
- GET /refunds/log
- Customer loyalty (adjust, get, lookup)
- Onboarding status / dismiss
- Reports: /reports/labour, /reports/daily-rollup
- Staff pay_type / monthly_pay

Uses Manager PIN 1234 + Cashier PIN 2345 against the demo tenant.
"""

import pytest

pytestmark = pytest.mark.integration
import os
import time
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"
TENANT = {"X-Tenant-Slug": "demo"}


# --------- shared fixtures ---------
def _login(pin: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"pin": pin}, headers=TENANT, timeout=15)
    assert r.status_code == 200, f"login {pin} failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def mgr_token():
    return _login("1234")


@pytest.fixture(scope="session")
def cashier_token():
    return _login("2345")


def _h(token):
    return {**TENANT, "Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ====================== Loyalty ======================
class TestLoyalty:
    qa_customer_id = None
    qa_phone = "+919900012345"

    def test_create_qa_customer(self, mgr_token):
        body = {"name": "QA Loyal", "phone": self.qa_phone, "email": "qa+loyal@example.com"}
        r = requests.post(f"{API}/customers", json=body, headers=_h(mgr_token), timeout=15)
        assert r.status_code in (200, 201), r.text
        data = r.json()
        assert data["phone"] == self.qa_phone
        TestLoyalty.qa_customer_id = data["id"]

    def test_adjust_loyalty_100(self, mgr_token):
        cid = TestLoyalty.qa_customer_id
        assert cid
        r = requests.post(f"{API}/customers/{cid}/loyalty/adjust",
                          json={"points": 100, "note": "QA seed"},
                          headers=_h(mgr_token), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["balance"] == 100

    def test_get_loyalty_balance(self, mgr_token):
        cid = TestLoyalty.qa_customer_id
        r = requests.get(f"{API}/customers/{cid}/loyalty", headers=_h(mgr_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["loyalty_points"] == 100
        assert len(data["transactions"]) >= 1
        assert data["transactions"][0]["kind"] in ("adjust", "earn", "redeem")

    def test_lookup_by_phone_found(self, cashier_token):
        r = requests.get(f"{API}/loyalty/lookup",
                         params={"phone": self.qa_phone},
                         headers=_h(cashier_token), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["found"] is True
        assert data["loyalty_points"] == 100

    def test_lookup_by_phone_not_found(self, cashier_token):
        r = requests.get(f"{API}/loyalty/lookup",
                         params={"phone": "+91999999"},
                         headers=_h(cashier_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["found"] is False

    def test_adjust_negative_blocked(self, mgr_token):
        cid = TestLoyalty.qa_customer_id
        r = requests.post(f"{API}/customers/{cid}/loyalty/adjust",
                          json={"points": -5000, "note": "should fail"},
                          headers=_h(mgr_token), timeout=15)
        assert r.status_code == 400

    def test_cleanup_qa_customer(self, mgr_token):
        cid = TestLoyalty.qa_customer_id
        if cid:
            r = requests.delete(f"{API}/customers/{cid}", headers=_h(mgr_token), timeout=15)
            assert r.status_code in (200, 204, 404)


# ====================== Order create + splits + coupon + email + loyalty ======================
def _build_order(total=200, splits=None, **extra):
    body = {
        "type": "collection",
        "customer": {"name": "QA Buyer", "phone": "+919900099999"},
        "items": [{"name": "Cheese Pizza", "qty": 1, "price": float(total), "mods": []}],
        "total": float(total),
        "payment": extra.pop("payment", "cash"),
        "source": "in-store",
    }
    if splits is not None:
        body["splits"] = splits
        body["payment"] = extra.pop("payment", "cash")
    body.update(extra)
    return body


class TestOrderExtras:
    def test_order_with_tip_and_email(self, cashier_token):
        body = _build_order(total=250, tip=25, customer_email="qa+rcpt@example.com",
                            send_email_receipt=True)
        r = requests.post(f"{API}/orders", json=body, headers=_h(cashier_token), timeout=20)
        assert r.status_code in (200, 201), r.text
        o = r.json()
        assert float(o.get("tip", 0)) == 25
        assert o.get("customer_email") == "qa+rcpt@example.com"
        # Verify persistence via GET (list, since no by-id route exists)
        g = requests.get(f"{API}/orders", headers=_h(cashier_token), timeout=15)
        assert g.status_code == 200
        match = [x for x in g.json() if x["id"] == o["id"]]
        assert match and float(match[0].get("tip", 0)) == 25

    def test_split_payment_valid(self, cashier_token):
        body = _build_order(total=200, splits=[
            {"method": "cash", "amount": 100},
            {"method": "card", "amount": 100},
        ])
        r = requests.post(f"{API}/orders", json=body, headers=_h(cashier_token), timeout=15)
        assert r.status_code in (200, 201), r.text
        o = r.json()
        assert o.get("splits"), "splits not echoed back"
        assert len(o["splits"]) == 2

    def test_split_payment_mismatch_400(self, cashier_token):
        body = _build_order(total=200, splits=[
            {"method": "cash", "amount": 50},
            {"method": "card", "amount": 100},
        ])
        r = requests.post(f"{API}/orders", json=body, headers=_h(cashier_token), timeout=15)
        assert r.status_code == 400, f"expected 400 on split mismatch, got {r.status_code}: {r.text}"

    def test_coupon_used_count_bumps(self, mgr_token, cashier_token):
        # Create a fresh coupon
        code = f"QATEST{int(time.time()) % 100000}"
        cr = requests.post(f"{API}/coupons", json={
            "code": code, "kind": "flat", "value": 10, "active": True,
            "min_subtotal": 0,
        }, headers=_h(mgr_token), timeout=15)
        assert cr.status_code in (200, 201), cr.text
        coupon_id = cr.json()["id"]
        # Initial used_count
        before = cr.json().get("used_count", 0)
        # Order applies coupon
        body = _build_order(total=100, coupon_code=code)
        r = requests.post(f"{API}/orders", json=body, headers=_h(cashier_token), timeout=15)
        assert r.status_code in (200, 201), r.text
        # Re-fetch coupon
        time.sleep(0.3)
        gl = requests.get(f"{API}/coupons", headers=_h(mgr_token), timeout=15)
        assert gl.status_code == 200
        matched = [c for c in gl.json() if c["code"].upper() == code.upper()]
        assert matched, "coupon disappeared"
        assert matched[0].get("used_count", 0) >= before + 1
        # Cleanup
        requests.delete(f"{API}/coupons/{coupon_id}", headers=_h(mgr_token), timeout=15)

    def test_loyalty_earn_on_order(self, mgr_token, cashier_token):
        # Create a customer, place a cash order with their phone, expect earn
        phone = f"+9199000{int(time.time()) % 100000:05d}"
        cust = requests.post(f"{API}/customers",
                             json={"name": "QA Earner", "phone": phone},
                             headers=_h(mgr_token), timeout=15).json()
        body = _build_order(total=500, payment="cash")
        body["customer"] = {"name": "QA Earner", "phone": phone}
        r = requests.post(f"{API}/orders", json=body, headers=_h(cashier_token), timeout=15)
        assert r.status_code in (200, 201), r.text
        time.sleep(0.5)
        lo = requests.get(f"{API}/customers/{cust['id']}/loyalty",
                          headers=_h(mgr_token), timeout=15).json()
        # Earn rule: floor(net/100) — 500 → 5 points
        assert lo["loyalty_points"] >= 5, f"expected >=5 points, got {lo['loyalty_points']}"
        # Cleanup
        requests.delete(f"{API}/customers/{cust['id']}", headers=_h(mgr_token), timeout=15)


# ====================== Refund + Void ======================
class TestRefundVoid:
    refund_order_id = None
    void_order_id = None

    def test_seed_orders(self, cashier_token):
        for key in ("refund_order_id", "void_order_id"):
            body = _build_order(total=300, payment="cash")
            r = requests.post(f"{API}/orders", json=body, headers=_h(cashier_token), timeout=15)
            assert r.status_code in (200, 201), r.text
            setattr(TestRefundVoid, key, r.json()["id"])

    def test_refund_partial_ok(self, mgr_token):
        oid = TestRefundVoid.refund_order_id
        r = requests.post(f"{API}/orders/{oid}/refund",
                          json={"amount": 100, "reason": "QA partial"},
                          headers=_h(mgr_token), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["refunded_total"] == 100

    def test_refund_too_much_400(self, mgr_token):
        oid = TestRefundVoid.refund_order_id
        r = requests.post(f"{API}/orders/{oid}/refund",
                          json={"amount": 9999, "reason": "QA over"},
                          headers=_h(mgr_token), timeout=15)
        assert r.status_code == 400

    def test_refund_cashier_forbidden(self, cashier_token):
        oid = TestRefundVoid.refund_order_id
        r = requests.post(f"{API}/orders/{oid}/refund",
                          json={"amount": 10, "reason": "no auth"},
                          headers=_h(cashier_token), timeout=15)
        assert r.status_code in (401, 403)

    def test_void_ok(self, mgr_token):
        oid = TestRefundVoid.void_order_id
        r = requests.post(f"{API}/orders/{oid}/void",
                          json={"reason": "QA void"},
                          headers=_h(mgr_token), timeout=15)
        assert r.status_code == 200, r.text
        # Verify persistence via GET (list)
        g = requests.get(f"{API}/orders", headers=_h(mgr_token), timeout=15)
        assert g.status_code == 200
        match = [x for x in g.json() if x["id"] == oid]
        assert match and match[0].get("voided") is True

    def test_void_twice_400(self, mgr_token):
        oid = TestRefundVoid.void_order_id
        r = requests.post(f"{API}/orders/{oid}/void",
                          json={"reason": "again"},
                          headers=_h(mgr_token), timeout=15)
        assert r.status_code == 400

    def test_refund_log_list(self, mgr_token):
        r = requests.get(f"{API}/refunds/log", headers=_h(mgr_token), timeout=15)
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list)
        kinds = {row["kind"] for row in rows}
        assert "refund" in kinds and "void" in kinds


# ====================== Onboarding ======================
class TestOnboarding:
    def test_status_completed_for_demo(self, mgr_token):
        r = requests.get(f"{API}/onboarding/status", headers=_h(mgr_token), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        # Demo tenant is mature: either has_*-flags all true OR previously dismissed
        assert data["completed"] is True, data

    def test_dismiss(self, mgr_token):
        r = requests.post(f"{API}/onboarding/dismiss", headers=_h(mgr_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_status_cashier_forbidden(self, cashier_token):
        r = requests.get(f"{API}/onboarding/status", headers=_h(cashier_token), timeout=15)
        assert r.status_code in (401, 403)


# ====================== Reports ======================
class TestReports:
    def test_labour_endpoint(self, mgr_token, cashier_token):
        # Make sure at least one punch exists so monthly_run_rate has data
        requests.post(f"{API}/timeclock/punch",
                      json={"pin": "2345"},
                      headers=_h(mgr_token), timeout=15)
        r = requests.get(f"{API}/reports/labour", headers=_h(mgr_token), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        for key in ("as_of", "today_cost", "currently_in_count", "currently_in", "monthly_run_rate"):
            assert key in data, f"missing {key}"

    def test_labour_cashier_forbidden(self, cashier_token):
        r = requests.get(f"{API}/reports/labour", headers=_h(cashier_token), timeout=15)
        assert r.status_code in (401, 403)

    def test_daily_rollup(self, mgr_token):
        r = requests.get(f"{API}/reports/daily-rollup",
                         params={"days": 3},
                         headers=_h(mgr_token), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["days"] == 3
        assert len(data["rollups"]) == 4  # 3 + today
        for row in data["rollups"]:
            for k in ("date", "orders", "gross_sales", "refunded", "net_sales"):
                assert k in row


# ====================== Staff pay_type ======================
class TestStaffPay:
    qa_staff_id = None

    def test_create_monthly_staff(self, mgr_token):
        pin = str(int(time.time()) % 9000 + 1000)
        body = {"name": "TEST QA Pay", "role": "Cashier", "pin": pin,
                "pay_type": "monthly", "monthly_pay": 30000}
        r = requests.post(f"{API}/staff", json=body, headers=_h(mgr_token), timeout=15)
        assert r.status_code in (200, 201), r.text
        s = r.json()
        TestStaffPay.qa_staff_id = s["id"]
        assert s["pay_type"] == "monthly"
        assert s["monthly_pay"] == 30000

    def test_list_includes_paytype(self, mgr_token):
        r = requests.get(f"{API}/staff", headers=_h(mgr_token), timeout=15)
        assert r.status_code == 200
        match = [u for u in r.json() if u["id"] == TestStaffPay.qa_staff_id]
        assert match
        assert match[0]["pay_type"] == "monthly"
        assert match[0]["monthly_pay"] == 30000

    def test_update_paytype(self, mgr_token):
        sid = TestStaffPay.qa_staff_id
        r = requests.put(f"{API}/staff/{sid}",
                         json={"pay_type": "monthly", "monthly_pay": 45000},
                         headers=_h(mgr_token), timeout=15)
        assert r.status_code == 200, r.text
        # Verify via GET
        lst = requests.get(f"{API}/staff", headers=_h(mgr_token), timeout=15).json()
        match = [u for u in lst if u["id"] == sid]
        assert match[0]["monthly_pay"] == 45000

    def test_cleanup(self, mgr_token):
        sid = TestStaffPay.qa_staff_id
        if sid:
            requests.delete(f"{API}/staff/{sid}", headers=_h(mgr_token), timeout=15)
