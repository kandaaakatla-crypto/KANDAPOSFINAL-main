"""End-to-end backend tests for Andromeda POS.

Covers: Auth, Menu, Tables, Customers, Inventory, Orders, Reports.
All resource endpoints require Bearer JWT (PIN 1234 = Aarav Reddy / Manager).
"""

import pytest

pytestmark = pytest.mark.integration
import os
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path("/app/frontend/.env"))
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") + "/api"


# ============ AUTH ============
class TestAuth:
    def test_login_success_pin_1234(self, api_client, base_url):
        r = api_client.post(f"{base_url}/auth/login", json={"pin": "1234"})
        assert r.status_code == 200
        data = r.json()
        assert "token" in data and isinstance(data["token"], str) and len(data["token"]) > 20
        assert data["user"]["role"] == "Manager"
        assert data["user"]["name"] == "Aarav Reddy"
        assert data["user"]["id"] == "s1"
        assert data["user"]["initials"] == "AR"

    def test_login_invalid_pin(self, api_client, base_url):
        r = api_client.post(f"{base_url}/auth/login", json={"pin": "0000"})
        assert r.status_code == 401

    def test_login_empty_pin(self, api_client, base_url):
        r = api_client.post(f"{base_url}/auth/login", json={"pin": ""})
        assert r.status_code == 400

    def test_me_with_token(self, authed, base_url):
        r = authed.get(f"{base_url}/auth/me")
        assert r.status_code == 200
        u = r.json()
        assert u["id"] == "s1" and u["role"] == "Manager"

    def test_me_without_token(self, api_client, base_url):
        r = api_client.get(f"{base_url}/auth/me")
        assert r.status_code == 401

    def test_me_invalid_token(self, api_client, base_url):
        r = api_client.get(f"{base_url}/auth/me",
                           headers={"Authorization": "Bearer not.a.real.jwt"})
        assert r.status_code == 401


# ============ MENU ============
class TestMenu:
    def test_categories(self, authed, base_url):
        r = authed.get(f"{base_url}/menu/categories")
        assert r.status_code == 200
        cats = r.json()
        assert len(cats) == 7
        sort_orders = [c["sort_order"] for c in cats]
        assert sort_orders == sorted(sort_orders)
        ids = {c["id"] for c in cats}
        assert {"deals", "pizzas", "sides", "chicken", "burgers", "drinks", "desserts"} <= ids

    def test_categories_requires_auth(self, api_client, base_url):
        r = api_client.get(f"{base_url}/menu/categories")
        assert r.status_code == 401

    def test_items_count_and_camelcase(self, authed, base_url):
        r = authed.get(f"{base_url}/menu/items")
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 36
        # camelCase fields
        for it in items:
            assert "catId" in it
            assert "isPizza" in it
            # mongo _id must NOT leak
            assert "_id" not in it
            assert "cat_id" not in it
            assert "is_pizza" not in it
        pizzas = [i for i in items if i["isPizza"]]
        non_pizzas = [i for i in items if not i["isPizza"]]
        assert len(pizzas) > 0
        for p in pizzas:
            assert p["sizes"] is not None
            assert set(p["sizes"].keys()) == {"sm", "md", "lg"}
        for n in non_pizzas:
            assert n["price"] is not None

    def test_create_update_availability_item(self, authed, base_url):
        # CREATE non-pizza
        payload = {"catId": "sides", "name": "TEST_Side", "price": 1.99,
                   "available": True, "isPizza": False}
        r = authed.post(f"{base_url}/menu/items", json=payload)
        assert r.status_code == 200
        item = r.json()
        assert item["name"] == "TEST_Side"
        assert item["catId"] == "sides"
        assert item["price"] == 1.99
        assert item["isPizza"] is False
        item_id = item["id"]

        # GET verifies persistence
        all_items = authed.get(f"{base_url}/menu/items").json()
        assert any(i["id"] == item_id and i["name"] == "TEST_Side" for i in all_items)

        # UPDATE
        r = authed.put(f"{base_url}/menu/items/{item_id}", json={"price": 2.49, "name": "TEST_Side_v2"})
        assert r.status_code == 200
        assert r.json()["price"] == 2.49
        assert r.json()["name"] == "TEST_Side_v2"

        # AVAILABILITY toggle
        r = authed.patch(f"{base_url}/menu/items/{item_id}/availability", json={"available": False})
        assert r.status_code == 200
        assert r.json()["available"] is False

        r = authed.patch(f"{base_url}/menu/items/{item_id}/availability", json={"available": True})
        assert r.json()["available"] is True

    def test_update_nonexistent_item(self, authed, base_url):
        r = authed.put(f"{base_url}/menu/items/does_not_exist", json={"name": "x"})
        assert r.status_code == 404


