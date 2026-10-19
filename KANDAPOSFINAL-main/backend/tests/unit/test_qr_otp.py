"""Anyone holding a table's QR link could place orders on that table with no
check at all, so a forwarded or misplaced link, or a guest tapping twice,
put stray and duplicate orders on a real table's bill. A QR table order now
needs a phone number verified with a one-time code (WhatsApp first, SMS as
an OTP-only fallback), records who ordered, and an identical order from the
same phone within a minute returns the first order instead of a second one.
QR_OTP_REQUIRED=0 turns the whole step off.
"""
import json
import os
import uuid
from datetime import timedelta

import jwt
import pytest
from pymongo import MongoClient

import routes.whatsapp as wa
import sms_service
from auth import _secret, JWT_ALG
from tz import now_ist


class _Sent(list):
    def create(self, **kw):
        if getattr(self, "fail", False):
            raise RuntimeError("twilio down")
        self.append(kw)
        return type("Msg", (), {"sid": f"SM{len(self)}"})()


class _FakeTwilio:
    def __init__(self):
        self.messages = _Sent()


@pytest.fixture
def store(client, db_name):
    tag = uuid.uuid4().hex[:6]
    tid = f"t_otp{tag}"
    db = MongoClient(os.environ["MONGO_URL"])[db_name]
    db.tenants.insert_one({"id": tid, "slug": tid, "name": "Dosa Corner", "status": "active",
                           "business_type": "restaurant", "features": {}})
    db.categories.insert_one({"id": f"c{tag}", "tenant_id": tid, "name": "Tiffin", "sort_order": 1, "tax_rate": 5})
    for iid, name, price in ((f"m1{tag}", "Dosa", 100), (f"m2{tag}", "Coffee", 40)):
        db.menu_items.insert_one({"id": iid, "tenant_id": tid, "cat_id": f"c{tag}", "name": name, "price": price,
                                  "available": True, "deleted_at": None})
    db.tables.insert_one({"id": f"tb{tag}", "tenant_id": tid, "number": 5, "seats": 4, "status": "available", "order_id": None})
    return {"slug": tid, "tid": tid, "db": db, "dosa": f"m1{tag}", "coffee": f"m2{tag}"}


@pytest.fixture
def wa_twilio(monkeypatch):
    fake = _FakeTwilio()
    monkeypatch.setattr(wa, "_twilio_client", lambda: fake)
    monkeypatch.setenv("TWILIO_WHATSAPP_FROM", "whatsapp:+918000000000")
    monkeypatch.setenv("WA_OTP_CONTENT_SID", "HXotp")
    monkeypatch.delenv("SMS_OTP_ENABLED", raising=False)
    monkeypatch.delenv("SMS_ENABLED", raising=False)
    monkeypatch.delenv("QR_OTP_REQUIRED", raising=False)  # default: on
    return fake


@pytest.fixture
def sms_twilio(monkeypatch):
    fake = _FakeTwilio()
    monkeypatch.setattr(sms_service, "_get_client", lambda: fake)
    monkeypatch.setenv("TWILIO_FROM_NUMBER", "+15550001111")
    return fake


def _phone():
    return "9" + str(uuid.uuid4().int)[:9]


def _wa_code(fake):
    return json.loads(fake.messages[-1]["content_variables"])["1"]


def _request(client, store, phone, name="Ravi"):
    return client.post(f"/api/storefront/{store['slug']}/otp/request", json={"name": name, "phone": phone})


def _verify(client, store, phone, code):
    return client.post(f"/api/storefront/{store['slug']}/otp/verify", json={"phone": phone, "code": code})


def _order(client, store, items, token=None):
    h = {"Authorization": f"Bearer {token}"} if token else {}
    return client.post(f"/api/storefront/{store['slug']}/table/5/order", json={"items": items}, headers=h)


def _sign_in(client, store, fake, phone=None, name="Ravi"):
    phone = phone or _phone()
    r = _request(client, store, phone, name)
    assert r.status_code == 200, r.text
    r = _verify(client, store, phone, _wa_code(fake))
    assert r.status_code == 200, r.text
    return r.json()["token"], phone


def test_table_order_needs_a_verified_phone(client, store, wa_twilio):
    assert client.get(f"/api/storefront/{store['slug']}/menu").json()["tenant"]["qrOtpRequired"] is True
    assert client.get(f"/api/storefront/{store['slug']}/table/5").json()["otpRequired"] is True
    r = _order(client, store, [{"item_id": store["dosa"]}])
    assert r.status_code == 401, r.text
    assert store["db"].orders.count_documents({"tenant_id": store["tid"]}) == 0


def test_code_goes_by_whatsapp_and_the_order_records_the_phone(client, store, wa_twilio):
    phone = _phone()
    r = _request(client, store, phone, "Ravi")
    assert r.status_code == 200, r.text
    assert r.json()["channel"] == "whatsapp"
    msg = wa_twilio.messages[-1]
    assert msg["to"] == f"whatsapp:+91{phone}" and msg["content_sid"] == "HXotp"
    code = _wa_code(wa_twilio)
    assert code not in r.text

    v = _verify(client, store, phone, code)
    assert v.status_code == 200, v.text
    o = _order(client, store, [{"item_id": store["dosa"]}], v.json()["token"])
    assert o.status_code == 200, o.text
    doc = store["db"].orders.find_one({"id": o.json()["orderId"]})
    assert doc["customer"]["phone"] == f"+91{phone}" and doc["customer"]["name"] == "Ravi"
    assert doc["qr_rounds"][0]["phone"] == f"+91{phone}"

    # A code works once.
    assert _verify(client, store, phone, code).status_code == 401


