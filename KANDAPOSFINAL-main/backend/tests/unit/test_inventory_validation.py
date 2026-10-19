"""Master Test Report P1: inventory accepted negative stock and cost."""
import pytest
from pydantic import ValidationError

from models import InventoryItemCreate, InventoryItemUpdate


def test_negative_values_rejected():
    for field in ("stock", "reorder", "cost_per_unit"):
        with pytest.raises(ValidationError):
            InventoryItemCreate(name="Flour", unit="kg", **{field: -5})
    for field in ("reorder", "cost_per_unit"):
        with pytest.raises(ValidationError):
            InventoryItemUpdate(**{field: -1})


def test_blank_name_or_unit_rejected():
    with pytest.raises(ValidationError):
        InventoryItemCreate(name=" ", unit="kg")
    with pytest.raises(ValidationError):
        InventoryItemCreate(name="Flour", unit="")


def test_zero_and_positive_ok():
    m = InventoryItemCreate(name="Flour", unit="kg", stock=0, reorder=2, cost_per_unit=40)
    assert m.stock == 0
