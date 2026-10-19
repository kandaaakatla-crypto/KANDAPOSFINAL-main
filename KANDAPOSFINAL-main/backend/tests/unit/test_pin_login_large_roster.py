"""Launch item: PIN login loaded the tenant's staff with `.to_list(50)` and
only looked for the PIN among those, so from the 51st staff member onward a
correct PIN came back "Invalid PIN". Every active staff member of the tenant
must be able to sign in, however big the roster.
"""
import os
import uuid

from pymongo import MongoClient

from auth import hash_pin, pin_lookup

DEMO_MANAGER_PIN = "1234"


def test_sixtieth_staff_member_can_sign_in(client, db_name):
    r = client.post("/api/auth/login", json={"pin": DEMO_MANAGER_PIN},
                    headers={"X-Forwarded-For": "203.0.113.150"})
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    tenant_id = client.get("/api/tenant/info", headers={"Authorization": f"Bearer {token}"}).json()["id"]

    m = MongoClient(os.environ["MONGO_URL"])
    try:
        users = m[db_name].users
        # PINs 7000..7059, none already taken in this tenant.
        pins = [f"{7000 + i:04d}" for i in range(60)]
        taken = {pin_lookup(tenant_id, p) for p in pins}
        assert users.count_documents({"tenant_id": tenant_id, "pin_lookup": {"$in": list(taken)}}) == 0

        # Only the 60th gets a real bcrypt hash of its own PIN; the 59 in
        # front of it are never bcrypt-checked for that PIN (their pin_lookup
        # differs), so one filler hash keeps the test fast.
        filler = hash_pin("0000")
        tag = uuid.uuid4().hex[:6]
        docs = []
        for i, pin in enumerate(pins, start=1):
            docs.append({
                "id": f"roster-{tag}-{i}",
                "tenant_id": tenant_id,
                "name": f"Roster {i}",
                "role": "Cashier",
                "initials": "RS",
                "active": True,
                "pin_hash": hash_pin(pin) if i == 60 else filler,
                "pin_lookup": pin_lookup(tenant_id, pin),
            })
        users.insert_many(docs)
        assert users.count_documents({"tenant_id": tenant_id}) > 60
    finally:
        m.close()

    r = client.post("/api/auth/login", json={"pin": pins[-1]},
                    headers={"X-Forwarded-For": "203.0.113.151"})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["id"] == f"roster-{tag}-60"

    # A wrong PIN is still rejected.
    r = client.post("/api/auth/login", json={"pin": "7099"},
                    headers={"X-Forwarded-For": "203.0.113.152"})
    assert r.status_code == 401, r.text
