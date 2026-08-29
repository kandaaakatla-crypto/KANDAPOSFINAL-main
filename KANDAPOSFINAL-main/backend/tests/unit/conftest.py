"""Fixtures for the unit test layer (P0-4 / PR 1 of docs/p0-remediation).

Unlike backend/tests/*.py — HTTP integration tests that require a live,
already-running server and a seeded demo tenant reachable over the network —
these boot the real FastAPI app in-process via TestClient, against a
throwaway MongoDB database created fresh for this test session and dropped
at teardown. DB_NAME from a local .env is never reused: a stray test run must
not be able to touch real seeded/dev data, let alone production.

Env vars are set at import time, before `server` is imported by the `client`
fixture below, since server.py's module-level `load_dotenv()` does not
override already-set values.
"""
import asyncio
import os
import uuid

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ["DB_NAME"] = f"kanda_test_{uuid.uuid4().hex[:12]}"
os.environ["DISABLE_BACKGROUND_TASKS"] = "1"
os.environ.setdefault("JWT_SECRET", "unit-test-secret")
os.environ.setdefault("CORS_ORIGINS", "*")
os.environ.setdefault("PUBLIC_BASE_URL", "http://testserver")


@pytest.fixture(scope="session")
def db_name() -> str:
    return os.environ["DB_NAME"]


@pytest.fixture(scope="session")
def client(db_name):
    """A TestClient wrapping the real app. Session-scoped: the startup hook
    (seed_all + index creation) only needs to run once for the whole file.
    Drops the throwaway database on teardown, after the TestClient's own
    context exit has already run the app's shutdown hook (closes the Motor
    client `db.py` holds)."""
    from fastapi.testclient import TestClient
    from server import app

    with TestClient(app) as c:
        yield c

    async def _drop():
        m = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            await m.drop_database(db_name)
        finally:
            m.close()

    asyncio.run(_drop())


@pytest.fixture(scope="session")
def db(db_name, client):
    """Direct Motor handle to the same throwaway database the app just
    booted against, for tests asserting Mongo state rather than only HTTP
    responses. Depends on `client` so seed_all has already run."""
    m = AsyncIOMotorClient(os.environ["MONGO_URL"])
    yield m[db_name]
    m.close()
