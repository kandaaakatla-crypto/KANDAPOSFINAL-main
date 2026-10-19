"""Master Test Report P1: staff accepted phone "abcxyz" and negative pay."""
import pytest
from pydantic import ValidationError

from models import StaffCreate, StaffUpdate, check_phone


def _create(**kw):
    return StaffCreate(name="A", role="Cashier", pin="4321", **kw)


@pytest.mark.parametrize("bad", ["abcxyz", "12", "+91 98765 4321x", "98765"])
def test_bad_phone_rejected(bad):
    with pytest.raises(ValidationError):
        _create(phone=bad)
    with pytest.raises(ValidationError):
        StaffUpdate(phone=bad)


@pytest.mark.parametrize("ok", ["", None, "9876543210", "+919876543210", "+91 98765 43210", "098765-43210"])
def test_good_or_blank_phone_accepted(ok):
    assert check_phone(ok) in ("", None) or check_phone(ok)


def test_negative_pay_rejected():
    for field in ("monthly_pay", "hourly_rate"):
        with pytest.raises(ValidationError):
            _create(**{field: -1000})
        with pytest.raises(ValidationError):
            StaffUpdate(**{field: -1})
    assert _create(monthly_pay=0, hourly_rate=0).monthly_pay == 0
