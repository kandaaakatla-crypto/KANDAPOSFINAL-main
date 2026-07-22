"""Iteration 6 — 5-feature batch tests
Covers: Menu Categories CRUD, Recipes <-> Inventory decrement, Order `source`,
Driver claim/payment/onway/delivered, Tables CRUD + position + floor elements,
Reservations CRUD + overlap guard.
"""
import os
import time
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
TENANT_HEADER = {"X-Tenant-Slug": "demo"}


# -------------------- helpers --------------------
def _login(pin):
    r = requests.post(f"{BASE}/auth/login", json={"pin": pin}, headers=TENANT_HEADER, timeout=15)
    assert r.status_code == 200, f"login {pin} -> {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def mgr_h():
    t = _login("1234")
    return {"Authorization": f"Bearer {t}", **TENANT_HEADER}


@pytest.fixture(scope="module")
def cashier_h():
    t = _login("2345")
    return {"Authorization": f"Bearer {t}", **TENANT_HEADER}


@pytest.fixture(scope="module")
def driver_h():
    t = _login("4567")
    return {"Authorization": f"Bearer {t}", **TENANT_HEADER}


# ====================== 1. Menu Categories CRUD ======================
class TestCategoriesCRUD:
    def test_manager_create_update_delete_reorder(self, mgr_h):
        r = requests.post(f"{BASE}/menu/categories",
                          json={"name": "TEST_Cat_A", "color": "#ff0000", "sort_order": 99},
                          headers=mgr_h, timeout=10)
        assert r.status_code == 200, r.text
        cat = r.json()
        cid = cat["id"]
        assert cat["name"] == "TEST_Cat_A"
        assert cat["color"] == "#ff0000"

        # PUT rename + recolor
        r = requests.put(f"{BASE}/menu/categories/{cid}",
                         json={"name": "TEST_Cat_A2", "color": "#00ff00"},
                         headers=mgr_h, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "TEST_Cat_A2"

        # Reorder
        r = requests.get(f"{BASE}/menu/categories", headers=mgr_h, timeout=10)
        ids = [c["id"] for c in r.json()]
        rev = list(reversed(ids))
        r = requests.patch(f"{BASE}/menu/categories/reorder",
                           json={"order": rev}, headers=mgr_h, timeout=10)
        assert r.status_code == 200, r.text

        # DELETE
        r = requests.delete(f"{BASE}/menu/categories/{cid}", headers=mgr_h, timeout=10)
        assert r.status_code == 200, r.text

    def test_delete_refuses_when_items_reference(self, mgr_h):
        # Create a temp category and a menu item referencing it
        r = requests.post(f"{BASE}/menu/categories",
                          json={"name": "TEST_Cat_Ref", "color": "#123456", "sort_order": 0},
                          headers=mgr_h, timeout=10)
        cid = r.json()["id"]
        r = requests.post(f"{BASE}/menu/items",
                          json={"catId": cid, "name": "TEST_Item_Ref", "price": 100, "available": True},
                          headers=mgr_h, timeout=10)
        assert r.status_code == 200, r.text
        item_id = r.json()["id"]

        # DELETE refused 409
        r = requests.delete(f"{BASE}/menu/categories/{cid}", headers=mgr_h, timeout=10)
        assert r.status_code == 409, r.text

        # Cleanup
        requests.delete(f"{BASE}/menu/items/{item_id}", headers=mgr_h, timeout=10)
        r = requests.delete(f"{BASE}/menu/categories/{cid}", headers=mgr_h, timeout=10)
        assert r.status_code == 200

    def test_cashier_cannot_write(self, cashier_h):
        r = requests.post(f"{BASE}/menu/categories",
                          json={"name": "TEST_Cashier", "color": "#fff", "sort_order": 0},
                          headers=cashier_h, timeout=10)
        assert r.status_code == 403, r.text


# ====================== 2. Recipes + inventory decrement ======================
class TestRecipesInventoryDecrement:
    def test_recipe_upsert_and_inventory_decrement_on_order(self, mgr_h, cashier_h):
        # Pick a menu item + an inventory item
        items = requests.get(f"{BASE}/menu/items", headers=mgr_h, timeout=10).json()
        assert items, "No menu items seeded"
        item = items[0]
        inv = requests.get(f"{BASE}/inventory", headers=mgr_h, timeout=10).json()
        assert inv, "No inventory seeded"
        # Find an inventory item with non-zero qty if possible
        ing = next((x for x in inv if (x.get("qty") or x.get("quantity") or 0) > 5), inv[0])
        # Top it up so we can decrement
        inv_id_key = "id" if "id" in ing else "_id"
        inv_id = ing[inv_id_key]
        # Use adjust endpoint to set known starting qty
        try:
            requests.post(f"{BASE}/inventory/{inv_id}/adjust", json={"delta": 100},
                          headers=mgr_h, timeout=10)
        except Exception:
            pass
        # Re-fetch starting qty
        inv2 = requests.get(f"{BASE}/inventory", headers=mgr_h, timeout=10).json()
        ing2 = next((x for x in inv2 if x.get(inv_id_key) == inv_id), ing)
        start_qty = float(ing2.get("stock") or ing2.get("qty") or 0)

        # Save recipe (size=None)
        r = requests.put(
            f"{BASE}/menu/items/{item['id']}/recipes",
            json={"recipes": [{
                "menu_item_id": item["id"],
                "size": None,
                "ingredients": [{"inventory_id": inv_id, "qty": 1}],
            }]},
            headers=mgr_h, timeout=10,
        )
        assert r.status_code == 200, r.text

        # GET returns it
        r = requests.get(f"{BASE}/menu/items/{item['id']}/recipes", headers=mgr_h, timeout=10)
        assert r.status_code == 200
        recipes = r.json()
        assert len(recipes) == 1
        assert recipes[0]["ingredients"][0]["inventory_id"] == inv_id

        # Place order with quantity 2 -> should decrement by 2
        order_payload = {
            "type": "collection",
            "customer": {"id": None, "name": "TEST_RecipeOrder", "phone": "9999911111"},
            "items": [{
                "menu_item_id": item["id"], "name": item["name"],
                "qty": 2, "price": item.get("price", 100),
            }],
            "deliveryFee": 0, "discount": 0,
            "total": (item.get("price", 100) or 100) * 2,
            "payment": "unpaid",
        }
        r = requests.post(f"{BASE}/orders", json=order_payload, headers=cashier_h, timeout=15)
        assert r.status_code == 200, r.text

        # Verify inventory dropped
        inv_after = requests.get(f"{BASE}/inventory", headers=mgr_h, timeout=10).json()
        match = next((x for x in inv_after if x.get(inv_id_key) == inv_id), None)
        end_qty = float(match.get("stock") or match.get("qty") or 0)
        pytest.assume = None  # noqa
        # Expectation per spec: end_qty == start_qty - 2
        assert end_qty == start_qty - 2, (
            f"Recipe-driven inventory decrement failed: start={start_qty} end={end_qty} expected={start_qty - 2}"
        )

        # Cleanup recipe
        requests.put(f"{BASE}/menu/items/{item['id']}/recipes",
                     json={"recipes": []}, headers=mgr_h, timeout=10)


# ====================== 3. Order source field ======================
class TestOrderSource:
    def test_source_persists(self, cashier_h):
        items = requests.get(f"{BASE}/menu/items", headers=cashier_h, timeout=10).json()
        assert items
        it = items[0]
        payload = {
            "type": "collection",
            "customer": {"id": None, "name": "TEST_Swiggy", "phone": "9999922222"},
            "items": [{"menu_item_id": it["id"], "name": it["name"], "qty": 1, "price": it.get("price", 100)}],
            "deliveryFee": 0, "discount": 0,
            "total": it.get("price", 100),
            "payment": "unpaid",
            "source": "swiggy",
        }
        r = requests.post(f"{BASE}/orders", json=payload, headers=cashier_h, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("source") == "swiggy", f"source not persisted in POST response: {body}"

        # Verify on list
        lst = requests.get(f"{BASE}/orders", headers=cashier_h, timeout=10).json()
        match = next((o for o in lst if o["id"] == body["id"]), None)
        assert match is not None
        assert match.get("source") == "swiggy", f"source missing in GET /orders: {match}"


# ====================== 4. Driver claim/payment/onway/delivered ======================
class TestDriverFlow:
    def test_claim_payment_status_lifecycle(self, cashier_h, driver_h, mgr_h):
        items = requests.get(f"{BASE}/menu/items", headers=cashier_h, timeout=10).json()
        it = items[0]
        # Create an unclaimed delivery order (status=ready)
        payload = {
            "type": "delivery",
            "status": "ready",
            "customer": {"id": None, "name": "TEST_DrvCust", "phone": "9999933333",
                         "address": "1 Test St"},
            "items": [{"menu_item_id": it["id"], "name": it["name"], "qty": 1, "price": it.get("price", 100)}],
            "deliveryFee": 30, "discount": 0,
            "total": it.get("price", 100) + 30,
            "payment": "unpaid",
        }
        r = requests.post(f"{BASE}/orders", json=payload, headers=cashier_h, timeout=15)
        assert r.status_code == 200, r.text
        oid = r.json()["id"]

        # 4a. Non-driver cannot claim → 403
        r = requests.post(f"{BASE}/orders/{oid}/claim", headers=cashier_h, timeout=10)
        assert r.status_code == 403, f"cashier claim should be 403, got {r.status_code} {r.text}"

        # 4b. Driver claims → 200
        r = requests.post(f"{BASE}/orders/{oid}/claim", headers=driver_h, timeout=10)
        assert r.status_code == 200, f"driver claim failed: {r.status_code} {r.text}"

        # 4c. Second claim should be 404 (already-claimed)
        # Second driver attempt — re-claim same order
        r2 = requests.post(f"{BASE}/orders/{oid}/claim", headers=driver_h, timeout=10)
        assert r2.status_code == 404, f"re-claim should 404, got {r2.status_code}"

        # 4d. PATCH /payment → cash
        r = requests.patch(f"{BASE}/orders/{oid}/payment",
                           json={"payment": "cash"}, headers=driver_h, timeout=10)
        assert r.status_code == 200, f"payment patch failed: {r.status_code} {r.text}"
        assert r.json().get("payment") == "cash"

        # 4e. Invalid payment value → 422
        r = requests.patch(f"{BASE}/orders/{oid}/payment",
                           json={"payment": "bitcoin"}, headers=driver_h, timeout=10)
        assert r.status_code == 422, f"invalid payment should 422, got {r.status_code}"

        # 4f. Status transitions: out-for-delivery → completed
        r = requests.patch(f"{BASE}/orders/{oid}/status",
                           json={"status": "out-for-delivery"}, headers=driver_h, timeout=10)
        assert r.status_code == 200
        r = requests.patch(f"{BASE}/orders/{oid}/status",
                           json={"status": "completed"}, headers=driver_h, timeout=10)
        assert r.status_code == 200


# ====================== 5. Tables CRUD + position + floor ======================
class TestTablesLayout:
    def test_create_position_delete(self, mgr_h):
        # Pick an unused high number
        existing = {t["number"] for t in requests.get(f"{BASE}/tables", headers=mgr_h, timeout=10).json()}
        tbl_num = next(n for n in range(95, 200) if n not in existing)
        r = requests.post(f"{BASE}/tables",
                          json={"number": tbl_num, "seats": 4, "x": 100, "y": 100,
                                "width": 80, "height": 80, "shape": "square", "rotation": 0},
                          headers=mgr_h, timeout=10)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]

        # Update position
        r = requests.patch(f"{BASE}/tables/{tid}/position",
                           json={"x": 200, "y": 250, "width": 100, "height": 100,
                                 "shape": "round", "rotation": 15},
                           headers=mgr_h, timeout=10)
        assert r.status_code == 200, r.text
        # NOTE: table_doc_to_response strips shape/rotation/x/y/width/height
        # so this returned doc won't include them; bug noted in report.

        # Delete
        r = requests.delete(f"{BASE}/tables/{tid}", headers=mgr_h, timeout=10)
        assert r.status_code == 200

    def test_cashier_cannot_create_table(self, cashier_h):
        r = requests.post(f"{BASE}/tables",
                          json={"number": 98, "seats": 2, "x": 0, "y": 0,
                                "width": 50, "height": 50, "shape": "square", "rotation": 0},
                          headers=cashier_h, timeout=10)
        assert r.status_code == 403, r.text

    def test_floor_elements_crud(self, mgr_h):
        r = requests.post(f"{BASE}/tables/floor",
                          json={"kind": "wall", "x": 10, "y": 10, "width": 200,
                                "height": 5, "rotation": 0, "label": "TEST_wall"},
                          headers=mgr_h, timeout=10)
        assert r.status_code == 200, r.text
        feid = r.json()["id"]
        r = requests.patch(f"{BASE}/tables/floor/{feid}",
                           json={"label": "TEST_wall2"}, headers=mgr_h, timeout=10)
        assert r.status_code == 200
        r = requests.delete(f"{BASE}/tables/floor/{feid}", headers=mgr_h, timeout=10)
        assert r.status_code == 200


# ====================== 6. Reservations ======================
class TestReservations:
    def test_create_overlap_update_delete(self, mgr_h):
        # pick first table
        tables = requests.get(f"{BASE}/tables", headers=mgr_h, timeout=10).json()
        assert tables
        tid = tables[0]["id"]
        future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
        payload = {"table_id": tid, "customer_name": "TEST_Res", "phone": "9999944444",
                   "party_size": 2, "at": future, "duration_min": 90}
        r = requests.post(f"{BASE}/reservations", json=payload, headers=mgr_h, timeout=10)
        assert r.status_code == 200, r.text
        rid = r.json()["id"]

        # Overlap
        overlap_payload = dict(payload, customer_name="TEST_Res2")
        r = requests.post(f"{BASE}/reservations", json=overlap_payload, headers=mgr_h, timeout=10)
        assert r.status_code == 409, f"overlap should be 409, got {r.status_code} {r.text}"

        # List with filter
        r = requests.get(f"{BASE}/reservations", headers=mgr_h, timeout=10)
        assert r.status_code == 200
        assert any(x["id"] == rid for x in r.json())

        # Update status
        r = requests.patch(f"{BASE}/reservations/{rid}",
                           json={"status": "seated"}, headers=mgr_h, timeout=10)
        assert r.status_code == 200
        assert r.json()["status"] == "seated"

        # Delete
        r = requests.delete(f"{BASE}/reservations/{rid}", headers=mgr_h, timeout=10)
        assert r.status_code == 200


# ====================== 7. Driver route auto-routing (just verifies login returns driver role) ======================
class TestDriverAuth:
    def test_driver_role_returned(self):
        t = _login("4567")
        me = requests.get(f"{BASE}/auth/me",
                          headers={"Authorization": f"Bearer {t}", **TENANT_HEADER}, timeout=10)
        assert me.status_code == 200
        assert me.json().get("role", "").lower() == "driver"
