"""Loyalty burn: ensure the redeem cap uses gross item subtotal, not
the already-discounted `total`. Bug fix for Iter 9 review:
   subtotal_cap was `order["total"]` which could be 0 after the cashier
   chose to redeem points client-side → the backend would skip debiting
   and the customer would walk out with a free order.
"""

import pytest

pytestmark = pytest.mark.integration
import os
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path("/app/backend/.env"))

BASE = os.environ.get("BASE_URL", "http://localhost:8001/api")
H = {"X-Tenant-Slug": "demo"}


@pytest.fixture
def col():
    client = MongoClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    yield db
    client.close()


def _login_manager() -> dict:
    r = requests.post(f"{BASE}/auth/login", headers=H, json={"pin": "1234"})
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}", **H}


def test_loyalty_burn_cap_uses_gross_subtotal(col):
    headers = _login_manager()
    phone = f"+9999{uuid.uuid4().hex[:6]}"

    # Create customer + seed 200 pts.
    cust = requests.post(f"{BASE}/customers", headers=headers,
                         json={"name": "Cap Test", "phone": phone, "address": "x"}).json()
    requests.post(f"{BASE}/customers/{cust['id']}/loyalty/adjust", headers=headers,
                  json={"points": 200, "note": "seed"}).raise_for_status()

    # Place a ₹150 cash order. Frontend already deducted 100 pts client-side,
    # so we send total=50 + redeem_loyalty_points=100. The backend MUST debit
    # 100 from the customer's balance (not 0, the previous buggy behaviour).
    order_payload = {
        "type": "collection", "status": "new",
        "customer": {"name": cust["name"], "phone": phone, "address": None},
        "items": [{"name": "GrossItem", "qty": 1, "price": 150.0}],
        "deliveryFee": 0, "discount": 0, "total": 50.0,
        "payment": "cash", "redeem_loyalty_points": 100,
    }
    placed = requests.post(f"{BASE}/orders", headers=headers, json=order_payload).json()
    assert placed["loyalty_redeemed"] == 100, f"Expected 100 burned, got {placed.get('loyalty_redeemed')}"

    # Customer balance must have dropped by 100 (and earned 0 because total<100).
    fresh = requests.get(f"{BASE}/customers/{cust['id']}/loyalty", headers=headers).json()
    assert fresh["loyalty_points"] == 100, f"Expected balance=100, got {fresh['loyalty_points']}"

    # Cleanup
    col.orders.delete_one({"id": placed["id"]})
    col.loyalty_txns.delete_many({"customer_id": cust["id"]})
    col.customers.delete_one({"id": cust["id"]})
