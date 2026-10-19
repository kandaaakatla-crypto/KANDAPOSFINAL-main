"""Indian restaurants take money by cash, UPI (their own QR) and their own
card machine. The POS only knew cash and Razorpay card, so UPI and machine
card sales had no way to be recorded, and a split bill's cash half was lost
when the Razorpay half didn't go through. Record-only tenders are now first
class: orders can be created or settled as upi / card_machine / other, and a
split of cash + UPI is paid at once with the cash part in the drawer.
"""
import uuid

import pytest


def _h(client):
    r = client.post("/api/auth/login", json={"pin": "1234"}, headers={"X-Forwarded-For": "203.0.113.161"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _order(client, h, **kw):
    p = {"type": "collection", "customer": {"name": "Walk-in"},
         "items": [{"name": "Masala Dosa", "qty": 1, "price": 200}], "total": 210, "payment": "unpaid",
         "client_ref": f"lo_{uuid.uuid4().hex}"}
    p.update(kw)
    r = client.post("/api/orders", json=p, headers=h)
    return r


@pytest.mark.parametrize("method", ["upi", "card_machine", "other"])
def test_order_can_be_paid_by_record_only_tender(client, method):
    h = _h(client)
    r = _order(client, h, payment=method)
    assert r.status_code == 200, r.text
    assert r.json()["payment"] == method


def test_split_cash_and_upi_is_paid_immediately(client):
    h = _h(client)
    first = _order(client, h).json()
    total = first["total"]
    r = _order(client, h, payment="split", splits=[{"method": "cash", "amount": 100}, {"method": "upi", "amount": round(total - 100, 2)}])
    assert r.status_code == 200, r.text
    assert r.json()["payment"] == "split"
    assert [s["method"] for s in r.json()["splits"]] == ["cash", "upi"]


def test_running_tab_can_be_settled_by_upi(client):
    h = _h(client)
    o = _order(client, h).json()
    r = client.patch(f"/api/orders/{o['id']}/payment", json={"payment": "upi"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["payment"] == "upi"


def test_running_tab_settled_by_split_keeps_the_cash_half(client):
    h = _h(client)
    o = _order(client, h).json()
    splits = [{"method": "cash", "amount": 50}, {"method": "card_machine", "amount": round(o["total"] - 50, 2)}]
    r = client.patch(f"/api/orders/{o['id']}/payment", json={"payment": "split", "splits": splits}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["payment"] == "split"
    assert r.json()["splits"][0] == {"method": "cash", "amount": 50.0}


def test_split_settlement_must_add_up(client):
    h = _h(client)
    o = _order(client, h).json()
    r = client.patch(f"/api/orders/{o['id']}/payment",
                     json={"payment": "split", "splits": [{"method": "cash", "amount": 1}, {"method": "upi", "amount": 1}]}, headers=h)
    assert r.status_code == 400, r.text


def test_upi_paid_order_cannot_have_items_appended(client):
    h = _h(client)
    o = _order(client, h, payment="upi").json()
    r = client.post(f"/api/orders/{o['id']}/append", json={"items": [{"name": "Tea", "qty": 1, "price": 20}]}, headers=h)
    assert r.status_code == 400, r.text


def test_dashboard_summary_counts_upi_and_split_parts(client):
    h = _h(client)
    before = client.get("/api/reports/summary", headers=h).json()
    o = _order(client, h).json()
    client.patch(f"/api/orders/{o['id']}/payment", json={"payment": "split", "splits": [
        {"method": "cash", "amount": 10}, {"method": "upi", "amount": round(o["total"] - 10, 2)}]}, headers=h)
    after = client.get("/api/reports/summary", headers=h).json()
    assert round(after["upiTotal"] - before.get("upiTotal", 0), 2) == round(o["total"] - 10, 2)
    assert round(after["cashTotal"] - before["cashTotal"], 2) == 10


def test_receipt_label_for_split_and_machine():
    from receipts import paid_by_label
    assert paid_by_label({"payment": "card_machine"}) == "CARD"
    assert paid_by_label({"payment": "split", "splits": [{"method": "cash", "amount": 50}, {"method": "upi", "amount": 160}]}) == "CASH 50.00 + UPI 160.00"
