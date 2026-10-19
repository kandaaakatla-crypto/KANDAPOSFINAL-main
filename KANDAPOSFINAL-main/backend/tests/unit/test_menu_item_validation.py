"""Master Test Report P1: menu items accepted a negative price and a 150% GST
rate. Pure schema tests (no server needed)."""
import pytest
from pydantic import ValidationError

from models import MenuItemCreate, MenuItemUpdate


@pytest.mark.parametrize("model", [MenuItemCreate, MenuItemUpdate])
def test_negative_or_zero_price_rejected(model):
    base = {"catId": "c1", "name": "Tea"} if model is MenuItemCreate else {}
    for bad in (-50, 0):
        with pytest.raises(ValidationError):
            model(**base, price=bad)


@pytest.mark.parametrize("model", [MenuItemCreate, MenuItemUpdate])
def test_gst_must_be_a_real_slab(model):
    base = {"catId": "c1", "name": "Tea"} if model is MenuItemCreate else {}
    for bad in (150, -5, 7, 100):
        with pytest.raises(ValidationError):
            model(**base, tax_rate=bad)
    for ok in (0, 5, 12, 18, 28, None):
        assert model(**base, tax_rate=ok).tax_rate == ok


def test_valid_item_still_accepted():
    m = MenuItemCreate(catId="c1", name="Tea", price=40, tax_rate=5)
    assert m.price == 40


def test_blank_name_rejected():
    with pytest.raises(ValidationError):
        MenuItemCreate(catId="c1", name="   ", price=10)
