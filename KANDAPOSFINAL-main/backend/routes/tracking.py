"""Customer-facing live delivery tracking + delivery OTP.

Every delivery order gets, the first time a driver is attached or it goes
out for delivery:
  - `trackingToken` — an unguessable id for the public page
    {PUBLIC_BASE_URL}/track/<token>. No login; the token is the secret.
  - `deliveryOtp` — 4 digits the customer reads out to the driver. Only
    generated when the order has a customer phone to send it to. Never
    returned to staff or drivers by any API; the customer gets it in the
    WhatsApp/SMS message and on the tracking page.

When the order goes out for delivery the customer is sent the link and OTP:
WhatsApp first (tenant feature `whatsapp`), SMS as the fallback (feature
`customer_sms`). The outcome is stored on the order as `trackingNotified`.
The driver must enter the OTP to mark the order delivered, but only when
that message actually reached Twilio — otherwise the customer never had the
code and the driver would be stuck at the door.

WhatsApp outside a 24-hour customer session needs a Meta-approved template:
set `TWILIO_WA_TRACKING_CONTENT_SID` to a Twilio Content template whose
variables are {{1}} customer name, {{2}} order number, {{3}} store name,
{{4}} tracking link, {{5}} OTP. Without it a plain-text message is sent,
which only works in the sandbox or within an open session.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException

from db import get_db
from models import default_features
from sms_service import send_sms
from tz import now_ist
from ._shared import PROJECTION

logger = logging.getLogger("kanda.tracking")
router = APIRouter()

LOCATION_FRESH_MINUTES = 5
LINK_TTL_AFTER_DELIVERY = timedelta(hours=24)
# Fields only the customer may see — stripped from anything staff/drivers get.
PRIVATE_FIELDS = ("deliveryOtp", "deliveryOtpFails", "trackingToken")


def tracking_url(token: str) -> str:
    base = (os.environ.get("PUBLIC_BASE_URL") or "").rstrip("/")
    return f"{base}/track/{token}"


async def ensure_tracking(db, order: dict) -> dict:
    """Give a delivery order its tracking token (and OTP when there's a phone
    to send it to) if it doesn't have one yet. Returns the order with them.
    Safe to call repeatedly or concurrently: the write only lands when the
    token is still missing, and the winner's values are read back."""
    if order.get("type") != "delivery" or order.get("trackingToken"):
        return order
    fields = {"trackingToken": secrets.token_urlsafe(16)}
    if (order.get("customer") or {}).get("phone"):
        fields["deliveryOtp"] = f"{secrets.randbelow(10000):04d}"
    await db.orders.update_one(
        {"tenant_id": order["tenant_id"], "id": order["id"], "trackingToken": {"$in": [None]}},
        {"$set": fields},
    )
    fresh = await db.orders.find_one({"tenant_id": order["tenant_id"], "id": order["id"]}, PROJECTION)
    return fresh or {**order, **fields}


def _first_name(name: Optional[str]) -> str:
    return (name or "").strip().split(" ")[0] if name else ""


def _message(order: dict, store_name: str, url: str) -> str:
    who = _first_name((order.get("customer") or {}).get("name")) or "there"
    lines = [f"Hi {who}, your order #{order['number']} from {store_name} is on the way."]
    lines.append(f"Track it live: {url}")
    if order.get("deliveryOtp"):
        lines.append(f"Delivery OTP: {order['deliveryOtp']}. Share it with the driver only when you receive your order.")
    if order.get("payment") == "unpaid":
        lines.append(f"Amount to pay on delivery: Rs {round(float(order.get('total') or 0))}.")
    return "\n".join(lines)


async def _send_whatsapp(db, tenant_id: str, phone: str, order: dict, store_name: str, url: str, body: str) -> Optional[str]:
    """Returns None on success, else an error string."""
    from routes import whatsapp as wa
    client = wa._twilio_client()
    if client is None:
        return "Twilio not configured"
    to_addr = wa._to_wa_address(phone)
    if not to_addr:
        return "Invalid phone number"
    kwargs = {"to": to_addr, "from_": wa._wa_from()}
    content_sid = os.environ.get("TWILIO_WA_TRACKING_CONTENT_SID", "").strip()
    if content_sid:
        kwargs["content_sid"] = content_sid
        kwargs["content_variables"] = json.dumps({
            "1": _first_name((order.get("customer") or {}).get("name")) or "there",
            "2": str(order["number"]), "3": store_name, "4": url, "5": order.get("deliveryOtp") or "-",
        })
    else:
        kwargs["body"] = body
    error = None
    sid = None
    try:
        msg = await asyncio.to_thread(client.messages.create, **kwargs)
        sid = msg.sid
    except Exception as exc:  # noqa: BLE001
        error = getattr(exc, "msg", None) or str(exc)
    # Log it in the store's WhatsApp inbox like any other outbound message.
    try:
        clean_phone = wa._strip_wa(to_addr)
        conv = await wa._upsert_conversation(db, tenant_id, clean_phone, body, direction="out")
        await wa._insert_message(db, tenant_id=tenant_id, conversation_id=conv["id"], phone=clean_phone,
                                 direction="out", body=body, sent_by="Delivery tracking",
                                 twilio_sid=sid, error=error)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Logging tracking WhatsApp failed: %s", exc)
    return error


