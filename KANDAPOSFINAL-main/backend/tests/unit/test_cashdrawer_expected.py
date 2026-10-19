"""Master Test Report P1: a drawer's "expected cash" always equalled the
opening float. The close query compared `placedAt` (browser UTC, "...Z")
with the drawer's `opened_at` (IST, "+05:30") as plain strings, which sorts
UTC timestamps 5h30m "earlier" than the same moment in IST - so cash sales
taken after opening were left out. Also voids and refunds were not netted
and the cash half of split payments was ignored."""
from routes.cashdrawer import expected_cash_sales

OPENED = "2026-10-03T10:00:00+05:30"  # == 04:30 UTC


def _o(placed, total, payment="cash", **kw):
    return {"placedAt": placed, "total": total, "payment": payment, **kw}


def test_utc_order_after_ist_open_is_counted():
    # 05:00 UTC is 10:30 IST, i.e. after the 10:00 IST opening.
    assert expected_cash_sales([_o("2026-10-03T05:00:00.000Z", 250.0)], OPENED) == 250.0


def test_order_before_opening_is_ignored():
    assert expected_cash_sales([_o("2026-10-03T04:00:00.000Z", 250.0)], OPENED) == 0.0  # 09:30 IST


def test_voided_and_card_ignored_and_refunds_netted():
    orders = [
        _o("2026-10-03T06:00:00Z", 100.0, voided=True),
        _o("2026-10-03T06:00:00Z", 100.0, payment="card"),
        _o("2026-10-03T06:00:00Z", 100.0, payment="unpaid"),
        _o("2026-10-03T06:00:00Z", 300.0, refunded_amount=50.0),
    ]
    assert expected_cash_sales(orders, OPENED) == 250.0


def test_split_counts_only_cash_portion():
    split = _o("2026-10-03T06:00:00Z", 500.0, payment="split",
               splits=[{"method": "cash", "amount": 200.0}, {"method": "card", "amount": 300.0}])
    assert expected_cash_sales([split], OPENED) == 200.0


def test_ist_timestamps_still_work():
    assert expected_cash_sales([_o("2026-10-03T11:00:00+05:30", 80.0)], OPENED) == 80.0
