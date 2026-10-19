"""Master Test Report P2: the digest said "1 orders" and "Good morning" even
when it went out at 22:00."""
from routes.digest import orders_label, greeting_for_hour


def test_orders_plural():
    assert orders_label(0) == "0 orders"
    assert orders_label(1) == "1 order"
    assert orders_label(12) == "12 orders"


def test_greeting_matches_time_of_day():
    assert greeting_for_hour(7) == "Good morning"
    assert greeting_for_hour(13) == "Good afternoon"
    assert greeting_for_hour(19) == "Good evening"
    assert greeting_for_hour(22) == "Good evening"
    assert greeting_for_hour(2) == "Good evening"
