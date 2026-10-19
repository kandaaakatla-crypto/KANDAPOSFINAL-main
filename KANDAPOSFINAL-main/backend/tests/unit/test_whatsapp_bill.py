"""Launch scope for WhatsApp is outbound only, from Kanda's main number: the
customer's bill, and a request for a Google review. There was no way to do
either: the only WhatsApp feature was a two-way inbox, and a bill had no
link a customer could open. Staff can now WhatsApp a bill link (and,
optionally, a review request) from an order, using approved templates on
the main number. Until the templates are approved and configured it says so
instead of sending.
"""
import json
import os
import uuid

import bcrypt
import pytest
from pymongo import MongoClient

import routes.whatsapp as wa

PW = "Passw0rd!x"
SUFFIX = uuid.uuid4().hex[:6]
TID = f"wab{SUFFIX}"
OID = f"o_wab{SUFFIX}"
REVIEW = "https://g.page/r/kanda-test/review"


class _FakeMessages:
    def __init__(self):
        self.sent = []

    def create(self, **kw):
        self.sent.append(kw)
        return type("Msg", (), {"sid": f"SM{len(self.sent)}"})()


class _FakeTwilio:
    def __init__(self):
        self.messages = _FakeMessages()


@pytest.fixture(scope="module")
def store(client, db_name):
    d = MongoClient(os.environ["MONGO_URL"])[db_name]
    d.tenants.insert_one({"id": TID, "slug": TID, "name": "Biryani House", "status": "active",
                          "business_type": "restaurant", "features": {},
                          "store": {"name": "Biryani House", "google_review_url": REVIEW}})
    d.orders.insert_one({"id": OID, "tenant_id": TID, "number": 42, "type": "dine-in", "status": "completed",
                         "customer": {"name": "Asha"}, "items": [{"name": "Biryani", "qty": 1, "price": 300}],
                         "subtotal": 300, "taxTotal": 15, "cgst": 7.5, "sgst": 7.5, "total": 315,
                         "payment": "upi", "placedAt": "2026-10-19T12:00:00+05:30"})
    d.dashboard_users.insert_one({
        "id": f"da_w_{SUFFIX}", "email": f"w{SUFFIX}@wa.test", "name": "Owner", "dash_role": "owner",
        "tenant_id": TID, "password_hash": bcrypt.hashpw(PW.encode(), bcrypt.gensalt()).decode(),
        "active": True, "must_change_password": False, "location_ids": [],
    })
    r = client.post("/api/dash/auth/login", json={"email": f"w{SUFFIX}@wa.test", "password": PW})
    assert r.status_code == 200, r.text
    return {"h": {"Authorization": f"Bearer {r.json()['token']}"}, "db": d}


@pytest.fixture
def twilio(monkeypatch):
    fake = _FakeTwilio()
    monkeypatch.setattr(wa, "_twilio_client", lambda: fake)
    monkeypatch.setenv("TWILIO_WHATSAPP_FROM", "whatsapp:+918000000000")
    monkeypatch.setenv("WA_BILL_CONTENT_SID", "HXbill")
    monkeypatch.setenv("WA_REVIEW_CONTENT_SID", "HXreview")
    return fake


def _send(client, store, **body):
    return client.post(f"/api/orders/{OID}/whatsapp", headers=store["h"], json={"phone": "98765 43210", **body})


def test_sends_bill_link_from_main_number(client, store, twilio):
    r = _send(client, store)
    assert r.status_code == 200, r.text
    assert len(twilio.messages.sent) == 1
    msg = twilio.messages.sent[0]
    assert msg["to"] == "whatsapp:+919876543210"
    assert msg["from_"] == "whatsapp:+918000000000"
    assert msg["content_sid"] == "HXbill"
    variables = json.loads(msg["content_variables"])
    assert variables["1"] == "Biryani House" and variables["2"] == "₹315.00"

    # The link opens the bill as a PDF without logging in.
    path = variables["3"].split("http://testserver", 1)[1]
    pdf = client.get(path)
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content.startswith(b"%PDF")


def test_review_request_goes_with_the_bill_when_asked(client, store, twilio):
    r = _send(client, store, review=True)
    assert r.status_code == 200, r.text
    assert [m["content_sid"] for m in twilio.messages.sent] == ["HXbill", "HXreview"]
    assert json.loads(twilio.messages.sent[1]["content_variables"]) == {"1": "Biryani House", "2": REVIEW}


def test_tampered_bill_link_is_refused(client, store):
    assert client.get("/api/bill/not-a-real-token.pdf").status_code == 404


def test_says_so_until_templates_are_set_up(client, store, monkeypatch):
    fake = _FakeTwilio()
    monkeypatch.setattr(wa, "_twilio_client", lambda: fake)
    monkeypatch.delenv("WA_BILL_CONTENT_SID", raising=False)
    r = _send(client, store)
    assert r.status_code == 503
    assert fake.messages.sent == []


def test_bad_phone_rejected(client, store, twilio):
    r = client.post(f"/api/orders/{OID}/whatsapp", headers=store["h"], json={"phone": "12345"})
    assert r.status_code == 400
    assert twilio.messages.sent == []


def test_review_link_saved_with_business_details(client, store):
    r = client.put("/api/tenant/store", headers=store["h"],
                   json={"name": "Biryani House", "google_review_url": REVIEW})
    assert r.status_code == 200, r.text
    assert r.json()["google_review_url"] == REVIEW
    bad = client.put("/api/tenant/store", headers=store["h"],
                     json={"name": "Biryani House", "google_review_url": "javascript:alert(1)"})
    assert bad.status_code == 422
