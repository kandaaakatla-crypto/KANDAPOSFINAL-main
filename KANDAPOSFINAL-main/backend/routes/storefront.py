"""Public, unauthenticated customer-facing ordering API — reached by scanning
a per-table or pickup QR code. No staff PIN, no owner/dash JWT.

Two flows:
  - Table:   POST /storefront/{slug}/table/{number}/order   — no identity check,
             the customer is physically at that table.
  - Pickup:  POST /storefront/{slug}/otp/request  → SMS code
             POST /storefront/{slug}/otp/verify   → short-lived storefront JWT
             POST /storefront/{slug}/pickup/order (Bearer <storefront JWT>)

Prices are always resolved server-side from the live menu — the client only
ever sends item ids, never amounts, so a tampered request can't undercharge.
"""
import os
import secrets
import uuid
from datetime import timedelta
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
import jwt
from pydantic import BaseModel

from db import get_db
from tz import now_ist
from auth import _secret, JWT_ALG
from ws import schedule_broadcast
from kds import annotate_order_items_for_kds
from sms_service import send_sms, normalize_phone
from routes.orders import _apply_recipes
from ._shared import PROJECTION, clean, menu_doc_to_response, next_order_number, table_doc_to_response

router = APIRouter(prefix="/storefront")

STOREFRONT_ISSUER = "storefront"
OTP_TTL_MINUTES = 5
SESSION_TTL_HOURS = 2
SIZE_LABEL = {"sm": "Small", "md": "Medium", "lg": "Large"}


