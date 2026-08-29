"""Backend tests for POST /api/orders/{id}/append (running-tab / occupied-table billing).

Also asserts regressions: create-order-with-table sets table occupied, and
PATCH status=completed releases the table.
"""

import pytest

pytestmark = pytest.mark.integration
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"pin": "1234"})
    assert r.status_code == 200, r.text
    tok = r.json()["token"]
    s.headers["Authorization"] = f"Bearer {tok}"
    return s


def _available_table(api):
    r = api.get(f"{BASE_URL}/api/tables")
    assert r.status_code == 200
    tables = r.json()
    for t in tables:
        if t["status"] == "available":
            return t
    return None


def _menu_item(api):
    r = api.get(f"{BASE_URL}/api/menu/items")
    assert r.status_code == 200
    items = r.json()
    for it in items:
        if it.get("available") and it.get("price"):
            return it
    return None


def _place_dine_in(api):
    tbl = _available_table(api)
    assert tbl, "no available table for test"
    it = _menu_item(api)
    payload = {
        "type": "dine-in",
        "status": "new",
        "customer": {"name": f"Table {tbl['number']}"},
        "table": tbl["number"],
        "items": [{"name": it["name"], "qty": 1, "price": it["price"], "mods": [], "size": None}],
        "total": it["price"],
        "payment": "unpaid",
    }
    r = api.post(f"{BASE_URL}/api/orders", json=payload)
    assert r.status_code == 200, r.text
    return r.json(), tbl


class TestOrdersAppend:
    def test_create_dine_in_occupies_table(self, api):
        order, tbl = _place_dine_in(api)
        assert order["table"] == tbl["number"]
        # Verify table now occupied
        r = api.get(f"{BASE_URL}/api/tables")
        after = next(t for t in r.json() if t["number"] == tbl["number"])
        assert after["status"] == "occupied"
        assert after.get("orderId") == order["id"]
        # cleanup: complete
        api.patch(f"{BASE_URL}/api/orders/{order['id']}/status", json={"status": "completed"})

    def test_append_to_unpaid_order_success(self, api):
        order, _ = _place_dine_in(api)
        oid = order["id"]
        starting_total = order["total"]
        starting_count = len(order["items"])
        it = _menu_item(api)
        add = [{"name": it["name"], "qty": 2, "price": it["price"], "mods": [], "size": None}]
        r = api.post(f"{BASE_URL}/api/orders/{oid}/append", json={"items": add})
        assert r.status_code == 200, r.text
        updated = r.json()
        assert len(updated["items"]) == starting_count + 1
        expected = round(starting_total + 2 * it["price"], 2)
        assert abs(updated["total"] - expected) < 0.01
        # GET to verify persistence
        r2 = api.get(f"{BASE_URL}/api/orders")
        got = next(o for o in r2.json() if o["id"] == oid)
        assert len(got["items"]) == starting_count + 1
        assert abs(got["total"] - expected) < 0.01
        # cleanup
        api.patch(f"{BASE_URL}/api/orders/{oid}/status", json={"status": "completed"})

    def test_append_empty_items_returns_422(self, api):
        order, _ = _place_dine_in(api)
        r = api.post(f"{BASE_URL}/api/orders/{order['id']}/append", json={"items": []})
        assert r.status_code == 422
        api.patch(f"{BASE_URL}/api/orders/{order['id']}/status", json={"status": "completed"})

    def test_append_nonexistent_returns_404(self, api):
        it = _menu_item(api)
        r = api.post(
            f"{BASE_URL}/api/orders/o_doesnotexist/append",
            json={"items": [{"name": it["name"], "qty": 1, "price": it["price"], "mods": [], "size": None}]},
        )
        assert r.status_code == 404

    def test_append_to_paid_order_returns_400(self, api):
        # Create a paid order directly
        it = _menu_item(api)
        payload = {
            "type": "collection",
            "status": "new",
            "customer": {"name": "Walk-in — test"},
            "items": [{"name": it["name"], "qty": 1, "price": it["price"], "mods": [], "size": None}],
            "total": it["price"],
            "payment": "cash",
        }
        r = api.post(f"{BASE_URL}/api/orders", json=payload)
        assert r.status_code == 200
        oid = r.json()["id"]
        r2 = api.post(
            f"{BASE_URL}/api/orders/{oid}/append",
            json={"items": [{"name": it["name"], "qty": 1, "price": it["price"], "mods": [], "size": None}]},
        )
        assert r2.status_code == 400
        assert "paid" in r2.json().get("detail", "").lower()

    def test_status_completed_releases_table(self, api):
        order, tbl = _place_dine_in(api)
        r = api.patch(f"{BASE_URL}/api/orders/{order['id']}/status", json={"status": "completed"})
        assert r.status_code == 200
        tables = api.get(f"{BASE_URL}/api/tables").json()
        after = next(t for t in tables if t["number"] == tbl["number"])
        assert after["status"] == "available"
        assert after.get("orderId") in (None, "")
