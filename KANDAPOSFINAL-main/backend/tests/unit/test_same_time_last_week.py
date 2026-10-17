"""Same time last week (reports.report_summary): the Dashboard Home compares
today's takings so far with last week's same weekday up to the same clock
time, so a slow morning isn't read against a full day."""
import os
import uuid
from datetime import timedelta

from pymongo import MongoClient

from tz import now_ist

DEMO_MANAGER_PIN = "1234"


def _manager_headers(client):
    r = client.post("/api/auth/login", json={"pin": DEMO_MANAGER_PIN},
                    headers={"X-Forwarded-For": "203.0.113.92"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_summary_has_sales_up_to_same_time_last_week(client, db_name):
    headers = _manager_headers(client)
    tenant_id = client.get("/api/tenant/info", headers=headers).json()["id"]
    before = client.get("/api/reports/summary", headers=headers).json()

    lw_now = now_ist() - timedelta(days=7)
    lw_start = lw_now.replace(hour=0, minute=0, second=0, microsecond=0)
    tag = uuid.uuid4().hex[:6]
    base = 900_000 + int(tag, 16) % 90_000  # well clear of real order numbers
    m = MongoClient(os.environ["MONGO_URL"])
    try:
        m[db_name].orders.insert_many([
            # earlier that day than now: counts
            {"id": f"lw-in-{tag}", "number": base, "tenant_id": tenant_id, "total": 450.0, "items": [],
             "placedAt": (lw_start + (lw_now - lw_start) / 2).isoformat()},
            # later that day than now: not yet comparable
            {"id": f"lw-late-{tag}", "number": base + 1, "tenant_id": tenant_id, "total": 9000.0, "items": [],
             "placedAt": (lw_now + timedelta(minutes=1)).isoformat()},
            # the day before: outside the window
            {"id": f"lw-early-{tag}", "number": base + 2, "tenant_id": tenant_id, "total": 7000.0, "items": [],
             "placedAt": (lw_start - timedelta(minutes=1)).isoformat()},
        ])
        after = client.get("/api/reports/summary", headers=headers).json()
    finally:
        m[db_name].orders.delete_many({"id": {"$regex": f"^lw-.*-{tag}$"}})
        m.close()

    assert round(after["sameTimeLastWeek"] - before.get("sameTimeLastWeek", 0), 2) == 450.0
    assert after["sameTimeLastWeekOrders"] - before.get("sameTimeLastWeekOrders", 0) == 1
