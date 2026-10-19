"""Public, unauthenticated customer-facing ordering API — reached by scanning
a per-table or pickup QR code. No staff PIN, no owner/dash JWT.

Sign-in: POST /storefront/{slug}/otp/request  → code by WhatsApp (SMS fallback)
         POST /storefront/{slug}/otp/verify   → short-lived storefront JWT

Two flows:
  - Table:   POST /storefront/{slug}/table/{number}/order (Bearer <storefront JWT>)
             — needs a verified phone while QR_OTP_REQUIRED is on (default),
             so a forwarded or misplaced QR link can't put orders on a table.
  - Pickup:  POST /storefront/{slug}/pickup/order — name + mobile at checkout,
             or a storefront JWT.

Prices are always resolved server-side from the live menu — the client only
ever sends item ids, never amounts, so a tampered request can't undercharge.
"""
import asyncio
import hashlib
import json
import logging
import re
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
import jwt
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from db import get_db
from tz import now_ist
from auth import _secret, JWT_ALG, DEMO_TENANT_IDS
from ws import schedule_broadcast
from kds import annotate_order_items_for_kds
from sms_service import send_otp_sms, normalize_phone, sms_otp_enabled
from routes import whatsapp as wa
from routes.orders import _apply_recipes, _with_service_charge
from payments import _get_client as _get_razorpay_client
from tax import collects_gst, resolve_effective_rate, compute_line_tax, compute_order_tax
from scheduling import resolve_item_schedule_state, apply_schedule_pricing
from ._shared import PROJECTION, NOT_DELETED, clean, menu_doc_to_response, next_order_number, table_doc_to_response
import razorpay

logger = logging.getLogger("kanda.storefront")
router = APIRouter(prefix="/storefront")

STOREFRONT_ISSUER = "storefront"
OTP_TTL_MINUTES = 5
OTP_RESEND_SECONDS = 30
OTP_MAX_PER_HOUR = 5
OTP_MAX_ATTEMPTS = 5
SESSION_TTL_HOURS = 2
DUPLICATE_WINDOW_SECONDS = 60
NOTE_MAX_CHARS = 140
SIZE_LABEL = {"sm": "Small", "md": "Medium", "lg": "Large"}


