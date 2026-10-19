"""Master Test Report P1: soft-deleted customers could only be restored. A
Manager can now erase a trashed customer for good (DPDP requests)."""
import uuid


def _login(client):
    r = client.post("/api/auth/login", json={"pin": "1234"}, headers={"X-Forwarded-For": "203.0.113.92"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_erase_requires_prior_soft_delete(client):
    h = _login(client)
    c = client.post("/api/customers", json={"name": "Erase Me", "phone": "+9195" + str(uuid.uuid4().int)[:8]}, headers=h).json()
    r = client.delete(f"/api/customers/{c['id']}/permanent", headers=h)
    assert r.status_code == 404, r.text  # still active: not erasable


def test_erase_removes_customer_for_good(client):
    h = _login(client)
    c = client.post("/api/customers", json={"name": "Erase Me", "phone": "+9195" + str(uuid.uuid4().int)[:8]}, headers=h).json()
    assert client.delete(f"/api/customers/{c['id']}", headers=h).status_code == 200
    r = client.delete(f"/api/customers/{c['id']}/permanent", headers=h)
    assert r.status_code == 200, r.text
    trash = client.get("/api/customers/trash", headers=h).json()
    assert all(t["id"] != c["id"] for t in trash)
    assert client.post(f"/api/customers/{c['id']}/restore", headers=h).status_code == 404
