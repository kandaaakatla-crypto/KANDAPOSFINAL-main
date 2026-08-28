"""Iteration 8 — Staff/Workforce/Operations endpoints.

Covers: staff CRUD, timeclock punch + current + timesheet (+ CSV), shifts CRUD,
waste, cash drawer open/close, coupons create+apply, tips pool, locations
auto-seed + CRUD, prep-list shape, orders accepting tip/coupon/location fields.
"""

import pytest

pytestmark = pytest.mark.integration
import os
import time
import uuid as _uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TENANT = {"X-Tenant-Slug": "demo"}

MANAGER_PIN = "1234"
CASHIER_PIN = "2345"


def _login(pin: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"pin": pin}, headers=TENANT)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def mgr_headers():
    token = _login(MANAGER_PIN)
    return {**TENANT, "Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def cashier_headers():
    token = _login(CASHIER_PIN)
    return {**TENANT, "Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def created():
    return {}


# ---------- Staff CRUD ----------
class TestStaff:
    def test_list_staff_has_new_fields(self, mgr_headers):
        r = requests.get(f"{API}/staff", headers=mgr_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert len(data) >= 4
        for s in data:
            assert "active" in s and "hourly_rate" in s and "phone" in s

    def test_cashier_cannot_list_staff(self, cashier_headers):
        r = requests.get(f"{API}/staff", headers=cashier_headers)
        assert r.status_code in (401, 403)

    def test_create_update_delete(self, mgr_headers, created):
        # Use random unique 4-digit PINs not in the seeded set {1234,2345,3456,4567}
        import random
        pin1 = str(random.randint(7000, 8999))
        pin2 = str(random.randint(5000, 6999))
        payload = {"name": "TEST QA Worker", "role": "Cashier",
                   "pin": pin1, "phone": "5550000", "hourly_rate": 12.5, "active": True}
        r = requests.post(f"{API}/staff", json=payload, headers=mgr_headers)
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["hourly_rate"] == 12.5
        assert s["active"] is True
        created["staff_id"] = s["id"]

        # PIN reuse -> 409
        r2 = requests.post(f"{API}/staff", json={**payload, "name": "Other", "pin": pin1},
                           headers=mgr_headers)
        assert r2.status_code == 409

        # Update + rotate PIN
        upd = {"hourly_rate": 15.0, "pin": pin2}
        r3 = requests.put(f"{API}/staff/{s['id']}", json=upd, headers=mgr_headers)
        assert r3.status_code == 200, r3.text
        assert r3.json()["hourly_rate"] == 15.0

        # Rotated PIN clashes with manager's PIN
        r3b = requests.put(f"{API}/staff/{s['id']}", json={"pin": "1234"}, headers=mgr_headers)
        assert r3b.status_code == 409

        # Soft delete -> active False
        r4 = requests.delete(f"{API}/staff/{s['id']}", headers=mgr_headers)
        assert r4.status_code == 200
        r5 = requests.get(f"{API}/staff", headers=mgr_headers)
        match = [u for u in r5.json() if u["id"] == s["id"]]
        assert match and match[0]["active"] is False


# ---------- Time clock ----------
class TestTimeClock:
    def test_punch_in_then_out(self):
        # First punch -> in
        r1 = requests.post(f"{API}/timeclock/punch",
                           json={"pin": CASHIER_PIN, "selfie_b64": "data:image/png;base64,iVBORw=="},
                           headers=TENANT)
        assert r1.status_code == 200, r1.text
        assert r1.json()["type"] in ("in", "out")  # depends on existing state
        first_type = r1.json()["type"]
        assert r1.json()["selfie_b64"]

        time.sleep(1.2)
        r2 = requests.post(f"{API}/timeclock/punch", json={"pin": CASHIER_PIN}, headers=TENANT)
        assert r2.status_code == 200
        # toggled
        assert r2.json()["type"] != first_type

    def test_invalid_pin(self):
        r = requests.post(f"{API}/timeclock/punch", json={"pin": "0000"}, headers=TENANT)
        assert r.status_code == 401

    def test_current_and_timesheet(self, mgr_headers):
        # Ensure user is clocked-in for /current
        r0 = requests.post(f"{API}/timeclock/punch", json={"pin": CASHIER_PIN}, headers=TENANT)
        assert r0.status_code == 200
        if r0.json()["type"] == "out":
            time.sleep(1.2)
            requests.post(f"{API}/timeclock/punch", json={"pin": CASHIER_PIN}, headers=TENANT)

        rc = requests.get(f"{API}/timeclock/current", headers=mgr_headers)
        assert rc.status_code == 200
        assert isinstance(rc.json(), list)

        rt = requests.get(f"{API}/timeclock/timesheet", headers=mgr_headers)
        assert rt.status_code == 200
        rows = rt.json()
        assert isinstance(rows, list) and len(rows) >= 1
        assert {"user_id", "total_hours", "overtime_hours", "gross_pay"} <= set(rows[0].keys())

        rcsv = requests.get(f"{API}/timeclock/timesheet.csv", headers=mgr_headers)
        assert rcsv.status_code == 200
        assert rcsv.headers.get("content-type", "").startswith("text/csv")
        assert b"employee" in rcsv.content


# ---------- Shifts ----------
class TestShifts:
    def test_shift_crud(self, mgr_headers, cashier_headers, created):
        # Pick an existing seeded staff (not the QA-deleted one)
        r = requests.get(f"{API}/staff", headers=mgr_headers)
        target = next(s for s in r.json() if s["active"] and s["role"] != "Manager")
        start = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        end = (datetime.now(timezone.utc) + timedelta(hours=10)).isoformat()
        body = {"user_id": target["id"], "start": start, "end": end,
                "station": "Till 1", "published": False}
        rc = requests.post(f"{API}/shifts", json=body, headers=mgr_headers)
        assert rc.status_code == 200, rc.text
        sid = rc.json()["id"]
        created["shift_id"] = sid

        # Non-manager only sees published — should NOT see this unpublished shift
        rcl = requests.get(f"{API}/shifts", headers=cashier_headers)
        assert rcl.status_code == 200
        assert all(s["id"] != sid for s in rcl.json())

        # Publish range
        rp = requests.post(
            f"{API}/shifts/publish",
            headers=mgr_headers,
            params={"start": start, "end": end},
        )
        assert rp.status_code == 200
        assert rp.json()["published"] >= 1

        # PATCH
        ru = requests.patch(f"{API}/shifts/{sid}", json={"notes": "updated"}, headers=mgr_headers)
        assert ru.status_code == 200
        # DELETE
        rd = requests.delete(f"{API}/shifts/{sid}", headers=mgr_headers)
        assert rd.status_code == 200


# ---------- Waste ----------
class TestWaste:
    def test_waste_log_decrements_inventory(self, mgr_headers, created):
        inv = requests.get(f"{API}/inventory", headers=mgr_headers)
        assert inv.status_code == 200
        item = inv.json()[0]
        before = float(item["stock"])
        body = {"inventory_id": item["id"], "qty": 0.5, "reason": "TEST spoilage"}
        r = requests.post(f"{API}/waste", json=body, headers=mgr_headers)
        assert r.status_code == 200, r.text
        created.setdefault("waste_ids", []).append(r.json()["id"])
        # Inventory decreased
        inv2 = requests.get(f"{API}/inventory", headers=mgr_headers)
        assert inv2.status_code == 200, inv2.text
        items2 = inv2.json()
        same = next((i for i in items2 if isinstance(i, dict) and i.get("id") == item["id"]), None)
        assert same is not None
        assert round(float(same["stock"]), 2) == round(before - 0.5, 2)

    def test_waste_rejects_bad_input(self, mgr_headers):
        inv = requests.get(f"{API}/inventory", headers=mgr_headers).json()[0]
        r1 = requests.post(f"{API}/waste",
                           json={"inventory_id": inv["id"], "qty": 0, "reason": "x"},
                           headers=mgr_headers)
        assert r1.status_code == 400
        r2 = requests.post(f"{API}/waste",
                           json={"inventory_id": inv["id"], "qty": 1, "reason": "  "},
                           headers=mgr_headers)
        assert r2.status_code == 400


# ---------- Cash drawer ----------
class TestCashDrawer:
    def test_open_close_cycle(self, mgr_headers, created):
        # Close any pre-existing open drawer
        cur = requests.get(f"{API}/cashdrawer/current", headers=mgr_headers)
        if cur.status_code == 200 and cur.json():
            requests.post(f"{API}/cashdrawer/close", json={"counted_cash": 0}, headers=mgr_headers)

        r = requests.post(f"{API}/cashdrawer/open", json={"opening_float": 100.0}, headers=mgr_headers)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "open"
        created["drawer_id"] = r.json()["id"]

        r2 = requests.post(f"{API}/cashdrawer/open", json={"opening_float": 50}, headers=mgr_headers)
        assert r2.status_code == 409

        r3 = requests.post(f"{API}/cashdrawer/close",
                           json={"counted_cash": 150.0}, headers=mgr_headers)
        assert r3.status_code == 200, r3.text
        d = r3.json()
        assert d["status"] == "closed"
        assert d["expected_cash"] is not None
        assert d["variance"] == round(150.0 - d["expected_cash"], 2)


# ---------- Coupons ----------
class TestCoupons:
    def test_create_and_apply(self, mgr_headers, created):
        code = f"TEST{_uuid.uuid4().hex[:5].upper()}"
        body = {"code": code, "kind": "percent", "value": 10, "active": True}
        rc = requests.post(f"{API}/coupons", json=body, headers=mgr_headers)
        assert rc.status_code == 200, rc.text
        created["coupon_id"] = rc.json()["id"]
        created["coupon_code"] = code

        ra = requests.post(f"{API}/coupons/apply",
                           json={"code": code, "subtotal": 20.0}, headers=mgr_headers)
        assert ra.status_code == 200, ra.text
        out = ra.json()
        assert out["discount"] == 2.0
        assert out["new_total"] == 18.0

    def test_apply_inactive(self, mgr_headers, created):
        cid = created["coupon_id"]
        ru = requests.patch(f"{API}/coupons/{cid}", json={"active": False}, headers=mgr_headers)
        assert ru.status_code == 200
        ra = requests.post(f"{API}/coupons/apply",
                           json={"code": created["coupon_code"], "subtotal": 20.0},
                           headers=mgr_headers)
        assert ra.status_code == 400
        # Re-activate
        requests.patch(f"{API}/coupons/{cid}", json={"active": True}, headers=mgr_headers)


# ---------- Tips ----------
class TestTips:
    def test_create_tip_pool(self, mgr_headers, created):
        today = datetime.now(timezone.utc).date().isoformat()
        body = {"shift_date": today, "total_pool": 100.0}
        r = requests.post(f"{API}/tips", json=body, headers=mgr_headers)
        # If nobody clocked-in today, endpoint legitimately 400s.
        if r.status_code == 400:
            pytest.skip("No clocked-in hours for today")
        assert r.status_code == 200, r.text
        created.setdefault("tip_ids", []).append(r.json()["id"])
        total = sum(a["share"] for a in r.json()["allocations"])
        assert abs(total - 100.0) < 0.05


# ---------- Locations ----------
class TestLocations:
    def test_autoseed_and_crud(self, mgr_headers, created):
        r = requests.get(f"{API}/locations", headers=mgr_headers)
        assert r.status_code == 200, r.text
        locs = r.json()
        assert any(l["id"] == "loc_default" for l in locs)

        rc = requests.post(f"{API}/locations",
                           json={"name": "TEST Branch 2", "is_default": False, "active": True},
                           headers=mgr_headers)
        assert rc.status_code == 200, rc.text
        new_id = rc.json()["id"]
        created.setdefault("location_ids", []).append(new_id)

        rp = requests.patch(f"{API}/locations/{new_id}",
                            json={"is_default": True}, headers=mgr_headers)
        assert rp.status_code == 200
        # Default flipped
        r2 = requests.get(f"{API}/locations", headers=mgr_headers).json()
        defaults = [l for l in r2 if l["is_default"]]
        assert len(defaults) == 1 and defaults[0]["id"] == new_id

        # Flip back to loc_default and delete TEST branch
        requests.patch(f"{API}/locations/loc_default",
                       json={"is_default": True}, headers=mgr_headers)
        rd = requests.delete(f"{API}/locations/{new_id}", headers=mgr_headers)
        assert rd.status_code == 200

        # Refuse last remaining — simulate by trying to delete loc_default while it's the only one
        # (We don't actually delete loc_default to avoid disturbing demo data.)


# ---------- Prep ----------
class TestPrep:
    def test_prep_list_shape(self, mgr_headers):
        r = requests.get(f"{API}/prep-list", headers=mgr_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "generated_at" in data and "horizon_hours" in data and "items" in data
        assert isinstance(data["items"], list)


# ---------- Orders with new fields + Reports regression ----------
class TestOrdersAndReports:
    def test_order_with_tip_coupon_location(self, mgr_headers, created):
        # Create a fresh active coupon for the order
        code = f"TESTORD{_uuid.uuid4().hex[:4].upper()}"
        rc = requests.post(f"{API}/coupons",
                           json={"code": code, "kind": "percent", "value": 5, "active": True,
                                 "max_uses": 5},
                           headers=mgr_headers)
        assert rc.status_code == 200
        cid = rc.json()["id"]
        created.setdefault("coupon_ids", []).append(cid)

        # Grab a menu item
        menu = requests.get(f"{API}/menu/items", headers=mgr_headers).json()
        item = menu[0]
        price = float(item.get("price", 100) or 100)
        order_body = {
            "type": "dine-in",
            "customer": {"name": "TEST Customer", "phone": ""},
            "items": [{"menu_item_id": item["id"], "name": item["name"],
                       "qty": 1, "price": price,
                       "size": (item.get("sizes") or [None])[0]}],
            "total": price + 5.0,
            "deliveryFee": 0,
            "discount": 0,
            "payment": "cash",
            "tip": 5.0, "coupon_code": code, "location_id": "loc_default",
        }
        ro = requests.post(f"{API}/orders", json=order_body, headers=mgr_headers)
        assert ro.status_code in (200, 201), ro.text
        created.setdefault("order_ids", []).append(ro.json().get("id"))

        # Coupon used_count bumped
        rcoup = requests.get(f"{API}/coupons", headers=mgr_headers).json()
        this = next(c for c in rcoup if c["id"] == cid)
        assert int(this.get("used_count", 0)) >= 1

    def test_reports_summary_shape(self, mgr_headers):
        r = requests.get(f"{API}/reports/summary", headers=mgr_headers)
        assert r.status_code == 200, r.text
        d = r.json()
        # Sanity — must still have at least an orders/revenue summary
        assert isinstance(d, dict) and len(d) > 0


# ---------- Cleanup ----------
def test_zzz_cleanup(mgr_headers, created):
    """Best-effort teardown of QA-created data."""
    for cid in created.get("coupon_ids", []) + ([created["coupon_id"]] if "coupon_id" in created else []):
        requests.delete(f"{API}/coupons/{cid}", headers=mgr_headers)
    for lid in created.get("location_ids", []):
        requests.delete(f"{API}/locations/{lid}", headers=mgr_headers)
    for tid in created.get("tip_ids", []):
        requests.delete(f"{API}/tips/{tid}", headers=mgr_headers)
    # Waste/orders/staff(QA) — already DELETE'd or soft-deactivated within tests.
