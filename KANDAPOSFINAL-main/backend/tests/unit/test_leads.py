"""Regression test for a real production bug (found 2026-09-09): the landing
page's "Book a demo" and "Sign up for updates" forms only updated local React
state and showed a success toast — nothing was ever sent to the backend, so
every real visitor submission was silently discarded. This covers the
/api/leads endpoint that now actually persists them.
"""
import os

from motor.motor_asyncio import AsyncIOMotorClient

DEMO_PAYLOAD = {
    "type": "demo",
    "name": "Asha Rao",
    "email": "asha@example.com",
    "phone": "+91 90000 00001",
    "business": "Asha's Kitchen",
    "message": "Interested in the delivery + KDS combo.",
}


async def _find_lead(db_name: str, email: str) -> dict | None:
    # A fresh Motor client bound to *this* test's own event loop, rather than
    # reusing the session-scoped `db` fixture's client — that one is bound to
    # whichever loop was active when it was first created, and TestClient's
    # sync client.post() calls can leave that loop closed by the time a
    # later async test tries to await on it ("RuntimeError: Event loop is
    # closed"). Cheap enough per-test to not matter.
    m = AsyncIOMotorClient(os.environ["MONGO_URL"])
    try:
        return await m[db_name].landing_leads.find_one({"email": email})
    finally:
        m.close()


async def test_demo_request_is_persisted(client, db_name):
    r = client.post("/api/leads", json=DEMO_PAYLOAD)
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}

    doc = await _find_lead(db_name, "asha@example.com")
    assert doc is not None
    assert doc["type"] == "demo"
    assert doc["name"] == "Asha Rao"
    assert doc["business"] == "Asha's Kitchen"
    assert doc["source"] == "landing_page"


async def test_updates_signup_only_needs_an_email(client, db_name):
    r = client.post("/api/leads", json={"type": "updates", "email": "just-me@example.com"})
    assert r.status_code == 200, r.text

    doc = await _find_lead(db_name, "just-me@example.com")
    assert doc is not None
    assert doc["type"] == "updates"
    assert doc["name"] is None


def test_invalid_email_is_rejected(client):
    r = client.post("/api/leads", json={"type": "demo", "email": "not-an-email"})
    assert r.status_code == 422


def test_missing_type_is_rejected(client):
    r = client.post("/api/leads", json={"email": "someone@example.com"})
    assert r.status_code == 422


def test_repeated_submissions_get_rate_limited(client):
    headers = {"X-Forwarded-For": "203.0.113.50"}
    for i in range(8):
        r = client.post(
            "/api/leads",
            json={"type": "updates", "email": f"spam{i}@example.com"},
            headers=headers,
        )
        assert r.status_code == 200, r.text

    r = client.post(
        "/api/leads",
        json={"type": "updates", "email": "spam9@example.com"},
        headers=headers,
    )
    assert r.status_code == 429, r.text


def test_rate_limit_is_scoped_per_source(client):
    headers_a = {"X-Forwarded-For": "203.0.113.60"}
    for i in range(8):
        client.post("/api/leads", json={"type": "updates", "email": f"a{i}@example.com"}, headers=headers_a)
    r = client.post("/api/leads", json={"type": "updates", "email": "a-over@example.com"}, headers=headers_a)
    assert r.status_code == 429, r.text

    headers_b = {"X-Forwarded-For": "203.0.113.61"}
    r = client.post("/api/leads", json={"type": "updates", "email": "b@example.com"}, headers=headers_b)
    assert r.status_code == 200, r.text


# ── Alpha waitlist (the landing page's "updates" form) ──────────────────────
# Each test sends its own X-Forwarded-For so the per-IP rate limit above
# never bleeds across tests that share TestClient's default client address.

def _join(client, ip, **fields):
    body = {"type": "updates", **fields}
    return client.post("/api/leads", json=body, headers={"X-Forwarded-For": ip})


