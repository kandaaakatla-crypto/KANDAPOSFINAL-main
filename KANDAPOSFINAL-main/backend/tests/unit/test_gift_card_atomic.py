"""Two terminals redeeming the same gift card at the same moment could each
read the full balance and each spend it, because the balance was read and
then overwritten with a value computed from that stale read. The debit is
now one conditional update that only matches while the card still holds
enough, so the card can never give out more than it was loaded with.
"""
import asyncio
import uuid

import httpx
import pytest


def _h(client, pin, ip):
    r = client.post("/api/auth/login", json={"pin": pin}, headers={"X-Forwarded-For": ip})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture
def manager(client):
    return _h(client, "1234", "203.0.113.191")


@pytest.fixture
def db(client):
    """The app's own Motor handle (overrides the conftest one), so its calls
    run on the app's event loop via client.portal.call, next to the requests."""
    from db import get_db
    return get_db()


def _issue(client, h, value):
    r = client.post("/api/gift-cards", json={"value": value}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def _order_body(code, amount):
    return {
        "type": "collection", "customer": {"name": "Walk-in"}, "payment": "cash",
        "items": [{"name": "Masala Dosa", "qty": 2, "price": 250}], "total": 525,
        "gift_card_code": code, "gift_card_amount": amount,
        "client_ref": f"gc_{uuid.uuid4().hex}",
    }


def _concurrent_orders(client, h, code, amounts):
    async def run():
        transport = httpx.ASGITransport(app=client.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
            return await asyncio.gather(*[
                ac.post("/api/orders", json=_order_body(code, a), headers=h) for a in amounts
            ])
    return client.portal.call(run)


def test_two_terminals_cannot_spend_the_same_balance_twice(client, manager, db):
    card = _issue(client, manager, 200)
    responses = _concurrent_orders(client, manager, card["code"], [200, 200])
    assert all(r.status_code == 200 for r in responses), [r.text for r in responses]
    redeemed = [r.json()["gift_card_redeemed"] for r in responses]
    assert sorted(redeemed) == [0, 200], redeemed

    saved = client.portal.call(db.gift_cards.find_one, {"id": card["id"]})
    assert saved["balance"] == 0
    assert saved["status"] == "redeemed"
    txns = client.portal.call(lambda: db.gift_card_txns.find({"gift_card_id": card["id"], "kind": "redeem"}).to_list(None))
    assert round(sum(t["amount"] for t in txns), 2) == -200


def test_concurrent_partial_redemptions_never_exceed_the_card(client, manager, db):
    card = _issue(client, manager, 200)
    responses = _concurrent_orders(client, manager, card["code"], [150, 150, 150])
    assert all(r.status_code == 200 for r in responses), [r.text for r in responses]
    redeemed = [r.json()["gift_card_redeemed"] for r in responses]
    # The first gets 150, the next gets whatever is left (50), the last nothing.
    assert round(sum(redeemed), 2) == 200, redeemed
    assert sorted(redeemed) == [0, 50, 150], redeemed

    saved = client.portal.call(db.gift_cards.find_one, {"id": card["id"]})
    assert saved["balance"] == 0
    assert saved["status"] == "redeemed"


def test_single_redemption_still_works(client, manager, db):
    card = _issue(client, manager, 300)
    r = client.post("/api/orders", json=_order_body(card["code"], 120), headers=manager)
    assert r.status_code == 200, r.text
    assert r.json()["gift_card_redeemed"] == 120
    saved = client.portal.call(db.gift_cards.find_one, {"id": card["id"]})
    assert saved["balance"] == 180
    assert saved["status"] == "active"