async def _tenant_by_slug(slug: str, db) -> dict:
    tenant = await db.tenants.find_one({"slug": slug}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Store not found")
    if tenant.get("status") == "suspended":
        raise HTTPException(status_code=404, detail="Store not found")
    return tenant


# ===================================================================
# Menu
# ===================================================================
@router.get("/{slug}/menu")
async def public_menu(slug: str):
    db = get_db()
    tenant = await _tenant_by_slug(slug, db)
    cats = await db.categories.find({"tenant_id": tenant["id"]}, PROJECTION).sort("sort_order", 1).to_list(100)
    items = await db.menu_items.find({"tenant_id": tenant["id"], "available": True}, PROJECTION).to_list(500)
    return {
        "tenant": {"name": tenant.get("name"), "slug": slug},
        "categories": cats,
        "items": [menu_doc_to_response(i) for i in items],
    }


@router.get("/{slug}/table/{number}")
async def public_table(slug: str, number: int):
    db = get_db()
    tenant = await _tenant_by_slug(slug, db)
    table = await db.tables.find_one({"tenant_id": tenant["id"], "number": number}, PROJECTION)
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    return {"tenant": {"name": tenant.get("name"), "slug": slug}, "table": {"number": table["number"], "seats": table["seats"]}}


# ===================================================================
# Cart line resolution — server is the source of truth for price
# ===================================================================
class CartLine(BaseModel):
    item_id: str
    qty: int = 1
    size: Optional[str] = None
    mods: List[str] = []
    note: Optional[str] = None


async def _resolve_lines(db, tenant_id: str, lines: List[CartLine]) -> list[dict]:
    if not lines:
        raise HTTPException(status_code=400, detail="Cart is empty")
    ids = list({ln.item_id for ln in lines})
    docs = await db.menu_items.find({"tenant_id": tenant_id, "id": {"$in": ids}}, PROJECTION).to_list(500)
    by_id = {d["id"]: d for d in docs}
    out = []
    for ln in lines:
        item = by_id.get(ln.item_id)
        if not item or not item.get("available", True):
            raise HTTPException(status_code=400, detail=f"Item no longer available")
        qty = max(1, int(ln.qty))
        if item.get("is_pizza"):
            size = ln.size if ln.size in ("sm", "md", "lg") else "md"
            price = (item.get("sizes") or {}).get(size)
            if price is None:
                raise HTTPException(status_code=400, detail=f"{item['name']} has no price for that size")
            name = f"{item['name']} {SIZE_LABEL[size]}"
            out.append({"name": name, "qty": qty, "price": float(price), "mods": ln.mods[:20], "size": size})
        else:
            price = item.get("price") or 0
            out.append({"name": item["name"], "qty": qty, "price": float(price), "mods": ln.mods[:20], "size": None})
        if ln.note:
            out[-1]["mods"] = out[-1]["mods"] + [f"Note: {ln.note.strip()[:200]}"]
    return out


def _order_doc(tenant_id: str, number: int, order_type: str, customer: dict, table: Optional[int],
                items: list[dict], source: str = "qr") -> dict:
    total = round(sum(it["price"] * it["qty"] for it in items), 2)
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
# Table ordering — no identity check, customer is physically present
# ===================================================================
class TableOrderRequest(BaseModel):
    items: List[CartLine]
    customer_name: Optional[str] = None


@router.post("/{slug}/table/{number}/order")
async def place_table_order(slug: str, number: int, payload: TableOrderRequest):
    db = get_db()
    tenant = await _tenant_by_slug(slug, db)
    table = await db.tables.find_one({"tenant_id": tenant["id"], "number": number}, PROJECTION)
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")

    raw_items = await _resolve_lines(db, tenant["id"], payload.items)
    items = await annotate_order_items_for_kds(db, tenant["id"], raw_items)
    numbr = await next_order_number(db, tenant["id"])
    customer_name = (payload.customer_name or "").strip() or f"Table {number}"
    doc = _order_doc(tenant["id"], numbr, "dine-in", {"id": None, "name": customer_name, "phone": None, "address": None, "postcode": None}, number, items)
    await db.orders.insert_one(doc)
    await _apply_recipes(db, tenant["id"], raw_items)

    await db.tables.update_one({"tenant_id": tenant["id"], "number": number}, {"$set": {"status": "occupied", "order_id": doc["id"]}})
    updated_table = await db.tables.find_one({"tenant_id": tenant["id"], "number": number}, PROJECTION)
    if updated_table:
        schedule_broadcast("table.updated", table_doc_to_response(updated_table), tenant["id"])

    cleaned = clean(doc)
    schedule_broadcast("order.upserted", cleaned, tenant["id"])
    schedule_broadcast("kds.ticket", {"orderId": doc["id"], "number": doc["number"]}, tenant["id"])
    return {"orderNumber": doc["number"], "total": doc["total"]}


# ===================================================================
# Pickup OTP — name + phone, SMS-verified
# ===================================================================
class OtpRequestPayload(BaseModel):
    name: str
    phone: str


class OtpVerifyPayload(BaseModel):
    phone: str
    code: str


@router.post("/{slug}/otp/request")
async def request_otp(slug: str, payload: OtpRequestPayload):
    db = get_db()
    tenant = await _tenant_by_slug(slug, db)
    phone = normalize_phone(payload.phone)
    name = payload.name.strip()[:80]
    if not phone or not name:
        raise HTTPException(status_code=400, detail="Name and phone are required")
    code = f"{secrets.randbelow(1000000):06d}"
    doc = {
        "tenant_id": tenant["id"], "phone": phone, "name": name, "code": code,
        "expires_at": (now_ist() + timedelta(minutes=OTP_TTL_MINUTES)).isoformat(),
        "created_at": now_ist().isoformat(),
    }
    await db.customer_otps.replace_one({"tenant_id": tenant["id"], "phone": phone}, doc, upsert=True)
    sent = await send_sms(phone, f"Your {tenant.get('name','Kanda POS')} verification code is {code}. Valid for {OTP_TTL_MINUTES} minutes.")

    resp = {"ok": True, "phone": phone}
    if not sent and not os.environ.get("TWILIO_ACCOUNT_SID", "").strip():
        # No SMS provider configured in this environment — surface the code
        # directly so the flow is still testable end-to-end locally.
        resp["dev_code"] = code
    return resp


@router.post("/{slug}/otp/verify")
async def verify_otp(slug: str, payload: OtpVerifyPayload):
    db = get_db()
    tenant = await _tenant_by_slug(slug, db)
    phone = normalize_phone(payload.phone)
    rec = await db.customer_otps.find_one({"tenant_id": tenant["id"], "phone": phone})
    if not rec or rec.get("code") != payload.code.strip():
        raise HTTPException(status_code=401, detail="Incorrect code")
    if rec.get("expires_at", "") < now_ist().isoformat():
        raise HTTPException(status_code=401, detail="Code expired — request a new one")
    await db.customer_otps.delete_one({"_id": rec["_id"]})
    token = jwt.encode({
        "sub": phone, "name": rec["name"], "tenant_id": tenant["id"], "iss": STOREFRONT_ISSUER,
        "exp": now_ist() + timedelta(hours=SESSION_TTL_HOURS),
    }, _secret(), algorithm=JWT_ALG)
    return {"token": token, "name": rec["name"], "phone": phone}


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


@router.post("/{slug}/pickup/order")
async def place_pickup_order(slug: str, payload: PickupOrderRequest, request: Request):
    db = get_db()
    session = await _storefront_session(request, slug, db)
    tenant = session["tenant"]

    raw_items = await _resolve_lines(db, tenant["id"], payload.items)
    items = await annotate_order_items_for_kds(db, tenant["id"], raw_items)
    numbr = await next_order_number(db, tenant["id"])
    customer = {"id": None, "name": session["name"], "phone": session["phone"], "address": None, "postcode": None}
    doc = _order_doc(tenant["id"], numbr, "collection", customer, None, items)
    await db.orders.insert_one(doc)
    await _apply_recipes(db, tenant["id"], raw_items)

    cleaned = clean(doc)
    schedule_broadcast("order.upserted", cleaned, tenant["id"])
    schedule_broadcast("kds.ticket", {"orderId": doc["id"], "number": doc["number"]}, tenant["id"])
    return {"orderNumber": doc["number"], "total": doc["total"]}
