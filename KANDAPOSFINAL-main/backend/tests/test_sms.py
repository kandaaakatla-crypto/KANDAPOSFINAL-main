"""Tests for /api/sms/send, /api/sms/broadcast, /api/sms/history (iteration 13)."""
import os
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path("/app/frontend/.env"))
API = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") + "/api"
TENANT = {"X-Tenant-Slug": "demo"}


@pytest.fixture(scope="module")
def mgr_token():
    r = requests.post(f"{API}/auth/login", json={"pin": "1234"}, headers=TENANT, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def mgr_headers(mgr_token):
    return {"Authorization": f"Bearer {mgr_token}", **TENANT}


# --- /sms/send ---
def test_send_requires_auth():
    r = requests.post(f"{API}/sms/send", json={"to": "+919999999999", "body": "test"}, timeout=15)
    assert r.status_code in (401, 403), f"got {r.status_code}: {r.text}"


def test_send_manager_ok(mgr_headers):
    r = requests.post(
        f"{API}/sms/send",
        json={"to": "+919999999999", "body": "iteration13 test"},
        headers=mgr_headers,
        timeout=30,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert "id" in j
    assert j["to"] == "+919999999999"
    assert "ok" in j
    assert isinstance(j["ok"], bool)
    assert "error" in j


# --- /sms/broadcast ---
def test_broadcast_empty_400(mgr_headers):
    r = requests.post(f"{API}/sms/broadcast", json={"body": "hi"}, headers=mgr_headers, timeout=15)
    assert r.status_code == 400
    assert "No valid recipients" in r.text


def test_broadcast_cap_over_200(mgr_headers):
    phones = [f"+9199999{i:05d}" for i in range(201)]
    r = requests.post(
        f"{API}/sms/broadcast",
        json={"body": "hi", "phones": phones},
        headers=mgr_headers,
        timeout=30,
    )
    assert r.status_code == 400
    assert "200" in r.text


def test_broadcast_customer_and_name_placeholder(mgr_headers):
    # Grab a real customer with a phone
    r = requests.get(f"{API}/customers", headers=mgr_headers, timeout=15)
    assert r.status_code == 200, r.text
    customers = r.json()
    if isinstance(customers, dict):
        customers = customers.get("items") or customers.get("customers") or []
    with_phone = [c for c in customers if c.get("phone")]
    if not with_phone:
        pytest.skip("No demo customers with phones")
    cust = with_phone[0]
    r = requests.post(
        f"{API}/sms/broadcast",
        json={"body": "Hi {name}, iteration13 test", "customer_ids": [cust["id"]]},
        headers=mgr_headers,
        timeout=45,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["count"] == 1
    assert "sent" in j and "failed" in j
    assert len(j["results"]) == 1
    assert j["results"][0]["to"]

    # Verify placeholder replaced via history
    h = requests.get(f"{API}/sms/history", headers=mgr_headers, timeout=15)
    assert h.status_code == 200
    rows = h.json()
    assert len(rows) > 0
    top = rows[0]
    first_name = (cust.get("name") or "").split(" ")[0]
    assert "{name}" not in top["body"]
    if first_name:
        assert first_name in top["body"], f"first name {first_name!r} missing from {top['body']!r}"


# --- /sms/history ---
def test_history_shape_and_sort(mgr_headers):
    r = requests.get(f"{API}/sms/history", headers=mgr_headers, timeout=15)
    assert r.status_code == 200
    rows = r.json()
    assert isinstance(rows, list)
    if not rows:
        pytest.skip("No history rows yet")
    for k in ("id", "to", "body", "status", "sent_by", "sent_at", "tenant_id"):
        assert k in rows[0], f"missing {k}"
    assert "customer_id" in rows[0]  # nullable but present
    # newest-first
    ts = [r["sent_at"] for r in rows]
    assert ts == sorted(ts, reverse=True)


def test_history_requires_auth():
    r = requests.get(f"{API}/sms/history", timeout=15)
    assert r.status_code in (401, 403)
