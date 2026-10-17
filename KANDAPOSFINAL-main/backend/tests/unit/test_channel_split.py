"""Channel split (reports.report_channels): sales by where the order came
from (counter, phone, Swiggy, Zomato, QR, website) and by order type."""
import os
import uuid

from pymongo import MongoClient

from tz import now_ist

DEMO_MANAGER_PIN = "1234"
CHANNELS = "/api/reports/channels"


def _manager_headers(client):
    r = client.post("/api/auth/login", json={"pin": DEMO_MANAGER_PIN},
                    headers={"X-Forwarded-For": "203.0.113.94"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _by(rows):
    return {r["key"]: r for r in rows}


def test_today_split_by_source_and_type(client, db_name):
    headers = _manager_headers(client)
    tenant_id = client.get("/api/tenant/info", headers=headers).json()["id"]
    before = client.get(CHANNELS, params={"days": 1}, headers=headers)
    assert before.status_code == 200, before.text
    before = before.json()

    tag = uuid.uuid4().hex[:6]
    base = 800_000 + int(tag, 16) % 90_000
    placed = now_ist().replace(hour=0, minute=5, second=0, microsecond=0).isoformat()
    rows = [
        ("swiggy", "delivery", 100.0, False),
        ("swiggy", "delivery", 200.0, False),
        ("zomato", "delivery", 50.0, False),
        ("swiggy", "delivery", 999.0, True),   # voided: left out
        (None, "dine-in", 70.0, False),         # no source recorded: counts as in-store
    ]
    m = MongoClient(os.environ["MONGO_URL"])
    try:
        m[db_name].orders.insert_many([
            {"id": f"ch-{i}-{tag}", "number": base + i, "tenant_id": tenant_id, "total": total, "items": [],
             "type": typ, "placedAt": placed, **({"source": src} if src else {}), **({"voided": True} if voided else {})}
            for i, (src, typ, total, voided) in enumerate(rows)
        ])
        after = client.get(CHANNELS, params={"days": 1}, headers=headers).json()
    finally:
        m[db_name].orders.delete_many({"id": {"$regex": f"^ch-.*-{tag}$"}})
        m.close()

    def diff(section, key, field):
        a = _by(after[section])[key][field]
        b = _by(before[section]).get(key, {}).get(field, 0)
        return round(a - b, 2)

    assert diff("bySource", "swiggy", "sales") == 300.0
    assert diff("bySource", "swiggy", "orders") == 2
    assert diff("bySource", "zomato", "sales") == 50.0
    assert diff("bySource", "in-store", "sales") == 70.0
    assert diff("byType", "delivery", "sales") == 350.0
    assert round(after["total"] - before["total"], 2) == 420.0

    assert client.get(CHANNELS, params={"days": 3}, headers=headers).status_code == 422
