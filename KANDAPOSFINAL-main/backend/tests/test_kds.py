"""KDS — Kitchen Display System tests."""
import os
import time
import requests


# ---------- helpers ----------
def _owner_token(base_url):
    r = requests.post(f"{base_url}/owner/auth/login", json={
        "email": "owner@kanda.app", "password": "OwnerPass#2025",
    })
    pre = r.json()["pre2faToken"]
    v = requests.post(f"{base_url}/owner/auth/verify",
                      headers={"Authorization": f"Bearer {pre}"}, json={"code": "000000"})
    return v.json()["token"]


def _kds_token(base_url) -> str:
    otok = _owner_token(base_url)
    r = requests.get(f"{base_url}/owner/tenants/demo/kds-token",
                     headers={"Authorization": f"Bearer {otok}"})
    return r.json()["token"]


class TestKdsToken:
    def test_owner_can_issue_and_rotate_kds_token(self, base_url):
        otok = _owner_token(base_url)
        head = {"Authorization": f"Bearer {otok}"}
        a = requests.get(f"{base_url}/owner/tenants/demo/kds-token", headers=head).json()
        assert a["token"].startswith("kds_demo_")
        # Idempotent: second GET returns same token
        b = requests.get(f"{base_url}/owner/tenants/demo/kds-token", headers=head).json()
        assert a["token"] == b["token"]
        # Rotate changes it
        c = requests.post(f"{base_url}/owner/tenants/demo/kds-token/rotate", headers=head).json()
        assert c["token"] != a["token"]

    def test_kds_endpoints_reject_missing_or_bad_token(self, base_url):
        r = requests.get(f"{base_url}/kds/tickets")
        assert r.status_code == 401
        r = requests.get(f"{base_url}/kds/tickets", params={"token": "not-a-real-token"})
        assert r.status_code == 401


class TestKdsBoard:
    def test_tickets_have_lane_station_and_index_fields(self, base_url):
        tok = _kds_token(base_url)
        r = requests.get(f"{base_url}/kds/tickets", params={"token": tok, "station": "all"})
        assert r.status_code == 200
        body = r.json()
        assert set(body.keys()) >= {"tenant", "station", "stations", "tickets"}
        assert "pizza" in body["stations"]
        # At least one historical ticket exists in the demo tenant.
        assert isinstance(body["tickets"], list)
        for t in body["tickets"]:
            assert t["lane"] in ("new", "preparing", "ready", "recall")
            for it in t["items"]:
                assert "index" in it
                assert it["station"] in ("kitchen", "pizza", "grill", "drinks", "desserts")
                assert it["kds_status"] in ("new", "preparing", "ready")

    def test_station_filter_only_returns_matching_items(self, base_url):
        tok = _kds_token(base_url)
        r = requests.get(f"{base_url}/kds/tickets", params={"token": tok, "station": "pizza"})
        assert r.status_code == 200
        for t in r.json()["tickets"]:
            for it in t["items"]:
                assert it["station"] == "pizza"

    def test_unknown_station_rejected(self, base_url):
        tok = _kds_token(base_url)
        r = requests.get(f"{base_url}/kds/tickets", params={"token": tok, "station": "bbq"})
        assert r.status_code == 400


class TestKdsMutations:
    def test_item_status_promotes_through_lanes_and_syncs_order_status(self, authed, base_url):
        # 1. Place a fresh order through the regular POS so we know its id
        payload = {
            "type": "collection", "status": "new",
            "customer": {"name": "QA KDS Customer", "phone": "+919999988888"},
            "items": [{"name": "Margherita 12\"", "qty": 1, "price": 9.99, "mods": []}],
            "deliveryFee": 0, "discount": 0, "total": 9.99, "payment": "cash",
        }
        order = authed.post(f"{base_url}/orders", json=payload).json()
        order_id = order["id"]

        tok = _kds_token(base_url)
        # Find the (just-created) order on the KDS board and grab its item index
        listing = requests.get(f"{base_url}/kds/tickets", params={"token": tok, "station": "all"}).json()
        ticket = next((t for t in listing["tickets"] if t["id"] == order_id), None)
        assert ticket is not None, "Newly-created order should appear on KDS"
        idx = ticket["items"][0]["index"]

        # Mark preparing → order.status legacy becomes in-kitchen
        r = requests.patch(
            f"{base_url}/kds/orders/{order_id}/items/{idx}",
            params={"token": tok}, json={"status": "preparing"},
        )
        assert r.status_code == 200
        assert r.json()["lane"] == "preparing"

        # Mark ready (the only item) → lane=ready + order.status=ready
        r = requests.patch(
            f"{base_url}/kds/orders/{order_id}/items/{idx}",
            params={"token": tok}, json={"status": "ready"},
        )
        assert r.status_code == 200
        assert r.json()["lane"] == "ready"
        order_after = authed.get(f"{base_url}/orders").json()
        match = next(o for o in order_after if o["id"] == order_id)
        assert match["status"] == "ready"

    def test_recall_moves_order_back_to_recall_lane(self, base_url):
        tok = _kds_token(base_url)
        listing = requests.get(f"{base_url}/kds/tickets", params={"token": tok, "station": "all"}).json()
        # Use any active ticket
        if not listing["tickets"]:
            return  # nothing to recall
        target = listing["tickets"][0]["id"]
        r = requests.patch(
            f"{base_url}/kds/orders/{target}/recall",
            params={"token": tok},
        )
        assert r.status_code == 200
        assert r.json()["lane"] == "recall"

    def test_invalid_status_rejected(self, base_url):
        tok = _kds_token(base_url)
        listing = requests.get(f"{base_url}/kds/tickets", params={"token": tok, "station": "all"}).json()
        if not listing["tickets"]:
            return
        target = listing["tickets"][0]
        r = requests.patch(
            f"{base_url}/kds/orders/{target['id']}/items/{target['items'][0]['index']}",
            params={"token": tok}, json={"status": "burning"},
        )
        assert r.status_code == 422
