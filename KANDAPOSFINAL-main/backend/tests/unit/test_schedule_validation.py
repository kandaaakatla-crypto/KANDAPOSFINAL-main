"""Master Test Report P1: menu schedules accepted 150%, -10%, time 25:99,
a blank name and a negative fixed price."""
import pytest
from pydantic import ValidationError

from models import MenuScheduleCreate, MenuScheduleUpdate

OK = dict(name="Lunch", start_time="11:00", end_time="15:00")


def test_valid_schedule_accepted():
    assert MenuScheduleCreate(**OK, pricing_mode="percent", discount_pct=10, days=[1, 7])
    assert MenuScheduleCreate(name="Late", start_time="22:00", end_time="02:00")  # overnight


@pytest.mark.parametrize("bad", [150, -10, 100.5])
def test_discount_pct_range(bad):
    with pytest.raises(ValidationError):
        MenuScheduleCreate(**OK, pricing_mode="percent", discount_pct=bad)
    with pytest.raises(ValidationError):
        MenuScheduleUpdate(discount_pct=bad)


@pytest.mark.parametrize("bad", ["25:99", "24:00", "9:00", "ab:cd", ""])
def test_time_format(bad):
    with pytest.raises(ValidationError):
        MenuScheduleCreate(name="X", start_time=bad, end_time="10:00")
    with pytest.raises(ValidationError):
        MenuScheduleUpdate(end_time=bad)


def test_blank_name_and_negative_price_and_bad_days():
    with pytest.raises(ValidationError):
        MenuScheduleCreate(name="  ", start_time="10:00", end_time="11:00")
    with pytest.raises(ValidationError):
        MenuScheduleCreate(**OK, pricing_mode="fixed", fixed_price=-5)
    with pytest.raises(ValidationError):
        MenuScheduleCreate(**OK, days=[0, 8])