# ============ TABLES ============
class TestTables:
    def test_list_tables(self, authed, base_url):
        r = authed.get(f"{base_url}/tables")
        assert r.status_code == 200
        tables = r.json()
        assert len(tables) == 12
        for t in tables:
            assert "orderId" in t  # camelCase
            assert "order_id" not in t
            assert "_id" not in t
        # sorted by number
        nums = [t["number"] for t in tables]
        assert nums == sorted(nums)

    def test_patch_table_to_available_clears_order(self, authed, base_url):
        # table 3 (t3) is seeded as occupied with order_id=o3
        r = authed.patch(f"{base_url}/tables/t3",
                         json={"status": "available"})
        assert r.status_code == 200
        t = r.json()
        assert t["status"] == "available"
        assert t["orderId"] is None

        # restore for orders test using PATCH
        authed.patch(f"{base_url}/tables/t3",
                     json={"status": "occupied", "orderId": "o3"})


# ============ CUSTOMERS ============
class TestCustomers:
    def test_list_seeded(self, authed, base_url):
        r = authed.get(f"{base_url}/customers")
        assert r.status_code == 200
        custs = r.json()
        assert len(custs) >= 6  # may include TEST_ leftovers; seeded are 6

    def test_search_phone_aisha(self, authed, base_url):
        r = authed.get(f"{base_url}/customers/search", params={"phone": "+919000333344"})
        assert r.status_code == 200
        c = r.json()
        assert c is not None
        assert c["name"] == "Aisha Khan"
        assert c["id"] == "cu3"

    def test_search_partial(self, authed, base_url):
        r = authed.get(f"{base_url}/customers/search", params={"phone": "9000333344"})
        assert r.status_code == 200
        assert r.json()["name"] == "Aisha Khan"

    def test_search_no_match_returns_null(self, authed, base_url):
        r = authed.get(f"{base_url}/customers/search", params={"phone": "99999999999"})
        assert r.status_code == 200
        assert r.json() is None

    def test_crud(self, authed, base_url):
        # CREATE
        r = authed.post(f"{base_url}/customers", json={
            "name": "TEST_Cust", "phone": "07000000001", "address": "1 Test St"
        })
        assert r.status_code == 200
        cu = r.json()
        assert cu["name"] == "TEST_Cust"
        assert cu["orders"] == 0
        cid = cu["id"]

        # UPDATE
        r = authed.put(f"{base_url}/customers/{cid}", json={"notes": "VIP"})
        assert r.status_code == 200
        assert r.json()["notes"] == "VIP"

        # DELETE
        r = authed.delete(f"{base_url}/customers/{cid}")
        assert r.status_code == 200

        # Verify gone -> next update should 404
        r = authed.put(f"{base_url}/customers/{cid}", json={"notes": "x"})
        assert r.status_code == 404


