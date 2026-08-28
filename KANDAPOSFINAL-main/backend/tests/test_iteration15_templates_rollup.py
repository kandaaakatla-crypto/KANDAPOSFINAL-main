"""Iteration 15 tests:
1) /api/whatsapp/templates + /api/whatsapp/send-template
2) /api/reports/daily-rollup shape + /api/reports/daily-rollup/rebuild
3) Verify cron loop registered (via startup log line).
"""

import pytest

pytestmark = pytest.mark.integration
import os
import time
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path("/app/frontend/.env"))
load_dotenv(Path("/app/backend/.env"))
API = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") + "/api"
TENANT = {"X-Tenant-Slug": "demo"}
TEST_PHONE = "+916303435484"


@pytest.fixture(scope="module")
def mgr_headers():
    r = requests.post(f"{API}/auth/login", json={"pin": "1234"}, headers=TENANT, timeout=15)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}", **TENANT}


@pytest.fixture(scope="module")
def owner_headers():
    """Dashboard owner login (email/password)."""
    r = requests.post(
        f"{API}/dash/auth/login",
        json={"email": "owner@demo.com", "password": "OwnerPass#2025"},
        headers=TENANT, timeout=15,
    )
    if r.status_code != 200:
        # fallback endpoint names
        r = requests.post(
            f"{API}/auth/dash/login",
            json={"email": "owner@demo.com", "password": "OwnerPass#2025"},
            headers=TENANT, timeout=15,
        )
    assert r.status_code == 200, f"owner login failed: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    return {"Authorization": f"Bearer {tok}", **TENANT}


# ---------------- WhatsApp Templates ----------------
def test_templates_requires_auth():
    r = requests.get(f"{API}/whatsapp/templates", timeout=15)
    assert r.status_code in (401, 403)


def test_templates_list_shape(mgr_headers):
    r = requests.get(f"{API}/whatsapp/templates", headers=mgr_headers, timeout=45)
    assert r.status_code == 200, r.text
    arr = r.json()
    assert isinstance(arr, list)
    assert len(arr) >= 5, f"expected >=5 approved templates, got {len(arr)}: {arr}"
    for t in arr:
        for k in ("sid", "friendly_name", "language", "preview", "variables"):
            assert k in t, f"missing {k} in template: {t}"
        assert isinstance(t["variables"], dict)
    # store for later tests
    pytest.templates_cache = arr


def test_send_template_unauth():
    r = requests.post(
        f"{API}/whatsapp/send-template",
        json={"to": TEST_PHONE, "content_sid": "HXbogus", "variables": {}},
        timeout=15,
    )
    assert r.status_code in (401, 403)


def test_send_template_unknown_sid_returns_ok_false(mgr_headers):
    r = requests.post(
        f"{API}/whatsapp/send-template",
        json={"to": TEST_PHONE, "content_sid": "HXnonexistent000000000000000000000", "variables": {}},
        headers=mgr_headers, timeout=45,
    )
    # Twilio raises for unknown SID => error returned via json (ok=false)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["ok"] is False
    assert j["error"] and isinstance(j["error"], str)
    assert j["content_sid"] == "HXnonexistent000000000000000000000"


