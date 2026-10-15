"""Master Test Report P1: a coupon could be saved with valid_to before valid_from."""
import pytest
from fastapi import HTTPException

from routes.coupons import check_coupon_dates


def test_end_before_start_rejected():
    with pytest.raises(HTTPException) as e:
        check_coupon_dates("2026-10-20", "2026-10-10")
    assert e.value.status_code == 400
    assert "before" in e.value.detail.lower()


def test_valid_ranges_accepted():
    check_coupon_dates("2026-10-10", "2026-10-10")
    check_coupon_dates("2026-10-10", "2026-12-01")
    check_coupon_dates(None, "2026-12-01")
    check_coupon_dates("2026-10-10", None)
    check_coupon_dates(None, None)
    check_coupon_dates("", "")


def test_unparseable_date_rejected():
    with pytest.raises(HTTPException):
        check_coupon_dates("tomorrow", "2026-12-01")