# ============ INVENTORY ============
class TestInventory:
    def test_list(self, authed, base_url):
        r = authed.get(f"{base_url}/inventory")
        assert r.status_code == 200
        items = r.json()
        assert len(items) == 12
        for it in items:
            assert {"id", "name", "unit", "stock", "reorder", "supplier"} <= it.keys()
            assert "_id" not in it

    def test_adjust_decrement(self, authed, base_url):
        before = authed.get(f"{base_url}/inventory").json()
        i = next(x for x in before if x["id"] == "i1")
        start = i["stock"]
        r = authed.patch(f"{base_url}/inventory/i1/adjust", json={"delta": -2})
        assert r.status_code == 200
        assert r.json()["stock"] == round(start - 2, 1)

        # restore
        authed.patch(f"{base_url}/inventory/i1/adjust", json={"delta": 2})

    def test_adjust_floors_at_zero(self, authed, base_url):
        # i12 jalapenos stock = 1.4, push way down
        r = authed.patch(f"{base_url}/inventory/i12/adjust", json={"delta": -9999})
        assert r.status_code == 200
        assert r.json()["stock"] == 0.0
        # restore
        authed.patch(f"{base_url}/inventory/i12/adjust", json={"delta": 1.4})

    def test_reorder(self, authed, base_url):
        before = authed.get(f"{base_url}/inventory").json()
        i = next(x for x in before if x["id"] == "i4")  # pepperoni reorder=5
        start_stock = i["stock"]
        reorder = i["reorder"]
        r = authed.post(f"{base_url}/inventory/i4/reorder")
        assert r.status_code == 200
        # spec: "bumps stock by 2x reorder level"
        assert r.json()["stock"] == start_stock + reorder * 2


# ============ ORDERS ============
class TestOrders:
    def test_list_orders(self, authed, base_url):
        r = authed.get(f"{base_url}/orders")
        assert r.status_code == 200
        orders = r.json()
        assert len(orders) >= 7

    def test_create_order_monotonic_increment_and_table_side_effects(self, authed, base_url):
        # find a free table
        tables = authed.get(f"{base_url}/tables").json()
        free = next(t for t in tables if t["status"] == "available")
        free_num = free["number"]

        # find previous max order number
        prev_orders = authed.get(f"{base_url}/orders").json()
        max_num = max(o["number"] for o in prev_orders)

        payload = {
            "type": "dine-in",
            "status": "new",
            "customer": {"id": "cu1", "name": "Anika Reddy", "phone": "+919000111122"},
            "table": free_num,
            "items": [{"name": "Margherita 12\"", "qty": 1, "price": 9.99, "mods": []}],
            "deliveryFee": 0,
            "discount": 0,
            "total": 9.99,
            "payment": "card",
        }
        # capture customer order count before
        cu1_before = next(c for c in authed.get(f"{base_url}/customers").json() if c["id"] == "cu1")
        cu1_orders_before = cu1_before["orders"]

        r = authed.post(f"{base_url}/orders", json=payload)
        assert r.status_code == 200, r.text
        order = r.json()
        assert order["number"] == max_num + 1
        assert order["number"] >= 1047
        assert order["placedAt"]  # ISO timestamp present
        assert order["status"] == "new"
        assert order["type"] == "dine-in"

        # Table now occupied with this order id
        tables_after = authed.get(f"{base_url}/tables").json()
        tnow = next(t for t in tables_after if t["number"] == free_num)
        assert tnow["status"] == "occupied"
        assert tnow["orderId"] == order["id"]

        # Customer orders incremented
        cu1_after = next(c for c in authed.get(f"{base_url}/customers").json() if c["id"] == "cu1")
        assert cu1_after["orders"] == cu1_orders_before + 1

        # Complete the order -> table freed
        r = authed.patch(f"{base_url}/orders/{order['id']}/status",
                         json={"status": "completed"})
        assert r.status_code == 200
        assert r.json()["status"] == "completed"

        tables_after2 = authed.get(f"{base_url}/tables").json()
        tnow2 = next(t for t in tables_after2 if t["number"] == free_num)
        assert tnow2["status"] == "available"
        assert tnow2["orderId"] is None

    def test_create_second_order_increments_further(self, authed, base_url):
        prev = authed.get(f"{base_url}/orders").json()
        prev_max = max(o["number"] for o in prev)
        payload = {
            "type": "collection",
            "customer": {"name": "TEST_Walk-in"},
            "items": [{"name": "Fries", "qty": 1, "price": 2.99, "mods": []}],
            "total": 2.99,
            "payment": "cash",
        }
        r = authed.post(f"{base_url}/orders", json=payload)
        assert r.status_code == 200
        assert r.json()["number"] == prev_max + 1


