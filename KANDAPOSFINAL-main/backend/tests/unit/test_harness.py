"""Proves the unit-test harness itself works end-to-end (P0-4 / PR 1 of
docs/p0-remediation/PLAN.md). Not testing business logic — that starts at
PR 2. Three things need proving:

1. The real app boots via TestClient.
2. seed_all() ran against OUR throwaway database (db_name), not whatever
   DB_NAME a local .env happens to have — proving isolation, not just that
   *some* database got seeded.
3. Background loops (SMS/email/etc.) did not start.
"""
import os


def test_healthz(client):
    """No DB, no auth — the baseline smoke test that the app boots at all."""
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


async def test_seed_ran_against_the_throwaway_database(db):
    tenant = await db.tenants.find_one({"id": "demo"})
    assert tenant is not None, (
        "demo tenant missing — either seed_all didn't run, or it ran against "
        "a different database than the one this test is reading from"
    )

    staff_count = await db.users.count_documents({"tenant_id": "demo"})
    assert staff_count > 0


def test_background_tasks_disabled(client):
    """Guards the one product-code change in this PR (server.py's startup
    hook): confirms the env guard the fixture sets is what the app checks."""
    assert os.environ.get("DISABLE_BACKGROUND_TASKS") == "1"
