"""Waste and food cost (reports.report_food_cost): what was thrown away, in
rupees, and what the food on sold dishes cost against what it sold for."""
import os
import uuid

from pymongo import MongoClient

from tz import now_ist

DEMO_MANAGER_PIN = "1234"
FOOD_COST = "/api/reports/food-cost"


def _manager_headers(client):
    r = client.post("/api/auth/login", json={"pin": DEMO_MANAGER_PIN},
                    headers={"X-Forwarded-For": "203.0.113.95"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_waste_is_valued_at_cost_and_grouped(client):
    headers = _manager_headers(client)
    before = client.get(FOOD_COST, params={"days": 7}, headers=headers)
    assert before.status_code == 200, before.text
    before = before.json()

    name = f"Paneer {uuid.uuid4().hex[:4]}"
    item = client.post("/api/inventory", json={"name": name, "unit": "kg", "stock": 10, "cost_per_unit": 50},
                       headers=headers)
    assert item.status_code == 200, item.text
    for qty, reason in ((2, "Spoiled"), (1, "Dropped")):
        r = client.post("/api/waste", json={"inventory_id": item.json()["id"], "qty": qty, "reason": reason}, headers=headers)
        assert r.status_code == 200, r.text

    after = client.get(FOOD_COST, params={"days": 7}, headers=headers).json()
    assert round(after["waste"]["value"] - before["waste"]["value"], 2) == 150.0
    assert after["waste"]["entries"] - before["waste"]["entries"] == 2
    row = next(r for r in after["waste"]["byItem"] if r["name"] == name)
    assert row == {"name": name, "qty": 3.0, "unit": "kg", "value": 150.0}
    reasons = {r["reason"]: r["value"] for r in after["waste"]["byReason"]}
    assert reasons["Spoiled"] >= 100.0 and reasons["Dropped"] >= 50.0

    food = after["food"]
    assert set(food) == {"revenue", "cost", "pct", "coveragePct"}
    assert client.get(FOOD_COST, params={"days": 3}, headers=headers).status_code == 422


def test_food_cost_uses_recipe_cost_of_dishes_sold(client, db_name):
    headers = _manager_headers(client)
    tenant_id = client.get("/api/tenant/info", headers=headers).json()["id"]
    dish = next(i for i in client.get("/api/menu/items", headers=headers).json() if i.get("price"))
    flour = client.post("/api/inventory", json={"name": f"Flour {uuid.uuid4().hex[:4]}", "unit": "kg", "cost_per_unit": 40},
                        headers=headers).json()
    r = client.put(f"/api/menu/items/{dish['id']}/recipes",
                   json={"recipes": [{"menu_item_id": dish["id"], "ingredients": [{"inventory_id": flour["id"], "qty": 0.5}]}]},
                   headers=headers)
    assert r.status_code == 200, r.text

    tag = uuid.uuid4().hex[:6]
    m = MongoClient(os.environ["MONGO_URL"])
    try:
        m[db_name].orders.insert_one({
            "id": f"fc-{tag}", "number": 700_000 + int(tag, 16) % 90_000, "tenant_id": tenant_id,
            "total": 400.0, "placedAt": now_ist().isoformat(),
            "items": [{"name": dish["name"], "qty": 2, "price": 200.0}],
        })
        food = client.get(FOOD_COST, params={"days": 7}, headers=headers).json()["food"]
    finally:
        m[db_name].orders.delete_one({"id": f"fc-{tag}"})
        m.close()

    # The dish now has a recipe costing ₹20 a plate, so it is in the costed set.
    assert food["revenue"] >= 400.0 and food["cost"] >= 40.0
    assert food["pct"] == round(food["cost"] / food["revenue"] * 100, 1)
    assert 0 < food["coveragePct"] <= 100