# ============ REPORTS ============
class TestReports:
    def test_summary_structure(self, authed, base_url):
        r = authed.get(f"{base_url}/reports/summary")
        assert r.status_code == 200
        s = r.json()
        for k in ("todaySales", "ordersToday", "avgOrder", "deliveriesToday",
                  "cashTotal", "cardTotal", "unpaidTotal", "weeklySales", "topItems"):
            assert k in s, f"missing key {k}"
        assert len(s["weeklySales"]) == 7
        assert all({"day", "sales", "orders"} <= w.keys() for w in s["weeklySales"])
        assert len(s["topItems"]) <= 5
        for t in s["topItems"]:
            assert {"name", "sold", "revenue"} <= t.keys()
        # numeric sanity
        assert s["ordersToday"] >= 0
        assert s["todaySales"] >= 0
        if s["ordersToday"] > 0:
            assert s["avgOrder"] > 0


# ============ AUTH REQUIRED ============
@pytest.mark.parametrize("method,path", [
    ("get", "/menu/categories"),
    ("get", "/menu/items"),
    ("get", "/tables"),
    ("get", "/customers"),
    ("get", "/inventory"),
    ("get", "/orders"),
    ("get", "/reports/summary"),
])
def test_endpoints_require_auth(api_client, base_url, method, path):
    r = getattr(api_client, method)(f"{base_url}{path}")
    assert r.status_code == 401


# ============ P1: ROLE GATING, ENUM VALIDATION, REPORTS WINDOW ============
@pytest.fixture
def driver_session(api_client, base_url):
    r = api_client.post(f"{base_url}/auth/login", json={"pin": "4567"})
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    return s


class TestRoleGating:
    def test_driver_cannot_create_menu_item(self, driver_session, base_url):
        r = driver_session.post(f"{base_url}/menu/items", json={
            "catId": "sides", "name": "TEST_unauthorized_side", "price": 1.0,
        })
        assert r.status_code == 403

    def test_driver_cannot_toggle_availability(self, driver_session, base_url):
        r = driver_session.patch(f"{base_url}/menu/items/p1/availability", json={"available": True})
        assert r.status_code == 403

    def test_manager_can_toggle_availability(self, authed, base_url):
        r = authed.patch(f"{base_url}/menu/items/p1/availability", json={"available": True})
        assert r.status_code == 200


class TestEnumValidation:
    def test_invalid_order_type_returns_422(self, authed, base_url):
        r = authed.post(f"{base_url}/orders", json={
            "type": "banana", "customer": {"name": "x"}, "items": [], "total": 0,
        })
        assert r.status_code == 422

    def test_invalid_payment_returns_422(self, authed, base_url):
        r = authed.post(f"{base_url}/orders", json={
            "type": "collection", "customer": {"name": "x"}, "items": [], "total": 0, "payment": "crypto",
        })
        assert r.status_code == 422

    def test_invalid_table_status_returns_422(self, authed, base_url):
        r = authed.patch(f"{base_url}/tables/t1", json={"status": "sleeping"})
        assert r.status_code == 422

    def test_invalid_order_status_returns_422(self, authed, base_url):
        # find a real order to mutate
        orders = authed.get(f"{base_url}/orders").json()
        oid = orders[0]["id"]
        r = authed.patch(f"{base_url}/orders/{oid}/status", json={"status": "burning"})
        assert r.status_code == 422


class TestReportsWindow:
    def test_weekly_sales_has_seven_days(self, authed, base_url):
        r = authed.get(f"{base_url}/reports/summary")
        assert r.status_code == 200
        wk = r.json()["weeklySales"]
        assert len(wk) == 7
        for pt in wk:
            assert set(pt.keys()) == {"day", "sales", "orders"}

    def test_top_items_capped_at_five(self, authed, base_url):
        top = authed.get(f"{base_url}/reports/summary").json()["topItems"]
        assert len(top) <= 5
