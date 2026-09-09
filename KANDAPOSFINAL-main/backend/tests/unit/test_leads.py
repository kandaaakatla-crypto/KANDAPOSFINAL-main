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
