"""Customer pulse (reports.report_customers): new vs returning customers in
the period, walk-ins, best customers, and regulars who have gone quiet."""
import os
import uuid
from datetime import timedelta

from pymongo import MongoClient

from tz import now_ist

DEMO_MANAGER_PIN = "1234"
PULSE = "/api/reports/customers"


def _manager_headers(client):
    r = client.post("/api/auth/login", json={"pin": DEMO_MANAGER_PIN},
                    headers={"X-Forwarded-For": "203.0.113.96"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_new_returning_walk_ins_and_lapsed_regulars(client, db_name):
    headers = _manager_headers(client)
    tenant_id = client.get("/api/tenant/info", headers=headers).json()["id"]
    before = client.get(PULSE, params={"days": 7}, headers=headers)
    assert before.status_code == 200, before.text
    before = before.json()

    tag = uuid.uuid4().hex[:6]
    base = 600_000 + int(tag, 16) % 90_000
    now = now_ist()
    old, back, new, quiet = (f"cu-{k}-{tag}" for k in ("old", "back", "new", "quiet"))
    orders = [
        (back, now - timedelta(days=60), 300.0),   # first visit long ago…
        (back, now - timedelta(hours=1), 500.0),   # …back this week: returning
        (new, now - timedelta(hours=2), 250.0),    # first ever order this week: new
        (None, now - timedelta(hours=3), 90.0),    # walk-in, no customer
        (quiet, now - timedelta(days=40), 400.0),  # regular who stopped coming
        (quiet, now - timedelta(days=45), 400.0),
        (quiet, now - timedelta(days=50), 400.0),
        (old, now - timedelta(days=100), 999.0),   # outside every window
    ]
    m = MongoClient(os.environ["MONGO_URL"])
    try:
        db = m[db_name]
        db.customers.insert_many([
            {"id": cid, "tenant_id": tenant_id, "name": f"Cust {cid}", "phone": f"98{i:08d}", "deleted_at": None}
            for i, cid in enumerate((old, back, new, quiet))
        ])
        db.orders.insert_many([
            {"id": f"cp-{i}-{tag}", "number": base + i, "tenant_id": tenant_id, "total": total, "items": [],
             "placedAt": at.isoformat(), **({"customer": {"id": cid, "name": f"Cust {cid}"}} if cid else {})}
            for i, (cid, at, total) in enumerate(orders)
        ])
        after = client.get(PULSE, params={"days": 7}, headers=headers).json()
    finally:
        m[db_name].orders.delete_many({"id": {"$regex": f"^cp-.*-{tag}$"}})
        m[db_name].customers.delete_many({"id": {"$regex": f"^cu-.*-{tag}$"}})
        m.close()

    assert after["newCustomers"] - before["newCustomers"] == 1
    assert after["returningCustomers"] - before["returningCustomers"] == 1
    assert after["walkInOrders"] - before["walkInOrders"] == 1
    assert back in {c["id"] for c in after["topCustomers"]}
    lapsed = {c["id"]: c for c in after["lapsedRegulars"]}
    assert quiet in lapsed and back not in lapsed and old not in lapsed
    assert lapsed[quiet]["orders"] == 3 and lapsed[quiet]["spend"] == 1200.0 and lapsed[quiet]["phone"]
    assert client.get(PULSE, params={"days": 2}, headers=headers).status_code == 422
