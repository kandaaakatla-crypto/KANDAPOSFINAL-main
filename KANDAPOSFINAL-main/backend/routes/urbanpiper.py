"""UrbanPiper order intake — Swiggy, Zomato and the other aggregators
UrbanPiper connects to push their orders into the POS, so they land on the
order board and KDS like any counter order.

  - Manager/owner:  GET    /integrations/urbanpiper      → is it on? + webhook URL
                    POST   /integrations/urbanpiper/key  → (re)generate the webhook
                                                           key; plaintext shown ONCE
                    DELETE /integrations/urbanpiper/key  → turn intake off
  - UrbanPiper:     POST   /integrations/urbanpiper/orders  (X-Kanda-Key: upk_…)

The key is per store (tenant) and only its SHA-256 is stored, same as the
website ingest key (website_orders.py). It goes into the store's webhook
configuration on UrbanPiper as a custom header.

Unlike a website order, an aggregator order has already been accepted and
paid for on Swiggy/Zomato by the time it reaches us, at the aggregator's
prices. So lines are never rejected: each one is matched to the POS menu by
`merchant_id` (the POS menu item id UrbanPiper's catalogue was synced with)
so KDS routing, GST rates and recipe stock deduction work, but the price is
the one the aggregator charged. A line that matches nothing still goes on
the order under the aggregator's title, with a sync warning, rather than
losing the order. UrbanPiper's own total is kept as `aggregatorTotal` for
settlement reconciliation.

The order id UrbanPiper sends makes the call idempotent: a retried webhook
returns the order it already created.
"""
import hashlib
import os
import secrets
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from pymongo.errors import DuplicateKeyError

from auth import require_role
from db import get_db
from kds import annotate_order_items_for_kds
from routes.orders import _apply_recipes, _stamp_item_tax
from routes.storefront import _order_doc
from tz import now_ist
from ws import schedule_broadcast
from ._shared import NOT_DELETED, PROJECTION, clean, next_order_number

router = APIRouter(prefix="/integrations/urbanpiper")

KEY_PREFIX = "upk_"
KEY_HEADER = "X-Kanda-Key"
EXTERNAL_REF_PREFIX = "urbanpiper:"
# Channels with their own OrderSource value; every other UrbanPiper channel
# (ONDC, Magicpin, …) is recorded as "other" with the channel in `aggregator`.
KNOWN_SOURCES = {"swiggy", "zomato"}
# A gap bigger than this between our total and UrbanPiper's is flagged.
TOTAL_TOLERANCE = 1.0


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def _webhook_url(request: Request) -> str:
    base = (os.environ.get("PUBLIC_BASE_URL") or "").rstrip("/")
    if base:
        return f"{base}/api/integrations/urbanpiper/orders"
    return str(request.url_for("ingest_urbanpiper_order"))


# ===================================================================
# Key management — store manager/owner, from the dashboard
# ===================================================================
@router.get("")
async def urbanpiper_status(request: Request, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "integrations": 1})
    up = ((tenant or {}).get("integrations") or {}).get("urbanpiper") or {}
    return {
        "enabled": bool(up.get("key_hash")),
        "keyHint": up.get("key_hint"),
        "createdAt": up.get("created_at"),
        "lastOrderAt": up.get("last_order_at"),
        "webhookUrl": _webhook_url(request),
        "header": KEY_HEADER,
    }


@router.post("/key")
async def generate_urbanpiper_key(request: Request, user: dict = Depends(require_role("Manager"))):
    """Creates (or replaces) the store's webhook key. The plaintext key is
    only ever returned here; the old key stops working immediately."""
    db = get_db()
    key = f"{KEY_PREFIX}{secrets.token_urlsafe(32)}"
    res = await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {
        "integrations.urbanpiper.key_hash": _hash_key(key),
        "integrations.urbanpiper.key_hint": key[-4:],
        "integrations.urbanpiper.created_at": now_ist().isoformat(),
        "integrations.urbanpiper.created_by": user.get("id"),
    }})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return {"key": key, "keyHint": key[-4:], "webhookUrl": _webhook_url(request), "header": KEY_HEADER}


