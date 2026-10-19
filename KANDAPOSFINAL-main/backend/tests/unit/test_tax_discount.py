"""Master Test Report P0-2: GST was computed on the pre-discount amount.
₹1,358 with 10% off showed GST ₹67.90 (5% of ₹1,358) instead of ₹61.11 (5%
of ₹1,222.20). The taxable value is subtotal minus discount; the total is
unchanged by this fix for the customer's item cost, only the tax is.
"""
import pytest

from tax import apply_taxable_discount


def test_exclusive_discount_reduces_tax_report_example_a():
    # Restaurant (tax added on top): subtotal 1358, GST 67.90, 10% = 135.80 off.
    sub, tax, items_total = apply_taxable_discount(1358.00, 67.90, 135.80, inclusive=False)
    assert sub == 1222.20
    assert tax == 61.11
    assert items_total == 1283.31


def test_exclusive_coupon_report_example_b():
    sub, tax, items_total = apply_taxable_discount(399.00, 19.95, 199.50, inclusive=False)
    assert sub == 199.50
    assert tax == 9.98  # 9.975 rounds half up
    assert items_total == 209.48


def test_inclusive_discount_comes_off_the_gross_and_tax_is_re_extracted():
    # Retail MRP: gross 1180 incl. 180 GST (18%); ₹118 off -> gross 1062.
    sub, tax, items_total = apply_taxable_discount(1000.00, 180.00, 118.00, inclusive=True)
    assert items_total == 1062.00
    assert tax == 162.00
    assert sub == 900.00


def test_no_discount_is_identity():
    assert apply_taxable_discount(500.0, 25.0, 0, inclusive=False) == (500.0, 25.0, 525.0)


def test_discount_is_clamped_to_the_base():
    sub, tax, items_total = apply_taxable_discount(100.0, 5.0, 9999.0, inclusive=False)
    assert (sub, tax, items_total) == (0.0, 0.0, 0.0)


@pytest.mark.parametrize("discount", [-5, None])
def test_negative_or_missing_discount_is_ignored(discount):
    assert apply_taxable_discount(100.0, 5.0, discount, inclusive=False) == (100.0, 5.0, 105.0)


# ---------- end to end through POST /api/orders (needs the Mongo harness) ----------

def _token(client) -> str:
    r = client.post("/api/auth/login", json={"pin": "1234"}, headers={"X-Forwarded-For": "203.0.113.71"})
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
    r = client.post("/api/orders", json=payload, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    return r.json()


def test_order_gst_is_on_the_discounted_value(client):
    token = _token(client)
    # Margherita ₹200 @5%: 10% discount (₹20) -> taxable 180, GST 9.00, total 189.00
    o = _place(client, token, discount=20, total=189)
    assert o["subtotal"] == 180.00
    assert o["taxTotal"] == 9.00
    assert o["total"] == 189.00


def test_gift_card_tender_does_not_reduce_gst(client):
    token = _token(client)
    # ₹50 of the discount is a tender (gift card): GST stays on the full 200.
    o = _place(client, token, discount=50, taxable_discount=0, total=160)
    assert o["subtotal"] == 200.00
    assert o["taxTotal"] == 10.00
    assert o["total"] == 160.00


def test_cgst_sgst_split_gives_odd_paisa_to_sgst(client):
    token = _token(client)
    # ₹399 @5% with 50% off -> GST 9.975 -> 9.98
    o = _place(client, token, items=[{"name": "Margherita", "qty": 1, "price": 399}], discount=199.5, total=209.48)
    assert o["taxTotal"] == 9.98
    assert o["cgst"] + o["sgst"] == pytest.approx(9.98)
    assert o["cgst"] == 4.99 and o["sgst"] == 4.99
