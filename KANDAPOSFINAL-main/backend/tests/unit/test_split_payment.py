"""Master Test Report P0-1: card/split payments 404'd because the POS paid
against the local `lo_…` order id, and a failed split left an order marked
SPLIT (looked paid) that never synced.

The server half: a split order is created *unpaid* (with its splits, which
must sum to the total) and only becomes 'split'-paid once its card portion
is verified; `split` is a valid payment value; and the idempotency key makes
retries create the order once.
"""
import uuid


def _token(client) -> str:
    r = client.post("/api/auth/login", json={"pin": "1234"}, headers={"X-Forwarded-For": "203.0.113.101"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _payload(**kw):
    p = {
        "type": "collection", "customer": {"name": "Walk-in"},
        "items": [{"name": "Margherita", "qty": 1, "price": 200}],
        "total": 210, "payment": "unpaid",
        "splits": [{"method": "cash", "amount": 60}, {"method": "card", "amount": 150}],
    }
    p.update(kw)
    return p


def test_split_order_is_created_unpaid_until_the_card_part_clears(client):
    h = {"Authorization": f"Bearer {_token(client)}"}
    r = client.post("/api/orders", json=_payload(), headers=h)
    assert r.status_code == 200, r.text
    o = r.json()
    assert o["payment"] == "unpaid"          # must NOT look paid
    assert o["splits"] == [{"method": "cash", "amount": 60.0}, {"method": "card", "amount": 150.0}]


def test_split_amounts_must_sum_to_the_server_total(client):
    h = {"Authorization": f"Bearer {_token(client)}"}
    bad = _payload(splits=[{"method": "cash", "amount": 10}, {"method": "card", "amount": 10}])
    r = client.post("/api/orders", json=bad, headers=h)
    assert r.status_code == 400, r.text


def test_split_is_an_accepted_payment_value(client):
    h = {"Authorization": f"Bearer {_token(client)}"}
    r = client.post("/api/orders", json=_payload(payment="split"), headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["payment"] == "split"


def test_retrying_with_the_same_client_ref_creates_one_order(client):
    h = {"Authorization": f"Bearer {_token(client)}"}
    ref = f"lo_{uuid.uuid4().hex}"
    a = client.post("/api/orders", json=_payload(client_ref=ref), headers=h).json()
    b = client.post("/api/orders", json=_payload(client_ref=ref), headers=h).json()
    assert a["id"] == b["id"] and a["number"] == b["number"]


def test_payment_order_for_a_local_id_is_404(client):
    """The failure the POS hit: asking Razorpay for an order using the
    browser-only `lo_…` id. The client must wait for the server id first."""
    h = {"Authorization": f"Bearer {_token(client)}"}
    r = client.post("/api/payments/order", json={"orderId": "lo_not_on_server", "amount": 100}, headers=h)
    assert r.status_code == 404, r.text