async def _tenant_by_slug(slug: str, db) -> dict:
    tenant = await db.tenants.find_one({"slug": slug}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Store not found")
    if tenant.get("status") == "suspended":
        raise HTTPException(status_code=404, detail="Store not found")
    if (tenant.get("features") or {}).get("qr_ordering") is False:
        raise HTTPException(status_code=404, detail="Online ordering isn't available for this store")
    return tenant


def qr_otp_required(tenant: dict) -> bool:
    """QR table orders need a verified phone unless QR_OTP_REQUIRED=0. The
    demo store never sends codes (no paid channels), so it never asks."""
    if os.environ.get("QR_OTP_REQUIRED", "1").strip() == "0":
        return False
    return tenant.get("id") not in DEMO_TENANT_IDS


# ===================================================================
# Menu
# ===================================================================
@router.get("/{slug}/menu")
async def public_menu(slug: str):
    db = get_db()
    tenant = await _tenant_by_slug(slug, db)
    cats = await db.categories.find({"tenant_id": tenant["id"], **NOT_DELETED}, PROJECTION).sort("sort_order", 1).to_list(100)
    items = await db.menu_items.find({"tenant_id": tenant["id"], "available": True, **NOT_DELETED}, PROJECTION).to_list(500)
    schedules = await db.menu_schedules.find({"tenant_id": tenant["id"], **NOT_DELETED}, PROJECTION).to_list(100)
    now = now_ist()
    visible = []
    for it in items:
        mode, value, hidden = resolve_item_schedule_state(it, schedules, now)
        if hidden:
            continue  # day-part item outside its window — hide from the public menu
        visible.append(apply_schedule_pricing(it, mode, value))
    store = tenant.get("store") or {}
    return {
        "tenant": {
            "name": tenant.get("name"), "slug": slug,
            "businessType": tenant.get("business_type", "restaurant"),
            "onlinePayments": (tenant.get("features") or {}).get("online_payments", True),
            "logoUrl": store.get("logo_url"),
            "backgroundImageUrl": store.get("background_image_url"),
            "qrOtpRequired": qr_otp_required(tenant),
        },
        "categories": cats,
        "items": [menu_doc_to_response(i) for i in visible],
    }


@router.get("/{slug}/table/{number}")
async def public_table(slug: str, number: int):
    db = get_db()
    tenant = await _tenant_by_slug(slug, db)
    table = await db.tables.find_one({"tenant_id": tenant["id"], "number": number}, PROJECTION)
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    return {"tenant": {"name": tenant.get("name"), "slug": slug}, "table": {"number": table["number"], "seats": table["seats"]},
            "otpRequired": qr_otp_required(tenant)}


@router.get("/{slug}/table/{number}/bill")
async def public_table_bill(slug: str, number: int):
    """The table's running bill, for the guest's "Your bill" tab. Anyone
    holding the table's QR can see it, as with a paper bill on the table,
    so it carries the items and totals only: no customer details."""
    db = get_db()
    tenant = await _tenant_by_slug(slug, db)
    table = await db.tables.find_one({"tenant_id": tenant["id"], "number": number}, PROJECTION)
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    order = None
    if table.get("order_id"):
        order = await db.orders.find_one(
            {"tenant_id": tenant["id"], "id": table["order_id"], "voided": {"$ne": True}, "status": {"$ne": "completed"}},
            PROJECTION,
        )
    if not order:
        return {"open": False}
    return {
        "open": True,
        "orderId": order["id"],
        "orderNumber": order["number"],
        "paid": (order.get("payment") or "unpaid") != "unpaid",
        "items": [
            {"name": it.get("name"), "qty": it.get("qty"), "price": it.get("price"), "mods": it.get("mods") or []}
            for it in order.get("items") or []
        ],
        "subtotal": order.get("subtotal"),
        "taxTotal": order.get("taxTotal"),
        "cgst": order.get("cgst"),
        "sgst": order.get("sgst"),
        "serviceCharge": order.get("serviceCharge") or 0,
        "discount": order.get("discount") or 0,
        "total": order.get("total"),
    }


# ===================================================================
# Cart line resolution — server is the source of truth for price
# ===================================================================
class CartLine(BaseModel):
    item_id: str
    qty: int = Field(1, ge=1, le=99)
    size: Optional[str] = None
    variant: Optional[str] = None  # variant label, for generic retail products
    mods: List[str] = []
    note: Optional[str] = Field(None, max_length=NOTE_MAX_CHARS)  # "less spicy"


async def _resolve_lines(db, tenant_id: str, lines: List[CartLine], business_type: str = "restaurant",
                         charge_gst: bool = True) -> list[dict]:
    if not lines:
        raise HTTPException(status_code=400, detail="Cart is empty")
    ids = list({ln.item_id for ln in lines})
    docs = await db.menu_items.find({"tenant_id": tenant_id, "id": {"$in": ids}, **NOT_DELETED}, PROJECTION).to_list(500)
    by_id = {d["id"]: d for d in docs}
    cat_ids = list({d["cat_id"] for d in docs if d.get("cat_id")})
    cats = await db.categories.find({"tenant_id": tenant_id, "id": {"$in": cat_ids}}, PROJECTION).to_list(200)
    cat_by_id = {c["id"]: c for c in cats}
    schedules = await db.menu_schedules.find({"tenant_id": tenant_id, **NOT_DELETED}, PROJECTION).to_list(100)
    now = now_ist()
    inclusive = business_type == "retail"
    out = []
    for ln in lines:
        item = by_id.get(ln.item_id)
        if not item or not item.get("available", True):
            raise HTTPException(status_code=400, detail=f"Item no longer available")
        # Prices are always resolved from the live menu (see module docstring) —
        # day-part availability and any active happy-hour discount are enforced
        # here too, server-side, so a client can't order outside the window or
        # skip the discount either direction.
        mode, value, hidden = resolve_item_schedule_state(item, schedules, now)
        if hidden:
            raise HTTPException(status_code=400, detail=f"{item['name']} isn't available right now")
        if mode:
            item = apply_schedule_pricing(item, mode, value)
        cat = cat_by_id.get(item.get("cat_id"))
        qty = max(1, int(ln.qty))
        if item.get("is_pizza"):
            size = ln.size if ln.size in ("sm", "md", "lg") else "md"
            price = (item.get("sizes") or {}).get(size)
            if price is None:
                raise HTTPException(status_code=400, detail=f"{item['name']} has no price for that size")
            name = f"{item['name']} {SIZE_LABEL[size]}"
            out.append({"name": name, "qty": qty, "price": float(price), "mods": ln.mods[:20], "size": size})
        elif item.get("variants"):
            variants = item["variants"]
            match = next((v for v in variants if v.get("label") == ln.variant), None) or variants[0]
            if not match.get("available", True):
                raise HTTPException(status_code=400, detail=f"{item['name']} ({match.get('label')}) is unavailable")
            name = f"{item['name']} — {match['label']}"
            out.append({"name": name, "qty": qty, "price": float(match["price"]), "mods": ln.mods[:20], "size": None})
        else:
            price = item.get("price") or 0
            out.append({"name": item["name"], "qty": qty, "price": float(price), "mods": ln.mods[:20], "size": None})
        note = (ln.note or "").strip()[:NOTE_MAX_CHARS]
        if note:
            out[-1]["mods"] = out[-1]["mods"] + [f"Note: {note}"]
        rate, _source = resolve_effective_rate(
            item.get("tax_rate"), cat.get("tax_rate") if cat else None,
            cat["name"] if cat else "", business_type, out[-1]["price"],
        )
        if not charge_gst:
            rate = 0.0
        _, tax_amt = compute_line_tax(out[-1]["price"], out[-1]["qty"], rate, inclusive)
        out[-1]["tax_rate"] = rate
        out[-1]["tax_amount"] = tax_amt
    return out


def _order_doc(tenant_id: str, number: int, order_type: str, customer: dict, table: Optional[int],
                items: list[dict], source: str = "qr", business_type: str = "restaurant") -> dict:
    inclusive = business_type == "retail"
    line_amounts = [
        compute_line_tax(it["price"], it["qty"], it.get("tax_rate", 0) or 0, inclusive)
        for it in items
    ]
    tax = compute_order_tax(line_amounts)
    total = tax["items_total"]
    return {
        "id": f"o_{uuid.uuid4().hex[:10]}",
        "tenant_id": tenant_id,
        "number": number,
        "type": order_type,
        "status": "new",
        "customer": customer,
        "table": table,
        "items": items,
        "deliveryFee": 0,
        "discount": 0,
        "total": total,
        "subtotal": tax["subtotal"],
        "taxTotal": tax["tax_total"],
        "cgst": tax["cgst"],
        "sgst": tax["sgst"],
        "taxInclusive": inclusive,
        "payment": "unpaid",
        "placedAt": now_ist().isoformat(),
        "driver": None,
        "source": source,
        "tip": 0,
        "coupon_code": None,
        "location_id": None,
        "customer_email": None,
        "refunded_amount": 0,
        "voided": False,
        "loyalty_earned": 0,
        "loyalty_redeemed": 0,
        "splits": None,
        "packed": False,
    }


# ===================================================================
# Table ordering — verified phone (QR_OTP_REQUIRED), one running bill
# ===================================================================
class TableOrderRequest(BaseModel):
    items: List[CartLine]
    customer_name: Optional[str] = None


async def _optional_storefront_session(request: Request, slug: str, db) -> Optional[dict]:
    """Like _storefront_session, but returns None instead of raising when no
    (or an invalid) Bearer token is present — for pickup, and table orders
    while QR_OTP_REQUIRED=0, sign-in is optional but attached when present."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    try:
        return await _storefront_session(request, slug, db)
    except HTTPException:
        return None


async def _add_to_open_table_bill(db, tenant_id: str, table: dict, items: list[dict], business_type: str,
                                  qr_round: Optional[dict] = None):
    """A table has one running bill. If the table's current order is still
    open (unpaid, not voided or completed), add this round to it, as staff
    do with an occupied table, and return the updated order; else None."""
    order_id = table.get("order_id")
    if not order_id:
        return None
    open_filter = {
        "tenant_id": tenant_id, "id": order_id, "voided": {"$ne": True},
        "status": {"$ne": "completed"}, "payment": {"$in": [None, "unpaid"]},
    }
    existing = await db.orders.find_one(open_filter, PROJECTION)
    if not existing:
        return None
    inclusive = business_type == "retail"
    add = compute_order_tax([
        compute_line_tax(it["price"], it["qty"], it.get("tax_rate", 0) or 0, inclusive) for it in items
    ])
    items_tax = float(existing.get("taxTotal", 0) or 0) - float(existing.get("serviceChargeTax") or 0)
    totals = _with_service_charge(
        existing,
        float(existing.get("subtotal", 0) or 0) + add["subtotal"],
        items_tax + add["tax_total"],
        add["items_total"],
        float(existing.get("serviceChargePct") or 0),
    )
    # Same open filter on the write: if the bill was settled in between, start a new one.
    push = {"items": {"$each": items}}
    if qr_round:
        push["qr_rounds"] = qr_round
    return await db.orders.find_one_and_update(
        open_filter,
        {"$push": push, "$set": {**totals, "status": "new"}},
        projection=PROJECTION, return_document=True,
    )


def _cart_fingerprint(lines: List[CartLine]) -> str:
    """Same items, quantities, options and notes → same fingerprint,
    whatever order the lines are in."""
    rows = sorted(json.dumps([ln.item_id, ln.qty, ln.size, ln.variant, sorted(ln.mods), (ln.note or "").strip()])
                  for ln in lines)
    return hashlib.sha256("|".join(rows).encode()).hexdigest()[:32]


async def _claim_table_order(db, key: str):
    """Claim the right to place this exact order. Returns None when claimed,
    else the order a recent identical request already placed (or raises
    409 while that one is still being placed)."""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=DUPLICATE_WINDOW_SECONDS)
    try:
        await db.qr_order_dedupe.insert_one({"_id": key, "created": now, "order_id": None})
        return None
    except DuplicateKeyError:
        pass
    # An old claim (outside the window) is taken over atomically.
    taken = await db.qr_order_dedupe.find_one_and_update(
        {"_id": key, "created": {"$lt": cutoff}}, {"$set": {"created": now, "order_id": None}})
    if taken:
        return None
    for _ in range(20):  # the first request may still be placing it
        rec = await db.qr_order_dedupe.find_one({"_id": key})
        if rec is None:  # the first attempt failed and released it
            return await _claim_table_order(db, key)
        if rec.get("order_id"):
            return rec["order_id"]
        await asyncio.sleep(0.1)
    raise HTTPException(status_code=409, detail="This order is already being placed")


@router.post("/{slug}/table/{number}/order")
async def place_table_order(slug: str, number: int, payload: TableOrderRequest, request: Request):
    db = get_db()
    tenant = await _tenant_by_slug(slug, db)
    table = await db.tables.find_one({"tenant_id": tenant["id"], "number": number}, PROJECTION)
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")

    if not qr_otp_required(tenant):
        return await _place_table_order(db, slug, tenant, table, number, payload, request, None)

    session = await _storefront_session(request, slug, db)
    key = f"{tenant['id']}:{number}:{session['phone']}:{_cart_fingerprint(payload.items)}"
    existing_id = await _claim_table_order(db, key)
    if existing_id:
        order = await db.orders.find_one({"tenant_id": tenant["id"], "id": existing_id}, PROJECTION)
        if order:
            return {"orderId": order["id"], "orderNumber": order["number"], "total": order["total"], "duplicate": True}
    try:
        result = await _place_table_order(db, slug, tenant, table, number, payload, request, session)
    except BaseException:
        await db.qr_order_dedupe.delete_one({"_id": key})
        raise
    await db.qr_order_dedupe.update_one({"_id": key}, {"$set": {"order_id": result["orderId"]}})
    return result


async def _place_table_order(db, slug: str, tenant: dict, table: dict, number: int, payload: TableOrderRequest,
                             request: Request, session: Optional[dict]):
    business_type = tenant.get("business_type", "restaurant")
    if session is None:
        session = await _optional_storefront_session(request, slug, db)
        qr_round = None
    else:
        qr_round = {"phone": session["phone"], "name": session["name"], "at": now_ist().isoformat()}
    raw_items = await _resolve_lines(db, tenant["id"], payload.items, business_type, collects_gst(tenant))
    items = await annotate_order_items_for_kds(db, tenant["id"], raw_items)

    running = await _add_to_open_table_bill(db, tenant["id"], table, items, business_type, qr_round)
    if running:
        await _apply_recipes(db, tenant["id"], raw_items)
        cleaned = clean(running)
        schedule_broadcast("order.upserted", cleaned, tenant["id"])
        schedule_broadcast("kds.ticket", {"orderId": running["id"], "number": running["number"]}, tenant["id"])
        return {"orderId": running["id"], "orderNumber": running["number"], "total": running["total"]}

    numbr = await next_order_number(db, tenant["id"])
    if session:
        customer = {"id": None, "name": session["name"], "phone": session["phone"], "address": None, "postcode": None}
    else:
        customer_name = (payload.customer_name or "").strip() or f"Table {number}"
        customer = {"id": None, "name": customer_name, "phone": None, "address": None, "postcode": None}
    doc = _order_doc(tenant["id"], numbr, "dine-in", customer, number, items, business_type=business_type)
    if qr_round:
        doc["qr_rounds"] = [qr_round]
    await db.orders.insert_one(doc)
    await _apply_recipes(db, tenant["id"], raw_items)

    await db.tables.update_one({"tenant_id": tenant["id"], "number": number}, {"$set": {"status": "occupied", "order_id": doc["id"]}})
    updated_table = await db.tables.find_one({"tenant_id": tenant["id"], "number": number}, PROJECTION)
    if updated_table:
        schedule_broadcast("table.updated", table_doc_to_response(updated_table), tenant["id"])

    cleaned = clean(doc)
    schedule_broadcast("order.upserted", cleaned, tenant["id"])
    schedule_broadcast("kds.ticket", {"orderId": doc["id"], "number": doc["number"]}, tenant["id"])
    return {"orderId": doc["id"], "orderNumber": doc["number"], "total": doc["total"]}


# ===================================================================
# Sign-in codes — WhatsApp first, SMS (OTP only) as the fallback
# ===================================================================
class OtpRequestPayload(BaseModel):
    name: str = Field(..., max_length=80)
    phone: str = Field(..., max_length=20)


class OtpVerifyPayload(BaseModel):
    phone: str = Field(..., max_length=20)
    code: str = Field(..., max_length=10)


def _wa_otp_sid() -> str:
    return os.environ.get("WA_OTP_CONTENT_SID", "").strip()


def _otp_channel_available() -> bool:
    return bool(_wa_otp_sid() and wa._twilio_client() is not None) or sms_otp_enabled()


async def _deliver_otp(phone: str, code: str, store_name: str) -> Optional[str]:
    """Send the code; returns the channel used ("whatsapp" | "sms") or None."""
    sid = _wa_otp_sid()
    client = wa._twilio_client() if sid else None
    if client is not None:
        try:
            # Authentication template on Kanda's main number: variable 1 = code.
            await wa._send_wa_template(client, f"whatsapp:{phone}", sid, {"1": code})
            return "whatsapp"
        except Exception as exc:  # noqa: BLE001
            logger.warning("WhatsApp OTP to %s failed: %s", phone, getattr(exc, "msg", None) or exc)
    if sms_otp_enabled():
        body = f"{code} is your {store_name} verification code. Valid for {OTP_TTL_MINUTES} minutes."
        if await send_otp_sms(phone, body):
            return "sms"
    return None


@router.post("/{slug}/otp/request")
async def request_otp(slug: str, payload: OtpRequestPayload):
    db = get_db()
    tenant = await _tenant_by_slug(slug, db)
    # Never fall back to handing the code back in this response.
    if not _otp_channel_available():
        raise HTTPException(status_code=410, detail="Phone sign-in isn't available right now")
    if tenant["id"] in DEMO_TENANT_IDS:
        raise HTTPException(status_code=403, detail="Not available in the demo store")
    phone = _indian_mobile(payload.phone)
    name = payload.name.strip()[:80]
    if not name:
        raise HTTPException(status_code=400, detail="Please enter your name")
    if not phone:
        raise HTTPException(status_code=400, detail="Please enter a valid 10-digit mobile number")

    now = now_ist()
    rec = await db.customer_otps.find_one({"tenant_id": tenant["id"], "phone": phone}) or {}
    hour_ago = (now - timedelta(hours=1)).isoformat()
    recent = sorted(t for t in (rec.get("sent_at") or []) if t > hour_ago)
    if recent:
        wait = OTP_RESEND_SECONDS - int((now - datetime.fromisoformat(recent[-1])).total_seconds())
        if wait > 0:
            raise HTTPException(status_code=429, detail=f"Please wait {wait} seconds before asking for a new code")
    if len(recent) >= OTP_MAX_PER_HOUR:
        raise HTTPException(status_code=429, detail="Too many codes requested. Please try again later.")

    code = f"{secrets.randbelow(1000000):06d}"
    update = {"$set": {
        "tenant_id": tenant["id"], "phone": phone, "name": name, "code": code, "attempts": 0,
        "expires_at": (now + timedelta(minutes=OTP_TTL_MINUTES)).isoformat(),
        "created_at": now.isoformat(), "sent_at": recent + [now.isoformat()],
    }}
    if rec:
        # Same sent_at as we read: a concurrent request that got in first wins.
        res = await db.customer_otps.update_one({"_id": rec["_id"], "sent_at": rec.get("sent_at")}, update)
        if res.matched_count == 0:
            raise HTTPException(status_code=429, detail="Please wait a moment before asking for a new code")
    else:
        await db.customer_otps.update_one({"tenant_id": tenant["id"], "phone": phone}, update, upsert=True)

    channel = await _deliver_otp(phone, code, tenant.get("name") or "Kanda POS")
    if not channel:
        raise HTTPException(status_code=502, detail="Could not send the code, please try again")
    return {"ok": True, "phone": phone, "channel": channel, "resendIn": OTP_RESEND_SECONDS}


@router.post("/{slug}/otp/verify")
async def verify_otp(slug: str, payload: OtpVerifyPayload):
    db = get_db()
    tenant = await _tenant_by_slug(slug, db)
    phone = _indian_mobile(payload.phone)
    if not phone:
        raise HTTPException(status_code=401, detail="Incorrect code")
    # Count the try before comparing, atomically, so parallel guesses can't
    # get past the cap.
    rec = await db.customer_otps.find_one_and_update(
        {"tenant_id": tenant["id"], "phone": phone, "code": {"$type": "string"},
         "attempts": {"$not": {"$gte": OTP_MAX_ATTEMPTS}}},
        {"$inc": {"attempts": 1}}, return_document=True,
    )
    if not rec:
        if await db.customer_otps.find_one({"tenant_id": tenant["id"], "phone": phone, "code": {"$type": "string"}}):
            raise HTTPException(status_code=401, detail="Too many wrong tries. Please request a new code.")
        raise HTTPException(status_code=401, detail="Incorrect code")
    if rec.get("expires_at", "") < now_ist().isoformat():
        raise HTTPException(status_code=401, detail="Code expired. Please request a new code.")
    if not secrets.compare_digest(str(rec["code"]).encode(), payload.code.strip().encode()):
        if rec.get("attempts", 0) >= OTP_MAX_ATTEMPTS:  # void: the filter above now skips it
            raise HTTPException(status_code=401, detail="Too many wrong tries. Please request a new code.")
        raise HTTPException(status_code=401, detail="Incorrect code")
    # Use the code up (keeping the send history for the rate limit); only
    # one of two simultaneous correct tries gets a session.
    used = await db.customer_otps.update_one({"_id": rec["_id"], "code": rec["code"]}, {"$unset": {"code": ""}})
    if used.modified_count != 1:
        raise HTTPException(status_code=401, detail="Incorrect code")
    exp = now_ist() + timedelta(hours=SESSION_TTL_HOURS)
    token = jwt.encode({
        "sub": phone, "name": rec["name"], "tenant_id": tenant["id"], "iss": STOREFRONT_ISSUER, "exp": exp,
    }, _secret(), algorithm=JWT_ALG)
    return {"token": token, "name": rec["name"], "phone": phone, "expiresAt": exp.isoformat()}


async def _storefront_session(request: Request, slug: str, db) -> dict:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Verification required")
    try:
        payload = jwt.decode(auth_header[7:], _secret(), algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired — verify again")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid session")
    if payload.get("iss") != STOREFRONT_ISSUER:
        raise HTTPException(status_code=401, detail="Invalid session")
    tenant = await _tenant_by_slug(slug, db)
    if payload.get("tenant_id") != tenant["id"]:
        raise HTTPException(status_code=401, detail="Invalid session")
    return {"phone": payload["sub"], "name": payload.get("name"), "tenant": tenant}


class PickupOrderRequest(BaseModel):
    items: List[CartLine]
    # No sign-in needed (SMS OTP is off): name + mobile at checkout, as on
    # Petpooja. Ignored when the customer is signed in.
    customer_name: Optional[str] = Field(None, max_length=60)
    customer_phone: Optional[str] = Field(None, max_length=20)


def _indian_mobile(raw: Optional[str]) -> Optional[str]:
    """+91XXXXXXXXXX for a valid 10-digit Indian mobile, else None."""
    p = normalize_phone(raw or "")
    return p if re.fullmatch(r"\+91[6-9]\d{9}", p or "") else None


@router.post("/{slug}/pickup/order")
async def place_pickup_order(slug: str, payload: PickupOrderRequest, request: Request):
    db = get_db()
    session = await _optional_storefront_session(request, slug, db)
    if session:
        tenant = session["tenant"]
        customer = {"id": None, "name": session["name"], "phone": session["phone"], "address": None, "postcode": None}
    else:
        tenant = await _tenant_by_slug(slug, db)
        name = (payload.customer_name or "").strip()
        phone = _indian_mobile(payload.customer_phone)
        if not name:
            raise HTTPException(status_code=400, detail="Please enter your name")
        if not phone:
            raise HTTPException(status_code=400, detail="Please enter a valid 10-digit mobile number")
        customer = {"id": None, "name": name, "phone": phone, "address": None, "postcode": None}
    business_type = tenant.get("business_type", "restaurant")

    raw_items = await _resolve_lines(db, tenant["id"], payload.items, business_type, collects_gst(tenant))
    items = await annotate_order_items_for_kds(db, tenant["id"], raw_items)
    numbr = await next_order_number(db, tenant["id"])
    doc = _order_doc(tenant["id"], numbr, "collection", customer, None, items, business_type=business_type)
    await db.orders.insert_one(doc)
    await _apply_recipes(db, tenant["id"], raw_items)

    cleaned = clean(doc)
    schedule_broadcast("order.upserted", cleaned, tenant["id"])
    schedule_broadcast("kds.ticket", {"orderId": doc["id"], "number": doc["number"]}, tenant["id"])
    return {"orderId": doc["id"], "orderNumber": doc["number"], "total": doc["total"]}


# ===================================================================
# Customer account — "my orders" for a verified phone number
# ===================================================================
@router.get("/{slug}/me")
async def my_account(slug: str, request: Request):
    db = get_db()
    session = await _storefront_session(request, slug, db)
    tenant = session["tenant"]
    cursor = db.orders.find(
        {"tenant_id": tenant["id"], "customer.phone": session["phone"], "voided": {"$ne": True}},
        {"_id": 0, "id": 1, "number": 1, "type": 1, "status": 1, "total": 1, "payment": 1, "placedAt": 1, "items": 1, "table": 1},
    ).sort("placedAt", -1).limit(10)
    orders = await cursor.to_list(10)
    return {"name": session["name"], "phone": session["phone"], "orders": orders}


# ===================================================================
# Online payment — Razorpay Checkout for a placed (unpaid) storefront order.
# Reuses the exact same Razorpay project/keys as the staff POS (payments.py);
# if RAZORPAY_KEY_ID/SECRET aren't configured, this 500s and the frontend
# falls back to "pay at table/collection" — no crash either way.
# ===================================================================
class StorefrontPaymentOrderRequest(BaseModel):
    order_id: str
    amount: Optional[float] = None  # ignored: the server charges the order's own total


@router.post("/{slug}/payments/order")
async def create_storefront_payment_order(slug: str, payload: StorefrontPaymentOrderRequest, request: Request):
    db = get_db()
    tenant = await _tenant_by_slug(slug, db)
    if not (tenant.get("features") or {}).get("online_payments", True):
        raise HTTPException(status_code=403, detail="Online payment isn't available for this store")
    # QR orders, plus any table bill (a table staff opened can be paid from its QR).
    order = await db.orders.find_one({
        "tenant_id": tenant["id"], "id": payload.order_id, "voided": {"$ne": True},
        "$or": [{"source": "qr"}, {"type": "dine-in", "table": {"$ne": None}}],
    }, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.get("payment") not in (None, "unpaid"):
        raise HTTPException(status_code=409, detail="This order is already paid")

    currency = os.environ.get("CURRENCY", "INR")
    amount_paise = int(round(float(order.get("total") or 0) * 100))
    if amount_paise <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")

    client = _get_razorpay_client()
    receipt = f"qr_{payload.order_id}"[:40]
    rzp_order = client.order.create({
        "amount": amount_paise, "currency": currency, "receipt": receipt, "payment_capture": 1,
    })
    await db.orders.update_one(
        {"tenant_id": tenant["id"], "id": payload.order_id},
        {"$set": {"razorpayOrderId": rzp_order["id"], "razorpayStatus": "created"}},
    )
    return {
        "razorpayOrderId": rzp_order["id"], "razorpayKeyId": os.environ["RAZORPAY_KEY_ID"],
        "amount": amount_paise, "currency": currency, "orderId": payload.order_id,
    }


class StorefrontVerifyPaymentRequest(BaseModel):
    order_id: str
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


@router.post("/{slug}/payments/verify")
async def verify_storefront_payment(slug: str, payload: StorefrontVerifyPaymentRequest):
    db = get_db()
    tenant = await _tenant_by_slug(slug, db)
    client = _get_razorpay_client()
    try:
        client.utility.verify_payment_signature({
            "razorpay_order_id": payload.razorpay_order_id,
            "razorpay_payment_id": payload.razorpay_payment_id,
            "razorpay_signature": payload.razorpay_signature,
        })
    except razorpay.errors.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid payment signature")

    updated = await db.orders.find_one_and_update(
        {"tenant_id": tenant["id"], "id": payload.order_id, "razorpayOrderId": payload.razorpay_order_id},
        {"$set": {"payment": "card", "razorpayPaymentId": payload.razorpay_payment_id, "razorpayStatus": "captured"}},
        return_document=True,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Order or Razorpay order id mismatch")
    updated.pop("_id", None)
    schedule_broadcast("order.upserted", updated, tenant["id"])
    return {"ok": True, "order": updated}
