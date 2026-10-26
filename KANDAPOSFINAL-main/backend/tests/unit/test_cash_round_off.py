"""Cash round-off: when a store enables it, an all-cash bill is rounded to the
nearest rupee (half up) and the difference is recorded as `roundOff`."""
from tax import apply_cash_round_off


def test_rounds_cash_to_nearest_rupee():
    assert apply_cash_round_off(412.40, "cash", True) == (412.0, -0.40)
    assert apply_cash_round_off(412.50, "cash", True) == (413.0, 0.50)
    assert apply_cash_round_off(412.60, "cash", True) == (413.0, 0.40)


def test_whole_rupee_total_unchanged():
    assert apply_cash_round_off(250.0, "cash", True) == (250.0, 0.0)


def test_only_cash_and_only_when_enabled():
    assert apply_cash_round_off(412.40, "cash", False) == (412.40, 0.0)
    for method in ("card", "upi", "split", "unpaid", "card_machine", "other"):
        assert apply_cash_round_off(412.40, method, True) == (412.40, 0.0)
