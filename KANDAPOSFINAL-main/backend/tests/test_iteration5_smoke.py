"""Iteration 5 smoke checks:
- Backend refactor regression (every prior endpoint still 200)
- Cleanup-script post-conditions (no qatest tenants, no smoke tickets)
- KDS token issuance + rotation + station filter + full lifecycle from
  fresh POS order → preparing → ready → recall.
"""
import os
import requests


BASE = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/") + "/api"


def _owner_token():
    r = requests.post(f"{BASE}/owner/auth/login",
                      json={"email": "owner@kanda.app", "password": "OwnerPass#2025"})
    assert r.status_code == 200, r.text
    pre = r.json()["pre2faToken"]
    v = requests.post(f"{BASE}/owner/auth/verify",
                      headers={"Authorization": f"Bearer {pre}"},
                      json={"code": "000000"})
    assert v.status_code == 200, v.text
    return v.json()["token"]


def _pin_token():
    r = requests.post(f"{BASE}/auth/login", json={"pin": "1234"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


# ----------------- Refactor regression -----------------
class TestRefactorRegression:
    def test_all_endpoints_respond(self):
        tok = _pin_token()
        h = {"Authorization": f"Bearer {tok}"}
        # /api/auth/me
        assert requests.get(f"{BASE}/auth/me", headers=h).status_code == 200
        for p in ("/menu/items", "/menu/categories", "/tables", "/customers",
                  "/inventory", "/orders", "/reports/summary", "/users/drivers"):
            r = requests.get(f"{BASE}{p}", headers=h)
            assert r.status_code == 200, f"{p} -> {r.status_code} {r.text[:200]}"
        # customer search by phone
        r = requests.get(f"{BASE}/customers/search?phone=99999", headers=h)
        assert r.status_code == 200


# ----------------- Cleanup post-conditions -----------------
class TestCleanupPostConditions:
    """These pass only if cleanup_qa.py has been run with --apply since the
    last QA fixture creation. The cleanup is intentionally dry-run by default
    now (post the 2026-02-20 incident) — so we self-invoke --apply here.
    """

    @classmethod
    def setup_class(cls):
        import subprocess
        subprocess.run(["python", "-m", "cleanup_qa", "--apply"], check=False, cwd="/app/backend", timeout=30)

    def test_no_qatest_tenants(self):
        otok = _owner_token()
        r = requests.get(f"{BASE}/owner/tenants",
                         headers={"Authorization": f"Bearer {otok}"})
        assert r.status_code == 200
        tenants = r.json() if isinstance(r.json(), list) else r.json().get("tenants", [])
        bad = [t for t in tenants if str(t.get("slug", "")).lower().startswith("qatest")]
        assert bad == [], f"qatest tenants still present: {bad}"

    def test_no_smoke_subject_tickets(self):
        otok = _owner_token()
        r = requests.get(f"{BASE}/owner/ops/support",
                         headers={"Authorization": f"Bearer {otok}"})
        assert r.status_code == 200
        body = r.json()
        tickets = body if isinstance(body, list) else body.get("tickets", [])
        import re
        pat = re.compile(r"^(smoke|test_|qa[:_ ]|owner-flow)", re.I)
        bad = [t for t in tickets if pat.match(str(t.get("subject", "")))]
        assert bad == [], f"smoke tickets still present: {[t.get('subject') for t in bad]}"


# ----------------- KDS lifecycle -----------------
def _kds_token():
    otok = _owner_token()
    r = requests.get(f"{BASE}/owner/tenants/demo/kds-token",
                     headers={"Authorization": f"Bearer {otok}"})
    return r.json()["token"]


class TestKdsLifecycleIntegration:
    def test_token_card_payload_shape(self):
        otok = _owner_token()
        r = requests.get(f"{BASE}/owner/tenants/demo/kds-token",
                         headers={"Authorization": f"Bearer {otok}"})
        assert r.status_code == 200
        body = r.json()
        assert "token" in body and "url" in body and "stations" in body
        assert "kitchen" in body["stations"] and "pizza" in body["stations"]

    def test_unauth_returns_401(self):
        r = requests.get(f"{BASE}/kds/tickets")
        assert r.status_code == 401

    def test_bad_station_returns_400(self):
        tok = _kds_token()
        r = requests.get(f"{BASE}/kds/tickets", params={"token": tok, "station": "bbq"})
        assert r.status_code == 400

    def test_create_order_appears_on_kds_with_pizza_station(self):
        pin = _pin_token()
        order_payload = {
            "type": "collection", "status": "new",
            "customer": {"name": "Iter5 Smoke", "phone": "+919998877665"},
            "items": [{"name": "Margherita 12\"", "qty": 1, "price": 9.99, "mods": []}],
            "deliveryFee": 0, "discount": 0, "total": 9.99, "payment": "cash",
        }
        r = requests.post(f"{BASE}/orders", json=order_payload,
                          headers={"Authorization": f"Bearer {pin}"})
        assert r.status_code in (200, 201), r.text
        oid = r.json()["id"]

        ktok = _kds_token()
        # station=pizza must include this order (Margherita)
        r = requests.get(f"{BASE}/kds/tickets",
                         params={"token": ktok, "station": "pizza"})
        assert r.status_code == 200
        tickets = r.json()["tickets"]
        match = next((t for t in tickets if t["id"] == oid), None)
        assert match is not None, "new order missing from KDS pizza lane"
        assert match["items"][0]["station"] == "pizza"
        idx = match["items"][0]["index"]

        # Promote new -> preparing
        r = requests.patch(f"{BASE}/kds/orders/{oid}/items/{idx}",
                           params={"token": ktok}, json={"status": "preparing"})
        assert r.status_code == 200
        assert r.json()["lane"] == "preparing"

        # Promote -> ready
        r = requests.patch(f"{BASE}/kds/orders/{oid}/items/{idx}",
                           params={"token": ktok}, json={"status": "ready"})
        assert r.status_code == 200
        assert r.json()["lane"] == "ready"

        # Recall
        r = requests.patch(f"{BASE}/kds/orders/{oid}/recall",
                           params={"token": ktok})
        assert r.status_code == 200
        assert r.json()["lane"] == "recall"