def test_waitlist_signup_returns_position_and_referral_code(client):
    r1 = _join(client, "198.51.100.1", name="First", email="wl-first@example.com")
    r2 = _join(client, "198.51.100.1", name="Second", email="wl-second@example.com")
    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200, r2.text
    a, b = r1.json(), r2.json()
    assert a["ok"] is True and a["already"] is False
    assert isinstance(a["position"], int) and a["position"] >= 1
    assert b["position"] == a["position"] + 1
    assert a["ref_code"] and a["ref_code"] != b["ref_code"]


async def test_waitlist_is_deduplicated_by_email(client, db_name):
    first = _join(client, "198.51.100.2", name="Dup", email="wl-dup@example.com").json()
    again = _join(client, "198.51.100.2", name="Dup", email="  WL-Dup@Example.com ").json()
    assert again["already"] is True
    assert again["ref_code"] == first["ref_code"]
    assert again["position"] == first["position"]

    m = AsyncIOMotorClient(os.environ["MONGO_URL"])
    try:
        n = await m[db_name].landing_leads.count_documents({"type": "updates", "email_lc": "wl-dup@example.com"})
    finally:
        m.close()
    assert n == 1


async def test_waitlist_stores_business_details(client, db_name):
    r = _join(client, "198.51.100.3", name="Biz", email="wl-biz@example.com",
              business_type="cloud_kitchen", outlets="2-5", city="Hyderabad")
    assert r.status_code == 200, r.text
    doc = await _find_lead(db_name, "wl-biz@example.com")
    assert doc["business_type"] == "cloud_kitchen"
    assert doc["outlets"] == "2-5"
    assert doc["city"] == "Hyderabad"


def test_waitlist_rejects_unknown_business_type(client):
    r = _join(client, "198.51.100.4", email="wl-bad@example.com", business_type="spaceship")
    assert r.status_code == 422


async def test_referral_is_credited_and_moves_referrer_up(client, db_name):
    referrer = _join(client, "198.51.100.5", name="Ref", email="wl-referrer@example.com").json()
    joined = _join(client, "198.51.100.5", name="Friend", email="wl-friend@example.com",
                   ref=referrer["ref_code"]).json()
    assert joined["ok"] is True

    friend = await _find_lead(db_name, "wl-friend@example.com")
    assert friend["referred_by"] == referrer["ref_code"]

    after = _join(client, "198.51.100.5", email="wl-referrer@example.com").json()
    assert after["referrals"] == 1
    assert after["position"] == max(1, referrer["position"] - 5)


async def test_unknown_referral_code_is_ignored(client, db_name):
    _join(client, "198.51.100.6", email="wl-noref@example.com", ref="ZZZZZZ")
    doc = await _find_lead(db_name, "wl-noref@example.com")
    assert doc.get("referred_by") is None


async def test_pre_waitlist_signup_is_recognised_and_given_a_code(client, db_name):
    m = AsyncIOMotorClient(os.environ["MONGO_URL"])
    try:
        await m[db_name].landing_leads.insert_one({
            "id": "lead_legacy01", "type": "updates", "email": "wl-legacy@example.com",
            "name": None, "at": "2026-09-01T10:00:00+05:30", "source": "landing_page",
        })
    finally:
        m.close()

    r = _join(client, "198.51.100.7", email="wl-legacy@example.com").json()
    assert r["already"] is True
    assert r["ref_code"]

    m = AsyncIOMotorClient(os.environ["MONGO_URL"])
    try:
        n = await m[db_name].landing_leads.count_documents({"email": "wl-legacy@example.com"})
    finally:
        m.close()
    assert n == 1


async def test_waitlist_email_is_unique_at_the_database_level(client, db_name):
    # Guards the check-then-insert race in create_lead: a second row for the
    # same email must be refused by Mongo itself, not just by the pre-check.
    import pytest
    from pymongo.errors import DuplicateKeyError

    _join(client, "198.51.100.8", email="wl-race@example.com")
    m = AsyncIOMotorClient(os.environ["MONGO_URL"])
    try:
        with pytest.raises(DuplicateKeyError):
            await m[db_name].landing_leads.insert_one({
                "id": "lead_race02", "type": "updates", "email": "wl-race@example.com",
                "email_lc": "wl-race@example.com", "at": "2026-10-03T10:00:00+05:30",
            })
    finally:
        m.close()