@router.delete("/key")
async def revoke_urbanpiper_key(user: dict = Depends(require_role("Manager"))):
    db = get_db()
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$unset": {"integrations.urbanpiper": ""}})
    return {"ok": True}


# ===================================================================
# Order relay webhook — called by UrbanPiper
# Only the fields we use are modelled; everything else UrbanPiper sends
# is ignored, so additions on their side never break intake.
# ===================================================================
class _Lenient(BaseModel):
    model_config = ConfigDict(extra="ignore")


class UPOption(_Lenient):
    merchant_id: Optional[str] = None
    title: str = ""
    price: float = 0


class UPItem(_Lenient):
    merchant_id: Optional[str] = None
    title: str = Field(default="", max_length=200)
    quantity: int = Field(default=1, ge=1, le=999)
    price: float = Field(default=0, ge=0)
    options_to_add: List[UPOption] = Field(default_factory=list)
    instructions: Optional[str] = None


class UPCharge(_Lenient):
    title: str = ""
    value: float = 0


class UPDetails(_Lenient):
    id: int | str
    channel: str = "other"
    order_type: str = "delivery"
    order_total: Optional[float] = None
    discount: float = 0
    charges: List[UPCharge] = Field(default_factory=list)
    instructions: Optional[str] = None


class UPStore(_Lenient):
    merchant_ref_id: Optional[str] = None
    id: Optional[int | str] = None


class UPOrder(_Lenient):
    details: UPDetails
    items: List[UPItem] = Field(min_length=1, max_length=200)
    store: Optional[UPStore] = None


class UPAddress(_Lenient):
    line_1: Optional[str] = None
    line_2: Optional[str] = None
    sub_locality: Optional[str] = None
    city: Optional[str] = None
    pin: Optional[str] = None


class UPCustomer(_Lenient):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[UPAddress] = None


class UPOrderRelay(_Lenient):
    order: UPOrder
    customer: Optional[UPCustomer] = None


async def _tenant_from_key(request: Request, db) -> dict:
    key = request.headers.get(KEY_HEADER, "").strip()
    if not key.startswith(KEY_PREFIX):
        raise HTTPException(status_code=401, detail="UrbanPiper key required")
    tenant = await db.tenants.find_one({"integrations.urbanpiper.key_hash": _hash_key(key)}, {"_id": 0})
    if not tenant or tenant.get("status") == "suspended":
        raise HTTPException(status_code=401, detail="Invalid UrbanPiper key")
    return tenant


async def _to_order_items(db, tenant_id: str, lines: List[UPItem]) -> tuple[list[dict], list[str]]:
    """POS order lines at the aggregator's prices. A line whose merchant_id
    is a live POS menu item takes the POS name (KDS, GST and recipes all key
    off the name); anything else keeps the aggregator's title, flagged."""
    ids = list({ln.merchant_id for ln in lines if ln.merchant_id})
    by_id = {}
    if ids:
        docs = await db.menu_items.find(
            {"tenant_id": tenant_id, "id": {"$in": ids}, **NOT_DELETED}, {"_id": 0, "id": 1, "name": 1},
        ).to_list(len(ids))
        by_id = {d["id"]: d for d in docs}
    items, warnings = [], []
    for ln in lines:
        menu_item = by_id.get(ln.merchant_id or "")
        name = menu_item["name"] if menu_item else (ln.title.strip() or "Aggregator item")
        if not menu_item:
            warnings.append(f"unmapped_aggregator_item: {name} ({ln.merchant_id or 'no merchant_id'})")
        mods = [o.title.strip()[:100] for o in ln.options_to_add if o.title and o.title.strip()]
        if ln.instructions and ln.instructions.strip():
            mods.append(f"Note: {ln.instructions.strip()[:100]}")
        unit = round(ln.price + sum(max(0.0, o.price) for o in ln.options_to_add), 2)
        items.append({"name": name, "qty": ln.quantity, "price": unit, "mods": mods[:20], "size": None})
    return items, warnings


