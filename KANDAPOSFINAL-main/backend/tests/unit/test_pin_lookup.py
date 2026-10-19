"""Master Test Report P0-7: PIN login bcrypt-checked every staff member in
turn, on the event loop — a wrong PIN took ~4.8s, scaled with headcount and
stalled every other request meanwhile. A store-scoped HMAC `pin_lookup`
now narrows it to the one candidate (legacy rows without it still work and
are backfilled on first successful login)."""
import asyncio
import os
import time

import pytest
from pymongo import MongoClient

import auth
from auth import pin_lookup, find_pin_matches, hash_pin

os.environ.setdefault("JWT_SECRET", "test-secret")


def test_lookup_is_deterministic_and_tenant_scoped():
    assert pin_lookup("t1", "1234") == pin_lookup("t1", "1234")
    assert pin_lookup("t1", "1234") != pin_lookup("t2", "1234")
    assert pin_lookup("t1", "1234") != pin_lookup("t1", "1235")
    assert "1234" not in pin_lookup("t1", "1234")


class _FakeUsers:
    def __init__(self):
        self.updates = []

    async def update_one(self, flt, upd):
        self.updates.append((flt, upd))


class _FakeDb:
    def __init__(self):
        self.users = _FakeUsers()


def test_only_the_candidate_is_bcrypt_checked(monkeypatch):
    calls = []
    real = auth.verify_pin
    monkeypatch.setattr(auth, "verify_pin", lambda p, h: (calls.append(h), real(p, h))[1])

    users = [
        {"id": f"u{i}", "pin_hash": hash_pin(f"{i:04d}"), "pin_lookup": pin_lookup("t1", f"{i:04d}")}
        for i in range(1, 7)
    ]
    out = asyncio.run(find_pin_matches(_FakeDb(), "t1", users, "0003"))
    assert [u["id"] for u in out] == ["u3"]
    assert len(calls) == 1                     # not 6

    calls.clear()
    assert asyncio.run(find_pin_matches(_FakeDb(), "t1", users, "9999")) == []
    assert calls == []                         # a wrong PIN costs no bcrypt at all


def test_legacy_rows_still_match_and_get_backfilled():
    legacy = {"id": "old", "pin_hash": hash_pin("4321")}   # no pin_lookup yet
    db = _FakeDb()
    out = asyncio.run(find_pin_matches(db, "t1", [legacy], "4321"))
    assert [u["id"] for u in out] == ["old"]
    assert db.users.updates and db.users.updates[0][1]["$set"]["pin_lookup"] == pin_lookup("t1", "4321")


def test_wrong_pin_login_is_fast_with_a_big_roster(client):
    """End to end (Mongo harness): a wrong PIN must not scale with staff."""
    r = client.post("/api/auth/login", json={"pin": "1234"}, headers={"X-Forwarded-For": "203.0.113.111"})
    assert r.status_code == 200, r.text   # also backfills the legacy demo rows
    t = time.perf_counter()
    r = client.post("/api/auth/login", json={"pin": "0000"}, headers={"X-Forwarded-For": "203.0.113.112"})
    assert r.status_code == 401
    assert time.perf_counter() - t < 1.0
