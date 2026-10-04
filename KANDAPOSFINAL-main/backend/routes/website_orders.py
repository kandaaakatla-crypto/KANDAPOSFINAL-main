"""Website order ingest — lets a store's own online shop (WooCommerce,
Shopify, a custom site, …) push its orders into the POS so they land on the
order board and KDS exactly like a QR or counter order.

  - Manager/owner:  GET  /integrations/website        → is a key set? + ingest URL
                    POST /integrations/website/key    → (re)generate the key; the
                                                        plaintext is shown ONCE
                    DELETE /integrations/website/key  → turn ingest off
  - Website server: POST /integrations/website/orders   (X-Kanda-Key: wsk_…)

The key is per store (tenant) and only its SHA-256 is stored, so a leaked
database dump can't be replayed against the ingest endpoint. It is meant to
live on the website's server, never in browser JavaScript.

Lines reference the POS catalogue by `item_id` or by `sku` (the menu item's
barcode field). Prices, GST and stock deduction are resolved server-side from
the live menu, same as storefront.py, so the POS ledger and inventory stay
consistent whatever the website sends. `external_id` (the website's own order
id) makes the call idempotent: a retried webhook returns the order it
already created instead of a duplicate.
"""
import hashlib
import os
import secrets
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, StringConstraints
from typing_extensions import Annotated
from pymongo.errors import DuplicateKeyError

from auth import require_role
from db import get_db
from kds import annotate_order_items_for_kds
from routes.orders import _apply_recipes
from routes.storefront import CartLine, _order_doc, _resolve_lines
from tz import now_ist
from ws import schedule_broadcast
from ._shared import NOT_DELETED, PROJECTION, clean, next_order_number

router = APIRouter(prefix="/integrations/website")

KEY_PREFIX = "wsk_"
KEY_HEADER = "X-Kanda-Key"
EXTERNAL_REF_PREFIX = "website:"


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def _ingest_url(request: Request) -> str:
    # Same public origin the KDS links use (Firebase Hosting rewrites /api/**
    # to Cloud Run); the raw request URL is only a local-dev fallback.
    base = (os.environ.get("PUBLIC_BASE_URL") or "").rstrip("/")
    if base:
        return f"{base}/api/integrations/website/orders"
    return str(request.url_for("ingest_website_order"))


# ===================================================================
# Key management — store manager/owner, from the dashboard
# ===================================================================
@router.get("")
async def website_integration_status(request: Request, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "integrations": 1})
    web = ((tenant or {}).get("integrations") or {}).get("website") or {}
    return {
        "enabled": bool(web.get("key_hash")),
        "keyHint": web.get("key_hint"),
        "createdAt": web.get("created_at"),
        "lastOrderAt": web.get("last_order_at"),
        "ingestUrl": _ingest_url(request),
        "header": KEY_HEADER,
    }


@router.post("/key")
async def generate_website_key(request: Request, user: dict = Depends(require_role("Manager"))):
    """Creates (or replaces) the store's ingest key. The plaintext key is only
    ever returned here — the website must be updated with it, and the old
    key stops working immediately."""
    db = get_db()
    key = f"{KEY_PREFIX}{secrets.token_urlsafe(32)}"
    res = await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"integrations.website": {
        "key_hash": _hash_key(key),
        "key_hint": key[-4:],
        "created_at": now_ist().isoformat(),
        "created_by": user.get("id"),
    }}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return {"key": key, "keyHint": key[-4:], "ingestUrl": _ingest_url(request), "header": KEY_HEADER}


@router.delete("/key")
async def revoke_website_key(user: dict = Depends(require_role("Manager"))):
    db = get_db()
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$unset": {"integrations.website": ""}})
    return {"ok": True}


