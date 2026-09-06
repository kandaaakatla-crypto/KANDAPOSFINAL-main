"""Regression test for a platform-audit finding (2026-09-06): /auth/login had
no rate limiting at all. A staff PIN is 4 digits — 10,000 combinations — and
without a limit here it's brute-forceable in minutes. Verified live against
production before this fix: 20 rapid-fire login attempts all returned a
plain 401 with no throttling.
"""

WRONG_PIN = "0000"
DEMO_MANAGER_PIN = "1234"


def test_repeated_wrong_pins_get_rate_limited(client):
    headers = {"X-Forwarded-For": "203.0.113.10"}
    for _ in range(6):
        r = client.post("/api/auth/login", json={"pin": WRONG_PIN}, headers=headers)
        assert r.status_code == 401, r.text

    # Limit now exceeded — must block regardless of what's submitted next,
    # including a *valid* PIN. Otherwise the limiter is trivially bypassed
    # by interspersing a guess with the real PIN.
    r = client.post("/api/auth/login", json={"pin": DEMO_MANAGER_PIN}, headers=headers)
    assert r.status_code == 429, r.text


def test_correct_logins_never_count_against_the_limit(client):
    """A shared POS terminal sees many staff sign in and out per shift —
    legitimate repeated *correct* logins from the same source must never
    be throttled."""
    headers = {"X-Forwarded-For": "203.0.113.20"}
    for _ in range(10):
        r = client.post("/api/auth/login", json={"pin": DEMO_MANAGER_PIN}, headers=headers)
        assert r.status_code == 200, r.text


def test_lockout_is_scoped_to_the_source_not_the_whole_tenant(client):
    headers_a = {"X-Forwarded-For": "203.0.113.30"}
    for _ in range(7):
        client.post("/api/auth/login", json={"pin": WRONG_PIN}, headers=headers_a)
    r = client.post("/api/auth/login", json={"pin": DEMO_MANAGER_PIN}, headers=headers_a)
    assert r.status_code == 429, r.text

    headers_b = {"X-Forwarded-For": "203.0.113.31"}
    r = client.post("/api/auth/login", json={"pin": DEMO_MANAGER_PIN}, headers=headers_b)
    assert r.status_code == 200, r.text
