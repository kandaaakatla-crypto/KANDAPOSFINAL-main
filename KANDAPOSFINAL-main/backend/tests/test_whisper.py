"""Manager whisper tests — validates auth guards, LIVE_BRIDGES lookup and
the mocked injection into a fake OpenAI Realtime WebSocket.

These target the running backend via HTTP; the actual bridge state (in-process
LIVE_BRIDGES dict) is manipulated via a small internal helper so we don't need
a live Twilio call to exercise the endpoint.
"""
from __future__ import annotations

import json
import os
from unittest.mock import AsyncMock

import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path("/app/frontend/.env"))
BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") + "/api"


@pytest.fixture(scope="module")
def dash_token():
    r = requests.post(f"{BASE}/dash/auth/login",
                      json={"email": "owner@demo.com", "password": "OwnerPass#2025"},
                      timeout=15)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture
def auth_headers(dash_token):
    return {"Authorization": f"Bearer {dash_token}", "Content-Type": "application/json"}


def test_active_calls_empty_when_no_bridge(auth_headers):
    r = requests.get(f"{BASE}/voice/calls/active", headers=auth_headers, timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert data["count"] == 0
    assert data["active"] == []


def test_whisper_rejects_missing_bridge(auth_headers):
    r = requests.post(f"{BASE}/voice/calls/vc_nope/whisper",
                      json={"message": "please upsell"},
                      headers=auth_headers, timeout=10)
    assert r.status_code == 404
    assert "not currently active" in r.json()["detail"].lower()


def test_whisper_rejects_empty_message(auth_headers):
    r = requests.post(f"{BASE}/voice/calls/vc_any/whisper",
                      json={"message": "   "},
                      headers=auth_headers, timeout=10)
    assert r.status_code == 400
    assert r.json()["detail"] == "message required"


def test_whisper_rejects_oversized_message(auth_headers):
    r = requests.post(f"{BASE}/voice/calls/vc_any/whisper",
                      json={"message": "x" * 501},
                      headers=auth_headers, timeout=10)
    assert r.status_code == 400
    assert "too long" in r.json()["detail"].lower()


def test_whisper_requires_dashboard_auth():
    # No auth header at all → 401
    r = requests.post(f"{BASE}/voice/calls/vc_any/whisper",
                      json={"message": "hi"}, timeout=10)
    assert r.status_code == 401


# ---- In-process integration test (uses ASGITransport + AsyncMock bridge)
import asyncio
from httpx import AsyncClient, ASGITransport


@pytest.mark.asyncio
async def test_whisper_in_process_end_to_end(dash_token):
    """One consolidated in-process test that exercises both the happy path
    and the cross-tenant guard using the same ASGI client (avoids double
    startup/shutdown cycles that close the shared DB client between tests)."""
    from server import app
    from routes import voice as voice_mod

    voice_mod.LIVE_BRIDGES.clear()
    fake_ws = AsyncMock()
    voice_mod.register_bridge("vc_test", "demo", fake_ws)
    voice_mod.register_bridge("vc_other", "some-other-tenant", AsyncMock())

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        login = await ac.post("/api/dash/auth/login",
                              json={"email": "owner@demo.com", "password": "OwnerPass#2025"})
        assert login.status_code == 200, login.text
        tok = login.json()["token"]
        headers = {"Authorization": f"Bearer {tok}"}

        # Happy path — same tenant, real bridge.
        r = await ac.post("/api/voice/calls/vc_test/whisper",
                          json={"message": "Upsell them the family combo"}, headers=headers)
        assert r.status_code == 200, r.text
        assert fake_ws.send.call_count == 2
        first = json.loads(fake_ws.send.call_args_list[0][0][0])
        assert first["type"] == "conversation.item.create"
        assert first["item"]["role"] == "system"
        assert "Upsell them the family combo" in first["item"]["content"][0]["text"]
        assert "MANAGER WHISPER" in first["item"]["content"][0]["text"]
        second = json.loads(fake_ws.send.call_args_list[1][0][0])
        assert second["type"] == "response.create"

        # Cross-tenant → 403.
        r2 = await ac.post("/api/voice/calls/vc_other/whisper",
                           json={"message": "no you don't"}, headers=headers)
        assert r2.status_code == 403

    voice_mod.LIVE_BRIDGES.clear()
