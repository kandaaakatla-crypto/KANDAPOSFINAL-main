"""Two refunds for the same bill sent at the same moment (two terminals, or
a double-tapped button) could both pass the "not more than what's left"
check, because the check read the order and the write happened later. The
customer could get back more than they paid. The cap is now enforced inside
one conditional database update, so only the refunds that fit go through.
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
    return _h(client, "1234", "203.0.113.181")


@pytest.fixture
def db(client):
    """The app's own Motor handle (overrides the conftest one), so its calls
    run on the app's event loop via client.portal.call, next to the requests."""
    from db import get_db
    return get_db()


def _order(client, h, total=210, customer=None):
    r = client.post("/api/orders", headers=h, json={
        "type": "collection", "customer": customer or {"name": "Walk-in"}, "payment": "cash",
        "items": [{"name": "Masala Dosa", "qty": 1, "price": 200}], "total": total,
        "client_ref": f"rc_{uuid.uuid4().hex}"})
    assert r.status_code == 200, r.text
    return r.json()


def _refund_body(amount, method="original"):
    return {"amount": amount, "reason": "Customer complaint", "refund_method": method}


def _concurrent_refunds(client, h, order_id, amounts, method="original"):
    """Fire the refunds together on the app's own event loop with
    asyncio.gather, so they really interleave inside the handlers."""
    async def run():
        transport = httpx.ASGITransport(app=client.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
            return await asyncio.gather(*[
                ac.post(f"/api/orders/{order_id}/refund", json=_refund_body(a, method), headers=h)
                for a in amounts
            ])
    return client.portal.call(run)


def test_sequential_refunds_cannot_exceed_total(client, manager):
    order = _order(client, manager)
    total = order["total"]
    r1 = client.post(f"/api/orders/{order['id']}/refund", json=_refund_body(total - 10), headers=manager)
    assert r1.status_code == 200, r1.text
    r2 = client.post(f"/api/orders/{order['id']}/refund", json=_refund_body(20), headers=manager)
    assert r2.status_code == 400, r2.text
    assert "10.00" in r2.json()["detail"]
    r3 = client.post(f"/api/orders/{order['id']}/refund", json=_refund_body(10), headers=manager)
    assert r3.status_code == 200, r3.text
    assert r3.json()["refunded_total"] == total


def test_concurrent_full_refunds_only_one_goes_through(client, manager, db):
    order = _order(client, manager)
    total = order["total"]
    responses = _concurrent_refunds(client, manager, order["id"], [total, total, total])
    codes = sorted(r.status_code for r in responses)
    assert codes == [200, 400, 400], [r.text for r in responses]

    saved = client.portal.call(db.orders.find_one, {"id": order["id"]})
    assert saved["refunded_amount"] == total
    logs = client.portal.call(lambda: db.refund_logs.find({"order_id": order["id"]}).to_list(None))
    assert sum(l["amount"] for l in logs) == total


def test_many_concurrent_partial_refunds_stop_at_total(client, manager, db):
    order = _order(client, manager)
    total = order["total"]  # 210
    responses = _concurrent_refunds(client, manager, order["id"], [50] * 6)
    ok = [r for r in responses if r.status_code == 200]
    assert len(ok) == 4, [r.text for r in responses]  # 4 x 50 = 200 <= 210, a 5th would be 250
    assert all(r.status_code == 400 for r in responses if r.status_code != 200)

    saved = client.portal.call(db.orders.find_one, {"id": order["id"]})
    assert saved["refunded_amount"] == 200
    assert saved["refunded_amount"] <= total


def test_concurrent_store_credit_refunds_credit_only_once(client, manager, db):
    phone = "+919" + uuid.uuid4().hex[:9].translate(str.maketrans("abcdef", "123456"))
    order = _order(client, manager, customer={"name": "Refund Test", "phone": phone})
    total = order["total"]
    tenant_id = client.portal.call(db.orders.find_one, {"id": order["id"]})["tenant_id"]
    cust_id = f"cu_{uuid.uuid4().hex[:10]}"
    client.portal.call(db.customers.insert_one, {
        "id": cust_id, "tenant_id": tenant_id, "name": "Refund Test", "phone": phone, "store_credit": 0,
    })

    responses = _concurrent_refunds(client, manager, order["id"], [total, total], method="store_credit")
    assert sorted(r.status_code for r in responses) == [200, 400], [r.text for r in responses]

    cust = client.portal.call(db.customers.find_one, {"id": cust_id})
    assert cust["store_credit"] == total


def test_failed_store_credit_refund_gives_the_amount_back(client, manager, db):
    # No customer record for this phone, so store credit can't be issued:
    # the refund must not stay counted against the bill.
    order = _order(client, manager, customer={"name": "Nobody", "phone": "+919000000017"})
    r = client.post(f"/api/orders/{order['id']}/refund", json=_refund_body(50, "store_credit"), headers=manager)
    assert r.status_code == 400, r.text
    saved = client.portal.call(db.orders.find_one, {"id": order["id"]})
    assert float(saved.get("refunded_amount") or 0) == 0
    r = client.post(f"/api/orders/{order['id']}/refund", json=_refund_body(order["total"]), headers=manager)
    assert r.status_code == 200, r.text