async def notify_customer(db, order: dict) -> dict:
    """Send the tracking link + OTP to the customer and record the outcome
    on the order. Never raises."""
    result = {"ok": False, "channel": None, "error": None, "at": now_ist().isoformat()}
    try:
        phone = (order.get("customer") or {}).get("phone")
        if not phone:
            result["error"] = "No customer phone"
        elif not order.get("trackingToken"):
            result["error"] = "No tracking link"
        else:
            tenant = await db.tenants.find_one({"id": order["tenant_id"]}, {"_id": 0}) or {}
            features = {**default_features(tenant.get("business_type", "restaurant")), **(tenant.get("features") or {})}
            store_name = (tenant.get("store") or {}).get("name") or tenant.get("name") or "the store"
            url = tracking_url(order["trackingToken"])
            body = _message(order, store_name, url)
            errors = []
            if features.get("whatsapp"):
                err = await _send_whatsapp(db, order["tenant_id"], phone, order, store_name, url, body)
                if err is None:
                    result.update(ok=True, channel="whatsapp")
                else:
                    errors.append(f"WhatsApp: {err}")
            if not result["ok"] and features.get("customer_sms"):
                if await send_sms(phone, body):
                    result.update(ok=True, channel="sms")
                else:
                    errors.append("SMS: not sent")
            if not result["ok"]:
                result["error"] = "; ".join(errors) or "Messaging is turned off for this store"
    except Exception as exc:  # noqa: BLE001
        logger.warning("Tracking notification for %s failed: %s", order.get("id"), exc)
        result["error"] = str(exc)
    await db.orders.update_one({"tenant_id": order["tenant_id"], "id": order["id"]},
                               {"$set": {"trackingNotified": result}})
    return result


def otp_required(order: dict) -> bool:
    return bool(order.get("deliveryOtp")) and bool((order.get("trackingNotified") or {}).get("ok"))


def _fresh(at: Optional[str]) -> bool:
    try:
        return now_ist() - datetime.fromisoformat(at) <= timedelta(minutes=LOCATION_FRESH_MINUTES)
    except (TypeError, ValueError):
        return False


@router.get("/track/{token}")
async def public_tracking(token: str):
    """Public, unauthenticated: what the customer's tracking link shows."""
    if not token or len(token) < 16:
        raise HTTPException(status_code=404, detail="Tracking link not found")
    db = get_db()
    order = await db.orders.find_one({"trackingToken": token, "type": "delivery"}, PROJECTION)
    if not order:
        raise HTTPException(status_code=404, detail="Tracking link not found")
    times = order.get("statusTimes") or {}
    if order.get("status") == "completed":
        try:
            if now_ist() - datetime.fromisoformat(times.get("completed")) > LINK_TTL_AFTER_DELIVERY:
                raise HTTPException(status_code=404, detail="This tracking link has expired")
        except (TypeError, ValueError):
            pass

    tenant = await db.tenants.find_one({"id": order["tenant_id"]}, {"_id": 0, "name": 1, "store": 1}) or {}
    store = tenant.get("store") or {}
    status = "cancelled" if order.get("voided") else order.get("status")

    location = None
    driver_first = _first_name(order.get("driver"))
    if status == "out-for-delivery" and order.get("driver_id"):
        loc = await db.driver_locations.find_one(
            {"tenant_id": order["tenant_id"], "user_id": order["driver_id"]}, {"_id": 0})
        if loc and _fresh(loc.get("at")):
            location = {k: loc.get(k) for k in ("lat", "lng", "accuracy", "heading", "at")}

    cust = order.get("customer") or {}
    return {
        "number": order["number"],
        "status": status,
        "statusTimes": times,
        "placedAt": order.get("placedAt"),
        "store": {"name": store.get("name") or tenant.get("name") or "", "address": store.get("address") or "",
                  "phone": store.get("phone") or ""},
        "customer": {"name": _first_name(cust.get("name")), "address": ", ".join(
            x for x in (cust.get("address"), cust.get("postcode")) if x)},
        "driver": {"name": driver_first} if driver_first else None,
        "location": location,
        # The customer's own OTP — shown only while the order is on its way.
        "otp": order.get("deliveryOtp") if status == "out-for-delivery" else None,
        "items": [{"qty": it.get("qty"), "name": it.get("name")} for it in order.get("items") or []],
        "total": order.get("total"),
        "payment": order.get("payment"),
    }
