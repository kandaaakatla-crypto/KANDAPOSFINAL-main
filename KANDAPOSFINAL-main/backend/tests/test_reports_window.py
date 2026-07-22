"""Reports endpoint — verify the 7-day rolling window filter.

Inserts an "ancient" order placed >30 days ago directly via pymongo, then
asserts that it is excluded from both the weekly chart and the topItems
aggregation. Guards the DB-level `placedAt >= week_start` filter added
in 2026-02 to avoid a full collection scan on `/api/reports/summary`.
"""
import os
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

# conftest only loads frontend/.env; we also need MONGO_URL / DB_NAME from backend/.env.
load_dotenv(Path("/app/backend/.env"))

BASE = os.environ.get("BASE_URL", "http://localhost:8001/api")
TENANT_HEADER = {"X-Tenant-Slug": "demo"}


def _login(pin: str = "1234") -> str:
    r = requests.post(f"{BASE}/auth/login", headers=TENANT_HEADER, json={"pin": pin})
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture
def orders_col():
    client = MongoClient(os.environ["MONGO_URL"])
    col = client[os.environ["DB_NAME"]]["orders"]
    yield col
    client.close()


def test_reports_window_excludes_old_orders(orders_col):
    token = _login()
    headers = {"Authorization": f"Bearer {token}", **TENANT_HEADER}

    ancient_id = f"o_ancient_{uuid.uuid4().hex[:6]}"
    ancient_iso = (datetime.now(timezone.utc) - timedelta(days=45)).isoformat()
    ancient = {
        "id": ancient_id,
        "tenant_id": "demo",
        "number": 99999,
        "type": "takeaway",
        "status": "completed",
        "customer": {"name": "Ghost", "phone": "+10000000000", "address": None},
        "table": None,
        "items": [{"id": "ghost", "name": "GhostItem_XYZ", "qty": 99, "price": 9.99}],
        "deliveryFee": 0,
        "discount": 0,
        "total": 9999.99,  # huge — obvious if leaked into weekly
        "payment": "cash",
        "placedAt": ancient_iso,
        "driver": None,
        "source": "in-store",
    }
    orders_col.insert_one(ancient)
    try:
        r = requests.get(f"{BASE}/reports/summary", headers=headers)
        r.raise_for_status()
        body = r.json()

        assert len(body["weeklySales"]) == 7
        for bucket in body["weeklySales"]:
            assert bucket["sales"] < 9999.99, f"Old order leaked into weekly: {bucket}"

        names = [t["name"] for t in body["topItems"]]
        assert "GhostItem_XYZ" not in names, f"Old order leaked into topItems: {names}"
    finally:
        orders_col.delete_one({"id": ancient_id})