def _customer(c: Optional[UPCustomer]) -> tuple[dict, Optional[str]]:
    c = c or UPCustomer()
    addr = c.address
    address = None
    if addr:
        parts = [addr.line_1, addr.line_2, addr.sub_locality, addr.city]
        address = ", ".join(p.strip() for p in parts if p and p.strip())[:500] or None
    return {
        "id": None,
        "name": (c.name or "").strip()[:120] or "Aggregator customer",
        "phone": (c.phone or "").strip()[:32] or None,
        "address": address,
        "postcode": ((addr.pin if addr else None) or "").strip()[:20] or None,
    }, ((c.email or "").strip()[:200] or None)


@router.post("/orders", name="ingest_urbanpiper_order")
async def ingest_urbanpiper_order(payload: UPOrderRelay, request: Request):
    db = get_db()
    tenant = await _tenant_from_key(request, db)
    tenant_id = tenant["id"]
    d = payload.order.details
    external_ref = f"{EXTERNAL_REF_PREFIX}{d.id}"

    existing = await db.orders.find_one({"tenant_id": tenant_id, "external_ref": external_ref}, PROJECTION)
    if existing:
        return {"orderId": existing["id"], "orderNumber": existing["number"], "duplicate": True}

    business_type = tenant.get("business_type", "restaurant")
    raw_items, warnings = await _to_order_items(db, tenant_id, payload.order.items)
    # Re-stamp GST from the POS rate for the (possibly re-priced) line;
    # _order_doc's own tax maths then runs on the stamped rates.
    # Its own warnings only repeat the unmapped-item ones above.
    await _stamp_item_tax(db, tenant_id, business_type, raw_items)
    items = await annotate_order_items_for_kds(db, tenant_id, raw_items)
    number = await next_order_number(db, tenant_id)
    customer, email = _customer(payload.customer)
    channel = (d.channel or "other").strip().lower()
    source = channel if channel in KNOWN_SOURCES else "other"
    order_type = "collection" if d.order_type.strip().lower() in ("pickup", "takeaway", "collection") else "delivery"

    doc = _order_doc(tenant_id, number, order_type, customer, None, items, source=source, business_type=business_type)
    charges = round(sum(max(0.0, c.value) for c in d.charges), 2)
    discount = round(min(max(0.0, d.discount), doc["total"] + charges), 2)
    total = round(doc["total"] + charges - discount, 2)
    if d.order_total is not None and abs(total - d.order_total) > TOTAL_TOLERANCE:
        warnings.append(f"aggregator_total_mismatch: pos {total} vs {channel} {d.order_total}")
    store = payload.order.store
    doc.update({
        "deliveryFee": charges,
        "discount": discount,
        "total": total,
        # Settled by the aggregator, never through the till; OrderPayment
        # has no "online" value, so like a prepaid website order it's "card".
        "payment": "card",
        "customer_email": email,
        "external_ref": external_ref,
        "aggregator": channel,
        "aggregatorOrderId": str(d.id),
        "aggregatorTotal": d.order_total,
        "aggregatorStoreRef": (store.merchant_ref_id if store else None),
        "note": (d.instructions or "").strip()[:500] or None,
        "sync_warnings": list(dict.fromkeys(warnings)),
    })
    try:
        await db.orders.insert_one(doc)
    except DuplicateKeyError:
        existing = await db.orders.find_one({"tenant_id": tenant_id, "external_ref": external_ref}, PROJECTION)
        if not existing:
            raise
        return {"orderId": existing["id"], "orderNumber": existing["number"], "duplicate": True}
    await _apply_recipes(db, tenant_id, raw_items)
    await db.tenants.update_one({"id": tenant_id}, {"$set": {"integrations.urbanpiper.last_order_at": doc["placedAt"]}})

    cleaned = clean(doc)
    schedule_broadcast("order.upserted", cleaned, tenant_id)
    schedule_broadcast("kds.ticket", {"orderId": doc["id"], "number": doc["number"]}, tenant_id)
    return {"orderId": doc["id"], "orderNumber": doc["number"], "duplicate": False}
