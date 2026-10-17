"""Daily sales target (routes/sales_target.py): the owner sets what a good
day looks like, and the Dashboard Home shows progress against it."""
DEMO_MANAGER_PIN = "1234"
TARGET = "/api/tenant/sales-target"


def _manager_headers(client):
    r = client.post("/api/auth/login", json={"pin": DEMO_MANAGER_PIN},
                    headers={"X-Forwarded-For": "203.0.113.93"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_target_is_set_shown_in_summary_and_cleared(client):
    headers = _manager_headers(client)
    r = client.put(TARGET, json={"target": 25000}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"target": 25000}
    assert client.get("/api/reports/summary", headers=headers).json()["dailyTarget"] == 25000

    for bad in (0, -5, 10**9):
        assert client.put(TARGET, json={"target": bad}, headers=headers).status_code == 422

    r = client.put(TARGET, json={"target": None}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"target": None}
    assert client.get("/api/reports/summary", headers=headers).json()["dailyTarget"] is None
