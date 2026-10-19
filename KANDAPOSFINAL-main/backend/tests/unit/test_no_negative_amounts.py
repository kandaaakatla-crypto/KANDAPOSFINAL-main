"""Orders accepted negative quantities, prices, discounts, tips and delivery
fees. A till could ring up qty -3 and take money out of the day's sales, and
the public QR/pickup cart (no login at all) accepted qty -5, giving a
negative bill. Every amount a client sends is now checked at the edge.
Pure schema tests (no server needed).
"""
import pytest
from pydantic import ValidationError

from models import OrderAppendPayload, OrderCreate
from routes.storefront import CartLine

ITEM = {"name": "Tea", "qty": 1, "price": 20}
ORDER = {"type": "collection", "customer": {"name": "Walk-in"}, "items": [ITEM], "total": 21}


@pytest.mark.parametrize("bad_item", [
    {**ITEM, "qty": -3}, {**ITEM, "qty": 0}, {**ITEM, "price": -20},
])
def test_order_items_must_be_positive(bad_item):
    with pytest.raises(ValidationError):
        OrderCreate(**{**ORDER, "items": [bad_item]})
    with pytest.raises(ValidationError):
        OrderAppendPayload(items=[bad_item])


@pytest.mark.parametrize("field", ["discount", "tip", "deliveryFee", "total", "redeem_store_credit",
                                   "gift_card_amount", "redeem_loyalty_points"])
def test_order_amounts_cannot_be_negative(field):
    with pytest.raises(ValidationError):
        OrderCreate(**{**ORDER, field: -50})


def test_normal_order_and_free_item_still_accepted():
    o = OrderCreate(**{**ORDER, "items": [ITEM, {**ITEM, "name": "Water", "price": 0}], "discount": 5, "tip": 10})
    assert len(o.items) == 2


@pytest.mark.parametrize("qty", [-5, 0, 1000])
def test_public_cart_quantity_is_bounded(qty):
    with pytest.raises(ValidationError):
        CartLine(item_id="m1", qty=qty)
    assert CartLine(item_id="m1", qty=3).qty == 3
