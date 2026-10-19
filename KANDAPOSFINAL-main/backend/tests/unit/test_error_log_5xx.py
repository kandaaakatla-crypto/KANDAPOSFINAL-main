"""Regression test for P0-2 (docs/p0-remediation/FINDINGS.md): a handler that
*returns* a 5xx (rather than raising) was recorded nowhere. ops.py's
response-status branch lumped `>= 500` in with the 401 "noise — skip"
condition, so neither error_logs nor the owner ops errors dashboard
(GET /api/owner/ops/errors) could ever show it. 401 stays skipped; other 4xx
must keep being recorded exactly as before.
"""
import os
import uuid

import pytest
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pymongo import MongoClient

DEMO_MANAGER_PIN = "1234"


@pytest.fixture(scope="module")
def probe_paths(client):
    """Mounts throwaway routes that *return* (not raise) a given status.
    Inserted at the front of the router so the SPA catch-all can't shadow
    them, and removed afterwards so no other test sees them."""
    from server import app

    prefix = f"/api/_test_status_{uuid.uuid4().hex[:8]}"

    async def returns_status(code: int):
        return JSONResponse(status_code=code, content={"detail": f"probe {code}"})

    route = APIRoute(f"{prefix}/{{code}}", returns_status, methods=["GET"])
    app.router.routes.insert(0, route)
    yield prefix
    app.router.routes.remove(route)


@pytest.fixture(scope="module")
def error_logs():
    m = MongoClient(os.environ["MONGO_URL"])
    yield m[os.environ["DB_NAME"]].error_logs
    m.close()


@pytest.fixture(scope="module")
def token(client):
    r = client.post(
        "/api/auth/login",
        json={"pin": DEMO_MANAGER_PIN},
        headers={"X-Forwarded-For": "203.0.113.60"},
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _hit(client, url, token=None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return client.get(url, headers=headers)


@pytest.mark.parametrize("code", [500, 503])
def test_returned_5xx_is_recorded(client, probe_paths, error_logs, token, code):
    route = f"{probe_paths}/{code}"
    r = _hit(client, route, token)
    assert r.status_code == code
    doc = error_logs.find_one({"route": route})
    assert doc is not None, f"returned {code} was not written to error_logs"
    assert doc["status"] == code
    assert doc["method"] == "GET"
    assert doc["actor_id"]


def test_returned_5xx_is_recorded_without_auth(client, probe_paths, error_logs):
    """A 500 from an unauthenticated route (e.g. the public storefront) is
    still a server fault worth seeing — the raised-exception branch records
    those regardless of actor, and a returned 500 now matches it."""
    route = f"{probe_paths}/502"
    r = _hit(client, route)
    assert r.status_code == 502
    doc = error_logs.find_one({"route": route})
    assert doc is not None, "unauthenticated 5xx was not written to error_logs"
    assert doc["status"] == 502
    assert doc["actor_id"] is None


def test_401_is_still_skipped(client, probe_paths, error_logs, token):
    route = f"{probe_paths}/401"
    r = _hit(client, route, token)
    assert r.status_code == 401
    assert error_logs.find_one({"route": route}) is None


def test_other_4xx_still_recorded(client, probe_paths, error_logs, token):
    route = f"{probe_paths}/404"
    r = _hit(client, route, token)
    assert r.status_code == 404
    doc = error_logs.find_one({"route": route})
    assert doc is not None
    assert doc["status"] == 404


def test_unauthenticated_4xx_still_not_recorded(client, probe_paths, error_logs):
    """Unchanged behaviour: anonymous 4xx are not logged (bot/scanner noise)."""
    route = f"{probe_paths}/404"
    before = error_logs.count_documents({"route": route, "actor_id": None})
    _hit(client, route)
    assert error_logs.count_documents({"route": route, "actor_id": None}) == before
