"""Coupon editing: value/kind re-validated on update, and an explicit null
clears an optional date/limit (previously impossible, exclude_none dropped it)."""
import uuid


def _login(client):
    r = client.post("/api/auth/login", json={"pin": "1234"}, headers={"X-Forwarded-For": "203.0.113.91"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _make(client, h, **kw):
    body = {"code": "ED" + uuid.uuid4().hex[:6].upper(), "kind": "percent", "value": 10,
            "valid_from": "2026-10-01T00:00:00", "valid_to": "2026-12-01T23:59:59", "max_uses": 5}
    body.update(kw)
    r = client.post("/api/coupons", json=body, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_percent_value_over_100_rejected_on_update(client):
    h = _login(client)
    c = _make(client, h)
    r = client.put(f"/api/coupons/{c['id']}", json={"value": 150}, headers=h)
    assert r.status_code == 400, r.text
    r = client.put(f"/api/coupons/{c['id']}", json={"value": 0}, headers=h)
    assert r.status_code == 400, r.text


def test_explicit_null_clears_limits(client):
    h = _login(client)
    c = _make(client, h)
    r = client.put(f"/api/coupons/{c['id']}", json={"valid_to": None, "max_uses": None, "value": 15}, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["valid_to"] is None and body["max_uses"] is None and body["value"] == 15
    assert body["valid_from"] == "2026-10-01T00:00:00"  # untouched field stays