# ===================================================================
# Ingest — called server-to-server by the store's website
# ===================================================================
class WebsiteCustomer(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: Optional[str] = Field(default=None, max_length=32)
    email: Optional[str] = Field(default=None, max_length=200)
    address: Optional[str] = Field(default=None, max_length=500)
    postcode: Optional[str] = Field(default=None, max_length=20)


class WebsiteOrderLine(BaseModel):
    item_id: Optional[str] = Field(default=None, max_length=100)
    sku: Optional[str] = Field(default=None, max_length=100)
    qty: int = Field(default=1, ge=1, le=999)
    size: Optional[str] = None
    variant: Optional[str] = Field(default=None, max_length=100)
    mods: List[str] = Field(default_factory=list, max_length=20)
    note: Optional[str] = Field(default=None, max_length=200)


class WebsiteOrderRequest(BaseModel):
    # Stripped before the length check, so "   " is a 422 rather than every
    # blank id collapsing onto one shared idempotency key.
    external_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    type: Literal["delivery", "collection"] = "collection"
    customer: WebsiteCustomer
    items: List[WebsiteOrderLine] = Field(min_length=1, max_length=200)
    paid: bool = False
    delivery_fee: float = Field(default=0, ge=0, le=100000)
    discount: float = Field(default=0, ge=0, le=1000000)
    note: Optional[str] = Field(default=None, max_length=500)


async def _tenant_from_key(request: Request, db) -> dict:
    key = request.headers.get(KEY_HEADER, "").strip()
    if not key.startswith(KEY_PREFIX):
        raise HTTPException(status_code=401, detail="Website key required")
    tenant = await db.tenants.find_one({"integrations.website.key_hash": _hash_key(key)}, {"_id": 0})
    if not tenant or tenant.get("status") == "suspended":
        raise HTTPException(status_code=401, detail="Invalid website key")
    return tenant


async def _to_cart_lines(db, tenant_id: str, lines: List[WebsiteOrderLine]) -> List[CartLine]:
    """Maps website lines onto CartLines (item ids), resolving `sku` against
    the menu item barcode. Unknown references are a 400 naming the line, so
    the website's integration log says exactly which product isn't mapped."""
    skus = list({ln.sku for ln in lines if not ln.item_id and ln.sku})
    by_sku = {}
    if skus:
        docs = await db.menu_items.find(
            {"tenant_id": tenant_id, "barcode": {"$in": skus}, **NOT_DELETED}, {"_id": 0, "id": 1, "barcode": 1},
        ).to_list(len(skus) * 2)
        by_sku = {d["barcode"]: d["id"] for d in docs}
    out = []
    for idx, ln in enumerate(lines):
        item_id = ln.item_id or by_sku.get(ln.sku or "")
        if not item_id:
            ref = f"sku {ln.sku!r}" if ln.sku else "no item_id or sku"
            raise HTTPException(status_code=400, detail=f"Line {idx + 1}: unknown product ({ref})")
        out.append(CartLine(
            item_id=item_id, qty=ln.qty, size=ln.size, variant=ln.variant,
            mods=[m.strip()[:100] for m in ln.mods if m and m.strip()], note=ln.note,
        ))
    return out


@router.post("/orders", name="ingest_website_order")
async def ingest_website_order(payload: WebsiteOrderRequest, request: Request):
    db = get_db()
    tenant = await _tenant_from_key(request, db)
    tenant_id = tenant["id"]
    external_ref = f"{EXTERNAL_REF_PREFIX}{payload.external_id}"

    existing = await db.orders.find_one({"tenant_id": tenant_id, "external_ref": external_ref}, PROJECTION)
    if existing:
        return {"orderId": existing["id"], "orderNumber": existing["number"], "total": existing["total"], "duplicate": True}

    business_type = tenant.get("business_type", "restaurant")
    cart = await _to_cart_lines(db, tenant_id, payload.items)
    raw_items = await _resolve_lines(db, tenant_id, cart, business_type)
    items = await annotate_order_items_for_kds(db, tenant_id, raw_items)
    number = await next_order_number(db, tenant_id)
    c = payload.customer
    customer = {
        "id": None, "name": c.name.strip(), "phone": (c.phone or "").strip() or None,
        "address": (c.address or "").strip() or None, "postcode": (c.postcode or "").strip() or None,
    }
    doc = _order_doc(tenant_id, number, payload.type, customer, None, items, source="website", business_type=business_type)
    delivery_fee = round(payload.delivery_fee, 2) if payload.type == "delivery" else 0
    discount = round(min(payload.discount, doc["total"] + delivery_fee), 2)
    doc.update({
        "deliveryFee": delivery_fee,
        "discount": discount,
        "total": round(doc["total"] + delivery_fee - discount, 2),
        # OrderPayment has no "online" value; a prepaid website order is a
        # card payment as far as the till, reports and refunds are concerned.
        "payment": "card" if payload.paid else "unpaid",
        "customer_email": (c.email or "").strip() or None,
        "external_ref": external_ref,
        "note": (payload.note or "").strip() or None,
    })
    try:
        await db.orders.insert_one(doc)
    except DuplicateKeyError:
        # A concurrent retry of the same webhook won the race — return its order.
        existing = await db.orders.find_one({"tenant_id": tenant_id, "external_ref": external_ref}, PROJECTION)
        if not existing:
            raise
        return {"orderId": existing["id"], "orderNumber": existing["number"], "total": existing["total"], "duplicate": True}
    await _apply_recipes(db, tenant_id, raw_items)
    await db.tenants.update_one({"id": tenant_id}, {"$set": {"integrations.website.last_order_at": doc["placedAt"]}})

    cleaned = clean(doc)
    schedule_broadcast("order.upserted", cleaned, tenant_id)
    schedule_broadcast("kds.ticket", {"orderId": doc["id"], "number": doc["number"]}, tenant_id)
    return {"orderId": doc["id"], "orderNumber": doc["number"], "total": doc["total"], "duplicate": False}
