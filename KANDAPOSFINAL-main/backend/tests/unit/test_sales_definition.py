"""Master Test Report P0-3 — the single definition of a sale (sales.py)."""
from sales import net_sales, is_paid, is_voided


def test_paid_order_counts_in_full():
    assert net_sales({"total": 418.95, "payment": "cash"}) == 418.95


def test_refund_reduces_the_sale():
    assert net_sales({"total": 1290.10, "payment": "cash", "refunded_amount": 1290.10}) == 0
    assert net_sales({"total": 200, "payment": "card", "refunded_amount": 50}) == 150


def test_voided_never_counts_even_if_paid():
    assert net_sales({"total": 149, "payment": "cash", "voided": True}) == 0


def test_unpaid_is_not_a_sale():
    assert net_sales({"total": 418.95, "payment": "unpaid"}) == 0
    assert not is_paid({"total": 5})  # missing payment == unpaid


def test_over_refund_never_goes_negative():
    assert net_sales({"total": 100, "payment": "cash", "refunded_amount": 120}) == 0


def test_report_example_totals_to_zero():
    """The report's four orders (one refunded, two voided, one unpaid) are
    not a single rupee of sales."""
    orders = [
        {"total": 1290.10, "payment": "cash", "refunded_amount": 1290.10},
        {"total": 418.95, "payment": "unpaid", "voided": True},
        {"total": 149, "payment": "unpaid", "voided": True},
        {"total": 418.95, "payment": "unpaid"},
    ]
    assert sum(net_sales(o) for o in orders) == 0


# ---------- end to end through /api/reports/summary (needs the Mongo harness) ----------

def _token(client) -> str:
    r = client.post("/api/auth/login", json={"pin": "1234"}, headers={"X-Forwarded-For": "203.0.113.81"})
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


def test_summary_counts_only_paid_net_of_refunds_and_excludes_voided(client):
    token = _token(client)
    h = {"Authorization": f"Bearer {token}"}
    before = client.get("/api/reports/summary", headers=h).json()

    paid = _place(client, token, payment="cash")                 # +210 sales
    _place(client, token)                                        # unpaid: open, not a sale
    voided = _place(client, token)                               # voided: nothing
    r = client.post(f"/api/orders/{voided['id']}/void", json={"reason": "test"}, headers=h)
    assert r.status_code == 200, r.text
    r = client.post(f"/api/orders/{paid['id']}/refund", json={"amount": 50, "reason": "test"}, headers=h)
    assert r.status_code == 200, r.text

    after = client.get("/api/reports/summary", headers=h).json()
    assert round(after["todaySales"] - before["todaySales"], 2) == 160.00   # 210 - 50 refund
    assert round(after["cashTotal"] - before["cashTotal"], 2) == 160.00
    assert round(after["unpaidTotal"] - before["unpaidTotal"], 2) == 210.00  # the open order only
    assert after["ordersToday"] - before["ordersToday"] == 2                # paid + open; void excluded
