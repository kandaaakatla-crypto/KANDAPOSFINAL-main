"""Iteration 10 backend tests:
- Rota PDF export (Manager only, returns application/pdf, magic bytes %PDF)
- /api/shifts?mine=true regression for Cashier + Driver
"""

import pytest

pytestmark = pytest.mark.integration
import os
import requests
import datetime as dt

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
TENANT = {"X-Tenant-Slug": "demo"}


def _login(pin: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"pin": pin}, headers=TENANT, timeout=15)
    assert r.status_code == 200, f"login {pin} -> {r.status_code} {r.text}"
    return r.json()["token"]


def _auth(token):
    return {**TENANT, "Authorization": f"Bearer {token}"}


# Test: Rota PDF — Manager success
def test_rota_pdf_manager_ok():
    tok = _login("1234")
    today = dt.datetime.utcnow().date()
    start = (today - dt.timedelta(days=today.weekday())).isoformat() + "T00:00:00"
    end = (today + dt.timedelta(days=7)).isoformat() + "T00:00:00"
    r = requests.get(
        f"{API}/shifts.pdf",
        params={"start": start, "end": end},
        headers=_auth(tok),
        timeout=20,
    )
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").startswith("application/pdf"), r.headers
    cd = r.headers.get("content-disposition", "")
    assert "attachment" in cd and "rota-" in cd and ".pdf" in cd, cd
    body = r.content
    assert body[:4] == b"%PDF", f"Not a PDF (first 8 bytes: {body[:8]!r})"
    assert len(body) > 500, f"PDF too small: {len(body)} bytes"


# Test: Rota PDF — Cashier forbidden
def test_rota_pdf_cashier_forbidden():
    tok = _login("2345")
    start = "2026-01-01T00:00:00"
    end = "2026-01-08T00:00:00"
    r = requests.get(
        f"{API}/shifts.pdf",
        params={"start": start, "end": end},
        headers=_auth(tok),
        timeout=15,
    )
    assert r.status_code == 403, f"cashier PDF expected 403, got {r.status_code}"


# Test: Rota PDF — Driver forbidden
def test_rota_pdf_driver_forbidden():
    tok = _login("4567")
    start = "2026-01-01T00:00:00"
    end = "2026-01-08T00:00:00"
    r = requests.get(
        f"{API}/shifts.pdf",
        params={"start": start, "end": end},
        headers=_auth(tok),
        timeout=15,
    )
    assert r.status_code == 403


# Test: /api/shifts?mine=true returns only own published shifts for Cashier
def test_shifts_mine_cashier():
    tok = _login("2345")
    r = requests.get(f"{API}/shifts", params={"mine": "true"}, headers=_auth(tok), timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, list)
    me = requests.get(f"{API}/auth/me", headers=_auth(tok), timeout=10).json()
    my_id = me.get("user", me).get("id") or me.get("id")
    for s in data:
        if "staff_id" in s:
            assert s["staff_id"] == my_id, f"foreign shift leaked: {s}"
        # all returned must be published
        assert s.get("published", True) is True


# Test: /api/shifts?mine=true for Driver
def test_shifts_mine_driver():
    tok = _login("4567")
    r = requests.get(f"{API}/shifts", params={"mine": "true"}, headers=_auth(tok), timeout=15)
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)