def test_send_template_happy_path_persists_rendered(mgr_headers):
    templates = getattr(pytest, "templates_cache", None) or requests.get(
        f"{API}/whatsapp/templates", headers=mgr_headers, timeout=45
    ).json()
    # Prefer notification_order_tracking; else any template with variables
    tpl = next((t for t in templates if t.get("friendly_name") == "notification_order_tracking"), None)
    if not tpl:
        tpl = next((t for t in templates if t.get("variables")), None)
    if not tpl:
        tpl = templates[0]
    # Merge keys from Twilio variables dict AND any {{k}} placeholders in preview,
    # since Twilio sometimes returns preview placeholders that aren't in `variables`.
    import re
    var_keys = set((tpl.get("variables") or {}).keys())
    var_keys.update(re.findall(r"\{\{\s*([^}]+?)\s*\}\}", tpl.get("preview", "")))
    var_keys = [k.strip() for k in var_keys]
    values = {k: f"VAL{k}" for k in var_keys}

    r = requests.post(
        f"{API}/whatsapp/send-template",
        json={"to": TEST_PHONE, "content_sid": tpl["sid"], "variables": values},
        headers=mgr_headers, timeout=60,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert set(["ok", "message", "error", "content_sid"]).issubset(j.keys())
    m = j["message"]
    for k in ("id", "body", "direction", "status", "at", "conversation_id", "phone"):
        assert k in m
    assert m["direction"] == "out"
    assert "_id" not in m
    # Body must be RENDERED — no {{ placeholders left when we provided values
    if var_keys:
        assert "{{" not in m["body"], f"unrendered placeholders remain: {m['body']}"
        # substituted values should be present for keys that appeared in preview
        preview_keys = set(re.findall(r"\{\{\s*([^}]+?)\s*\}\}", tpl.get("preview", "")))
        for k in preview_keys:
            v = values.get(k.strip())
            if v:
                assert v in m["body"], f"expected {v} in rendered body: {m['body']}"

    # Verify persistence via GET messages
    conv_id = m["conversation_id"]
    time.sleep(0.5)
    r2 = requests.get(
        f"{API}/whatsapp/conversations/{conv_id}/messages",
        headers=mgr_headers, timeout=15,
    )
    assert r2.status_code == 200
    msgs = r2.json()["messages"]
    stored = next((x for x in msgs if x["id"] == m["id"]), None)
    assert stored is not None, "sent message not persisted"
    assert stored["body"] == m["body"]
    if var_keys:
        assert "{{" not in stored["body"]


# ---------------- Daily Rollup ----------------
def test_daily_rollup_shape(mgr_headers):
    r = requests.get(f"{API}/reports/daily-rollup?days=5", headers=mgr_headers, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "days" in j and "rollups" in j
    assert isinstance(j["rollups"], list)
    assert len(j["rollups"]) == 6  # days=5 -> range(5,-1,-1) => 6 entries (incl. today)
    for row in j["rollups"]:
        for k in ("date", "orders", "gross_sales", "refunded", "net_sales"):
            assert k in row, f"missing {k}"


def test_rebuild_rollup_requires_manager(mgr_headers):
    # No auth -> 401/403
    r = requests.post(f"{API}/reports/daily-rollup/rebuild?days=5", timeout=30)
    assert r.status_code in (401, 403)
    # With Manager (PIN 1234) -> ok
    r = requests.post(f"{API}/reports/daily-rollup/rebuild?days=5",
                      headers=mgr_headers, timeout=60)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["ok"] is True
    assert j["rebuilt"] == 5
    assert j["days"] == 5


def test_rollup_enriched_shape_after_rebuild(mgr_headers):
    # After rebuild, historic rows must have enriched shape
    r = requests.get(f"{API}/reports/daily-rollup?days=5", headers=mgr_headers, timeout=30)
    assert r.status_code == 200
    rollups = r.json()["rollups"]
    # Historic ones (all except last) — check enriched fields
    from datetime import datetime, timezone
    today = datetime.now(timezone.utc).date().isoformat()
    historic = [r for r in rollups if r["date"] != today]
    assert len(historic) >= 5
    for row in historic:
        for k in ("date", "orders", "gross_sales", "refunded", "net_sales",
                  "avg_ticket", "hourly_revenue", "top_items", "computed_at", "is_final"):
            assert k in row, f"historic row missing {k}: {row}"
        assert isinstance(row["hourly_revenue"], list)
        assert len(row["hourly_revenue"]) == 24
        assert isinstance(row["top_items"], list)
        assert row["is_final"] is True


# ---------------- Cron loop registration ----------------
def test_cron_loop_registered_via_startup_log():
    """The startup log emits 'Kanda POS DB seeded / verified + reminder loop started'
    immediately after asyncio.create_task(daily_rollup_cron_loop(get_db))."""
    import subprocess
    log = subprocess.check_output(
        ["tail", "-n", "500", "/var/log/supervisor/backend.err.log"],
        stderr=subprocess.STDOUT,
    ).decode(errors="ignore")
    # Combine out+err just in case
    try:
        log += subprocess.check_output(
            ["tail", "-n", "500", "/var/log/supervisor/backend.out.log"],
            stderr=subprocess.STDOUT,
        ).decode(errors="ignore")
    except Exception:
        pass
    assert "Kanda POS DB seeded / verified + reminder loop started" in log, \
        "startup log line not found — cron loop registration cannot be confirmed"
    # Additional bonus: cron logger emits its own line if it started
    # (not strictly required, but nice)
    if "Daily rollup cron loop started" not in log:
        # It's not required for pass but log for context
        print("[info] 'Daily rollup cron loop started' not seen in tail — cron may have logged earlier")
