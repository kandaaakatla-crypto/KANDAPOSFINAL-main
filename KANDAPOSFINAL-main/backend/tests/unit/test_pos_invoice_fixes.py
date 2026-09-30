"""Regression tests for the Sept 2026 POS fixes (rupee glyph on the PDF
invoice, refunds reflected on receipts, dine-in customer details on the
invoice, an optional, off-by-default service charge, and the table layout
editor saving seat counts).

Uses the seeded demo tenant (Manager PIN 1234). Margherita has no fixed
price in the seed (it's a sized pizza), so every order here sends it at
₹200 — restaurant GST is 5% exclusive, so the base order is 200 + 10 GST.
"""
import pytest

import receipts

DEMO_MANAGER_PIN = "1234"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def token(client) -> str:
    r = client.post(
        "/api/auth/login",
        json={"pin": DEMO_MANAGER_PIN},
        headers={"X-Forwarded-For": "203.0.113.61"},
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _place(client, token, **overrides) -> dict:
    payload = {
        "type": "collection",
        "customer": {"name": "Walk-in"},
        "items": [{"name": "Margherita", "qty": 1, "price": 200}],
        "total": 210,
        "payment": "unpaid",
    }
    payload.update(overrides)
    r = client.post("/api/orders", json=payload, headers=_auth(token))
    assert r.status_code == 200, r.text
    return r.json()


# ---------- ₹ glyph on the PDF invoice ----------

def test_invoice_pdf_uses_a_font_with_a_rupee_glyph():
    """Helvetica (reportlab's built-in default) has no U+20B9, which is what
    printed filled black squares in place of every ₹ on the tax invoice."""
    from reportlab.pdfbase import pdfmetrics

    regular, bold = receipts._invoice_fonts()
    for name in (regular, bold):
        font = pdfmetrics.getFont(name)
        assert hasattr(font, "face"), f"{name} is a built-in Type1 font with no ₹ glyph"
        assert 0x20B9 in font.face.charToGlyph, f"{name} has no ₹ glyph"

    pdf = receipts._render_invoice_pdf(
        {"number": 1, "items": [{"name": "X", "qty": 1, "price": 100, "tax_rate": 5, "tax_amount": 5}],
         "subtotal": 100, "taxTotal": 5, "cgst": 2.5, "sgst": 2.5, "total": 105, "payment": "cash"},
        receipts.FALLBACK_STORE, "Cashier",
    )
    assert pdf.startswith(b"%PDF")
    assert regular.encode() in pdf


# ---------- Refunds show on the receipt ----------

def test_receipt_reflects_refund(client, token, monkeypatch):
    order = _place(client, token, payment="cash")
    assert order["total"] == 210

    from routes import refunds as refunds_mod
    events = []
    monkeypatch.setattr(refunds_mod, "schedule_broadcast", lambda evt, data, tid: events.append((evt, data)))

    r = client.post(
        f"/api/orders/{order['id']}/refund",
        json={"amount": 50, "reason": "Wrong item"},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    # Other terminals (and this one's cached order) must learn about it.
    upserts = [d for e, d in events if e == "order.upserted"]
    assert upserts and upserts[-1]["refunded_amount"] == 50

    rec = client.get(f"/api/orders/{order['id']}/receipt", headers=_auth(token)).json()
    assert rec["refundedAmount"] == 50
    assert rec["netTotal"] == 160

    esc = client.get(f"/api/orders/{order['id']}/receipt/escpos", headers=_auth(token)).content
    assert b"Refunded" in esc
    assert b"Net paid" in esc

    labels = [row[0] for row in receipts._summary_rows(rec["order"])]
    assert "Refunded" in labels
    assert "NET PAID" in labels


def test_void_is_broadcast_and_marked_on_receipt(client, token, monkeypatch):
    order = _place(client, token)
    from routes import refunds as refunds_mod
    events = []
    monkeypatch.setattr(refunds_mod, "schedule_broadcast", lambda evt, data, tid: events.append((evt, data)))

    r = client.post(f"/api/orders/{order['id']}/void", json={"reason": "Mis-key"}, headers=_auth(token))
    assert r.status_code == 200, r.text
    upserts = [d for e, d in events if e == "order.upserted"]
    assert upserts and upserts[-1]["voided"] is True

    esc = client.get(f"/api/orders/{order['id']}/receipt/escpos", headers=_auth(token)).content
    assert b"VOID" in esc


# ---------- Customer details on dine-in orders + invoice ----------

def test_customer_details_can_be_added_to_existing_order(client, token):
    order = _place(client, token, type="dine-in", table=11, customer={"name": "Table 11"})
    r = client.patch(
        f"/api/orders/{order['id']}/customer",
        json={"name": "Anita Rao", "phone": "+919876543210", "address": "Road 3, Jubilee Hills",
              "postcode": "500033", "gstin": "36AAACB1234C1Z9", "email": "anita@example.com"},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["customer"]["gstin"] == "36AAACB1234C1Z9"
    assert body["customer"]["name"] == "Anita Rao"
    assert body["table"] == 11

    lines = receipts._bill_to_lines(body)
    joined = " | ".join(lines)
    assert "Anita Rao" in joined
    assert "+919876543210" in joined
    assert "GSTIN: 36AAACB1234C1Z9" in joined
    assert "anita@example.com" in joined


def test_dine_in_table_placeholder_is_not_printed_as_customer():
    lines = receipts._bill_to_lines({"type": "dine-in", "table": 2, "customer": {"name": "Table 2"}})
    assert lines == []


def test_order_create_keeps_customer_gstin(client, token):
    order = _place(client, token, type="dine-in", table=10,
                   customer={"name": "Ravi", "phone": "+919000000001", "gstin": "36ABCDE1234F1Z5"})
    assert order["customer"]["gstin"] == "36ABCDE1234F1Z5"


# ---------- Optional service charge ----------

def test_service_charge_is_off_by_default(client, token):
    order = _place(client, token)
    assert order["serviceCharge"] == 0
    assert order["serviceChargePct"] == 0
    assert order["total"] == 210


def test_service_charge_can_be_added_later_and_removed(client, token):
    order = _place(client, token, type="dine-in", table=12, customer={"name": "Table 12"})
    oid = order["id"]

    r = client.patch(f"/api/orders/{oid}/service-charge", json={"pct": 10}, headers=_auth(token))
    assert r.status_code == 200, r.text
    o = r.json()
    assert o["serviceChargePct"] == 10
    assert o["serviceCharge"] == 20          # 10% of the ₹200 taxable subtotal
    assert o["serviceChargeTax"] == 1        # GST on the charge at the bill's 5% rate
    assert o["taxTotal"] == 11
    assert o["cgst"] + o["sgst"] == pytest.approx(11)
    assert o["total"] == 231

    # Items added to the running tab pick up the same service charge rate.
    r = client.post(f"/api/orders/{oid}/append",
                    json={"items": [{"name": "Margherita", "qty": 1, "price": 200}]}, headers=_auth(token))
    assert r.status_code == 200, r.text
    o = r.json()
    assert o["serviceCharge"] == 40
    assert o["serviceChargeTax"] == 2
    assert o["total"] == 462

    labels = [row[0] for row in receipts._summary_rows(o)]
    assert "Service charge (10%)" in labels

    r = client.patch(f"/api/orders/{oid}/service-charge", json={"pct": 0}, headers=_auth(token))
    o = r.json()
    assert o["serviceCharge"] == 0
    assert o["taxTotal"] == 20
    assert o["total"] == 420


def test_service_charge_can_be_chosen_at_checkout(client, token):
    order = _place(client, token, service_charge_pct=10, total=231)
    assert order["serviceCharge"] == 20
    assert order["total"] == 231


def test_service_charge_rejected_on_paid_order(client, token):
    order = _place(client, token, payment="cash")
    r = client.patch(f"/api/orders/{order['id']}/service-charge", json={"pct": 10}, headers=_auth(token))
    assert r.status_code == 400


# ---------- Table layout editor ----------

def test_layout_save_persists_seat_count(client, token):
    """The layout editor's side panel edits seats, but the position endpoint
    it saves through used to silently drop them."""
    tables = client.get("/api/tables", headers=_auth(token)).json()
    t = next(x for x in tables if x["number"] == 1)
    r = client.patch(
        f"/api/tables/{t['id']}/position",
        json={"x": 120, "y": 40, "width": 80, "height": 80, "shape": "round", "rotation": 0, "seats": 3},
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["x"], body["y"], body["shape"], body["seats"]) == (120, 40, "round", 3)

    # Omitting seats (older clients) leaves the count alone.
    r = client.patch(f"/api/tables/{t['id']}/position", json={"x": 10, "y": 10}, headers=_auth(token))
    assert r.json()["seats"] == 3