def test_token_for_another_store_is_refused(client, store, wa_twilio):
    token = jwt.encode({"sub": "+919876543210", "name": "X", "tenant_id": "someone-else", "iss": "storefront",
                        "exp": now_ist() + timedelta(hours=1)}, _secret(), algorithm=JWT_ALG)
    assert _order(client, store, [{"item_id": store["dosa"]}], token).status_code == 401


def test_wrong_code_and_attempt_cap(client, store, wa_twilio):
    phone = _phone()
    assert _request(client, store, phone).status_code == 200
    code = _wa_code(wa_twilio)
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        r = _verify(client, store, phone, wrong)
        assert r.status_code == 401, r.text
    # After five wrong tries the code is void, even the right one.
    r = _verify(client, store, phone, code)
    assert r.status_code == 401
    assert "new code" in r.json()["detail"].lower()


def test_code_requests_are_rate_limited(client, store, wa_twilio):
    phone = _phone()
    assert _request(client, store, phone).status_code == 200
    r = _request(client, store, phone)
    assert r.status_code == 429, r.text
    assert len(wa_twilio.messages) == 1

    coll = store["db"].customer_otps
    for _ in range(4):
        # Pretend the 30-second wait has passed.
        rec = coll.find_one({"tenant_id": store["tid"], "phone": f"+91{phone}"})
        coll.update_one({"_id": rec["_id"]}, {"$set": {"sent_at": [
            (now_ist() - timedelta(minutes=1 + i)).isoformat() for i, _ in enumerate(rec["sent_at"])]}})
        assert _request(client, store, phone).status_code == 200
    rec = coll.find_one({"tenant_id": store["tid"], "phone": f"+91{phone}"})
    coll.update_one({"_id": rec["_id"]}, {"$set": {"sent_at": [
        (now_ist() - timedelta(minutes=1 + i)).isoformat() for i, _ in enumerate(rec["sent_at"])]}})
    r = _request(client, store, phone)
    assert r.status_code == 429, r.text  # five codes in the last hour
    assert len(wa_twilio.messages) == 5


def test_sms_fallback_when_whatsapp_fails(client, store, wa_twilio, sms_twilio, monkeypatch):
    wa_twilio.messages.fail = True
    phone = _phone()

    # No SMS fallback unless SMS_OTP_ENABLED=1 (SMS_ENABLED stays off).
    r = _request(client, store, phone)
    assert r.status_code == 502, r.text
    assert sms_twilio.messages == []

    monkeypatch.setenv("SMS_OTP_ENABLED", "1")
    store["db"].customer_otps.delete_many({"tenant_id": store["tid"]})
    r = _request(client, store, phone)
    assert r.status_code == 200, r.text
    assert r.json()["channel"] == "sms"
    body = sms_twilio.messages[-1]["body"]
    code = "".join(ch for ch in body if ch.isdigit())[:6]
    assert code not in r.text
    assert _verify(client, store, phone, code).status_code == 200


def test_sms_used_when_whatsapp_is_not_configured(client, store, wa_twilio, sms_twilio, monkeypatch):
    monkeypatch.delenv("WA_OTP_CONTENT_SID")
    monkeypatch.setenv("SMS_OTP_ENABLED", "1")
    r = _request(client, store, _phone())
    assert r.status_code == 200, r.text
    assert r.json()["channel"] == "sms"
    assert wa_twilio.messages == []


def test_no_channel_is_a_clear_error(client, store, wa_twilio, monkeypatch):
    monkeypatch.delenv("WA_OTP_CONTENT_SID")
    r = _request(client, store, _phone())
    assert r.status_code == 410, r.text


def test_identical_order_within_a_minute_is_not_duplicated(client, store, wa_twilio):
    token, _ = _sign_in(client, store, wa_twilio)
    items = [{"item_id": store["dosa"], "qty": 2}]
    first = _order(client, store, items, token)
    again = _order(client, store, items, token)
    assert first.status_code == 200 and again.status_code == 200, again.text
    assert again.json()["orderId"] == first.json()["orderId"]
    doc = store["db"].orders.find_one({"id": first.json()["orderId"]})
    assert [(i["name"], i["qty"]) for i in doc["items"]] == [("Dosa", 2)]

    # Different items from the same phone still go on the bill.
    more = _order(client, store, [{"item_id": store["coffee"]}], token)
    assert more.json()["orderId"] == first.json()["orderId"]
    doc = store["db"].orders.find_one({"id": first.json()["orderId"]})
    assert [(i["name"], i["qty"]) for i in doc["items"]] == [("Dosa", 2), ("Coffee", 1)]

    # The same items from another guest at the table are a real order.
    other, _ = _sign_in(client, store, wa_twilio, name="Meena")
    _order(client, store, items, other)
    doc = store["db"].orders.find_one({"id": first.json()["orderId"]})
    assert len(doc["items"]) == 3
    assert {r["name"] for r in doc["qr_rounds"]} == {"Ravi", "Meena"}


def test_switch_off_behaves_like_before(client, store, monkeypatch):
    monkeypatch.setenv("QR_OTP_REQUIRED", "0")
    assert client.get(f"/api/storefront/{store['slug']}/menu").json()["tenant"]["qrOtpRequired"] is False
    items = [{"item_id": store["dosa"]}]
    a = _order(client, store, items)
    b = _order(client, store, items)
    assert a.status_code == 200 and b.status_code == 200, b.text
    doc = store["db"].orders.find_one({"id": a.json()["orderId"]})
    assert len(doc["items"]) == 2
    assert doc["customer"]["name"] == "Table 5"
