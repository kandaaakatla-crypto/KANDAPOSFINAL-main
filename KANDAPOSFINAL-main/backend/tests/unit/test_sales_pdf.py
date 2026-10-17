"""Shareable sales report (routes/report_share.py): today's or this week's
numbers as data for a WhatsApp message and as a PDF to attach."""
import os
import uuid

from pymongo import MongoClient

from tz import now_ist

DEMO_MANAGER_PIN = "1234"
DATA = "/api/reports/share"
PDF = "/api/reports/share.pdf"


def _manager_headers(client):
    r = client.post("/api/auth/login", json={"pin": DEMO_MANAGER_PIN},
                    headers={"X-Forwarded-For": "203.0.113.97"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_share_report_data_and_pdf(client, db_name):
    headers = _manager_headers(client)
    tenant_id = client.get("/api/tenant/info", headers=headers).json()["id"]
    before = client.get(DATA, params={"days": 1}, headers=headers)
    assert before.status_code == 200, before.text
    before = before.json()

    tag = uuid.uuid4().hex[:6]
    dish = f"Shareable Thali {tag}"
    m = MongoClient(os.environ["MONGO_URL"])
    try:
        m[db_name].orders.insert_many([
            {"id": f"pdf-a-{tag}", "number": 500_000 + int(tag, 16) % 90_000, "tenant_id": tenant_id,
             "total": 9000.0, "payment": "card", "source": "zomato", "type": "delivery",
             "placedAt": now_ist().isoformat(), "items": [{"name": dish, "qty": 999, "price": 9.0}]},
            {"id": f"pdf-v-{tag}", "number": 500_000 + int(tag, 16) % 90_000 + 1, "tenant_id": tenant_id,
             "total": 5000.0, "payment": "cash", "voided": True,
             "placedAt": now_ist().isoformat(), "items": [{"name": dish, "qty": 1, "price": 5000.0}]},
        ])
        after = client.get(DATA, params={"days": 1}, headers=headers).json()
        pdf = client.get(PDF, params={"days": 1}, headers=headers)
    finally:
        m[db_name].orders.delete_many({"id": {"$regex": f"^pdf-.*-{tag}$"}})
        m.close()

    assert after["label"] == "Today"
    assert round(after["sales"] - before["sales"], 2) == 9000.0      # voided order left out
    assert after["orders"] - before["orders"] == 1
    assert round(after["payments"]["card"] - before["payments"].get("card", 0), 2) == 9000.0
    assert after["topItems"][0] == {"name": dish, "qty": 999, "revenue": 8991.0}
    assert any(c["key"] == "zomato" for c in after["channels"])

    assert pdf.status_code == 200, pdf.text
    assert pdf.headers["content-type"] == "application/pdf"
    assert 'filename="' in pdf.headers["content-disposition"]
    assert pdf.content.startswith(b"%PDF-") and pdf.content.rstrip().endswith(b"%%EOF")

    assert client.get(DATA, params={"days": 30}, headers=headers).status_code == 422
