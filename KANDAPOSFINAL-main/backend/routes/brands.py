"""Brand — franchise / multi-store grouping, managed entirely from the tenant
Dashboard's Owner role (not the Platform Owner's Owner Portal). A Brand groups
several tenants ("stores") under one franchise identity; the owner who creates
a brand gets a `brand_id` on their own dashboard login and can switch between
every member store (see /dash/brand/switch in dash_auth.py), push shared menu
templates and defaults out to the group, see rollup sales/royalty reporting,
and run brand-wide SMS campaigns.

Every endpoint here re-checks that the caller is an owner AND that the target
brand_id matches their own — the same pair of checks the store switcher uses
— since this is the one place a dashboard token can act across tenants.
"""
import hashlib
import hmac
import io
import logging
import os
import uuid
from datetime import timedelta
from tz import now_ist
from typing import List, Optional

import razorpay
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from db import get_db
from routes.dash_auth import get_dash_user, provision_tenant_dashboard
from routes.sms import _log_and_send
from routes._shared import clean
from auth import hash_pin
from models import (
    Brand, BrandCreate, BrandUpdate, BrandAsset, BrandAssetCreate,
    BrandStoreCreate, BrandSmsBroadcast, default_features,
    BrandInvite, BrandInviteCreate,
    RoyaltyInvoice, RoyaltyInvoiceGenerate, RoyaltyInvoiceStatusUpdate,
)

logger = logging.getLogger("kanda.brands")
router = APIRouter(prefix="/brand")

# One-time price per additional store beyond the brand's first (free) one —
# mirrors the pay-per-location model in routes/plans.py, scoped to the brand
# instead of a single tenant since each brand store is its own tenant.
BRAND_STORE_PRICE_INR = 1999.0
CURRENCY = "INR"


async def _brand_owner(brand_id: str, u: dict = Depends(get_dash_user)) -> dict:
    """Every brand-scoped route depends on this instead of get_dash_user
    directly — it's the single choke point that authorizes cross-tenant
    access, so both conditions must hold: owner role, and this exact brand."""
    if u.get("dash_role") != "owner" or u.get("brand_id") != brand_id:
        raise HTTPException(status_code=403, detail="Not the owner of this brand")
    return u


# ===================================================================
# Brand CRUD
# ===================================================================
@router.post("", response_model=Brand)
async def create_brand(payload: BrandCreate, u: dict = Depends(get_dash_user)):
    """Turn the caller's current store into the first store of a new brand.
    Only a plain single-store owner (no brand yet) can do this."""
    if u.get("dash_role") != "owner":
        raise HTTPException(status_code=403, detail="Only a store owner can create a brand")
    if u.get("brand_id"):
        raise HTTPException(status_code=400, detail="You already manage a brand")
    db = get_db()
    slug = payload.slug.lower().strip()
    if not slug.isalnum():
        raise HTTPException(status_code=400, detail="Slug must be lowercase alphanumeric")
    if await db.brands.find_one({"slug": slug}):
        raise HTTPException(status_code=400, detail="Brand slug already taken")

    brand_id = f"brand_{uuid.uuid4().hex[:10]}"
    doc = {
        "id": brand_id,
        "slug": slug,
        "name": payload.name,
        "logo_url": payload.logo_url,
        "royalty_percent": payload.royalty_percent,
        "defaults": {},
        "created_at": now_ist().isoformat(),
    }
    await db.brands.insert_one(doc)
    await db.tenants.update_one({"id": u["tenant_id"]}, {"$set": {"brand_id": brand_id}})
    await db.dashboard_users.update_one({"id": u["id"]}, {"$set": {"brand_id": brand_id}})
    return clean(doc)


@router.get("/{brand_id}", response_model=Brand)
async def get_brand(brand_id: str, u: dict = Depends(_brand_owner)):
    db = get_db()
    doc = await db.brands.find_one({"id": brand_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Brand not found")
    return doc


@router.patch("/{brand_id}", response_model=Brand)
async def update_brand(brand_id: str, payload: BrandUpdate, u: dict = Depends(_brand_owner)):
    db = get_db()
    update = payload.model_dump(exclude_none=True)
    if "defaults" in update:
        update["defaults"] = payload.defaults.model_dump(exclude_none=True)
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    res = await db.brands.find_one_and_update({"id": brand_id}, {"$set": update}, return_document=True)
    if not res:
        raise HTTPException(status_code=404, detail="Brand not found")
    return clean(res)


@router.get("/{brand_id}/stores")
async def list_stores(brand_id: str, u: dict = Depends(_brand_owner)):
    db = get_db()
    stores = await db.tenants.find(
        {"brand_id": brand_id}, {"_id": 0, "id": 1, "slug": 1, "name": 1, "business_type": 1, "royalty_percent": 1},
    ).sort("name", 1).to_list(200)
    return stores


class StoreRoyaltyUpdate(BaseModel):
    royalty_percent: Optional[float] = None  # null = clear override, inherit the brand default


@router.patch("/{brand_id}/stores/{tenant_id}/royalty")
async def update_store_royalty(brand_id: str, tenant_id: str, payload: StoreRoyaltyUpdate, u: dict = Depends(_brand_owner)):
    db = get_db()
    res = await db.tenants.update_one(
        {"id": tenant_id, "brand_id": brand_id}, {"$set": {"royalty_percent": payload.royalty_percent}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Store not found in this brand")
    return {"tenant_id": tenant_id, "royalty_percent": payload.royalty_percent}


# ===================================================================
# Existing-store invites — a brand owner invites an already-running,
# independently-owned store by slug; only THAT store's own owner can accept,
# from their own dashboard. Accepting only sets tenant.brand_id (so the
# brand owner's switcher/rollup/royalties now include it) — it does NOT
# grant the joining owner reciprocal access to sibling stores.
# ===================================================================
@router.post("/{brand_id}/invites", response_model=BrandInvite)
async def send_invite(brand_id: str, payload: BrandInviteCreate, u: dict = Depends(_brand_owner)):
    db = get_db()
    brand = await db.brands.find_one({"id": brand_id}, {"_id": 0, "name": 1})
    slug = payload.tenant_slug.lower().strip()
    target = await db.tenants.find_one({"slug": slug}, {"_id": 0, "id": 1, "slug": 1, "name": 1, "brand_id": 1})
    if not target:
        raise HTTPException(status_code=404, detail="No store with that slug")
    if target.get("brand_id"):
        raise HTTPException(status_code=400, detail="That store already belongs to a brand")
    existing = await db.brand_invites.find_one(
        {"brand_id": brand_id, "tenant_id": target["id"], "status": "pending"}, {"_id": 0},
    )
    if existing:
        raise HTTPException(status_code=400, detail="An invite to that store is already pending")
    doc = {
        "id": f"binv_{uuid.uuid4().hex[:10]}",
        "brand_id": brand_id,
        "brand_name": (brand or {}).get("name", ""),
        "tenant_id": target["id"],
        "tenant_slug": target["slug"],
        "tenant_name": target["name"],
        "status": "pending",
        "invited_by": u.get("name") or u["id"],
        "created_at": now_ist().isoformat(),
        "responded_at": None,
    }
    await db.brand_invites.insert_one(doc)
    return clean(doc)


@router.get("/{brand_id}/invites", response_model=List[BrandInvite])
async def list_sent_invites(brand_id: str, u: dict = Depends(_brand_owner)):
    db = get_db()
    return await db.brand_invites.find({"brand_id": brand_id}, {"_id": 0}).sort("created_at", -1).to_list(200)


@router.delete("/{brand_id}/invites/{invite_id}")
async def cancel_invite(brand_id: str, invite_id: str, u: dict = Depends(_brand_owner)):
    db = get_db()
    res = await db.brand_invites.update_one(
        {"id": invite_id, "brand_id": brand_id, "status": "pending"},
        {"$set": {"status": "cancelled", "responded_at": now_ist().isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Pending invite not found")
    return {"ok": True}


# ===================================================================
# Pay-per-store billing — the first store in a brand is free (it's the
# owner's existing store from before they created the brand); every
# additional store costs a one-time fee, paid via Razorpay before it's
# created. Mirrors routes/plans.py's location-slot model exactly, just
# scoped to `brand.paid_store_slots` instead of `tenant.paid_slots`.
# ===================================================================
async def _brand_slots(db, brand_id: str) -> dict:
    doc = await db.brands.find_one({"id": brand_id}, {"_id": 0, "paid_store_slots": 1})
    paid = int((doc or {}).get("paid_store_slots", 0))
    total_slots = 1 + paid
    used = await db.tenants.count_documents({"brand_id": brand_id})
    return {
        "free_slots": 1, "paid_slots": paid, "total_slots": total_slots,
        "used": used, "remaining": max(0, total_slots - used),
        "price_per_store": BRAND_STORE_PRICE_INR, "currency": CURRENCY,
    }


@router.get("/{brand_id}/billing")
async def brand_billing(brand_id: str, u: dict = Depends(_brand_owner)):
    db = get_db()
    return await _brand_slots(db, brand_id)


def _razorpay_client() -> razorpay.Client:
    kid = os.environ.get("RAZORPAY_KEY_ID", "").strip()
    sec = os.environ.get("RAZORPAY_KEY_SECRET", "").strip()
    if not kid or not sec:
        raise HTTPException(status_code=500, detail="Razorpay not configured on server")
    return razorpay.Client(auth=(kid, sec))


@router.post("/{brand_id}/payments/purchase-store-slot")
async def purchase_store_slot(brand_id: str, u: dict = Depends(_brand_owner)):
    client = _razorpay_client()
    amount_paise = int(BRAND_STORE_PRICE_INR * 100)
    receipt = f"kanda_bstore_{uuid.uuid4().hex[:12]}"
    try:
        order = client.order.create({
            "amount": amount_paise, "currency": CURRENCY, "receipt": receipt, "payment_capture": 1,
            "notes": {"purpose": "brand_store_slot", "brand_id": brand_id, "user_id": u.get("id") or ""},
        })
    except Exception as exc:  # noqa: BLE001
        logger.exception("Razorpay order.create failed")
        raise HTTPException(status_code=502, detail=f"Razorpay error: {exc}")

    db = get_db()
    await db.payment_transactions.insert_one({
        "provider": "razorpay", "purpose": "brand_store_slot",
        "order_id": order["id"], "receipt": receipt, "brand_id": brand_id,
        "amount": BRAND_STORE_PRICE_INR, "amount_paise": amount_paise, "currency": CURRENCY,
        "user_id": u.get("id"), "user_name": u.get("name"),
        "status": "initiated", "payment_status": "pending",
        "created_at": now_ist().isoformat(), "updated_at": now_ist().isoformat(),
    })
    return {
        "order_id": order["id"], "amount": amount_paise, "currency": CURRENCY,
        "key_id": os.environ["RAZORPAY_KEY_ID"], "description": "One additional brand store slot",
        "price": BRAND_STORE_PRICE_INR,
    }


class BrandPaymentVerify(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


@router.post("/{brand_id}/payments/verify")
async def verify_store_slot_payment(brand_id: str, payload: BrandPaymentVerify, u: dict = Depends(_brand_owner)):
    key_secret = os.environ["RAZORPAY_KEY_SECRET"].encode()
    body = f"{payload.razorpay_order_id}|{payload.razorpay_payment_id}".encode()
    expected = hmac.new(key_secret, body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, payload.razorpay_signature):
        raise HTTPException(status_code=400, detail="Signature verification failed")

    db = get_db()
    record = await db.payment_transactions.find_one({"order_id": payload.razorpay_order_id}, {"_id": 0})
    if not record:
        raise HTTPException(status_code=404, detail="Order not found")
    if record.get("brand_id") != brand_id:
        raise HTTPException(status_code=403, detail="Wrong brand for this order")

    if record.get("payment_status") != "paid":
        r = await db.payment_transactions.update_one(
            {"order_id": payload.razorpay_order_id, "payment_status": {"$ne": "paid"}},
            {"$set": {"status": "completed", "payment_status": "paid",
                      "razorpay_payment_id": payload.razorpay_payment_id, "updated_at": now_ist().isoformat()}},
        )
        if r.modified_count:
            await db.brands.update_one({"id": brand_id}, {"$inc": {"paid_store_slots": 1}})
    slots = await _brand_slots(db, brand_id)
    return {"ok": True, "payment_status": "paid", "slots": slots}


# ===================================================================
# Rollup reporting
# ===================================================================
@router.get("/{brand_id}/rollup")
async def rollup(
    brand_id: str,
    start: Optional[str] = Query(None, description="ISO start (inclusive)"),
    end: Optional[str] = Query(None, description="ISO end (exclusive)"),
    u: dict = Depends(_brand_owner),
):
    db = get_db()
    start_iso = start or (now_ist() - timedelta(days=30)).isoformat()
    end_iso = end or now_ist().isoformat()
    stores = await db.tenants.find({"brand_id": brand_id}, {"_id": 0, "id": 1, "name": 1, "slug": 1}).to_list(200)

    rows = []
    grand_orders = 0
    grand_sales = 0.0
    for t in stores:
        orders = await db.orders.find(
            {"tenant_id": t["id"], "voided": {"$ne": True}, "placedAt": {"$gte": start_iso, "$lt": end_iso}},
            {"_id": 0, "total": 1},
        ).to_list(20000)
        sales = round(sum(o.get("total", 0) or 0 for o in orders), 2)
        rows.append({"tenant_id": t["id"], "store_name": t["name"], "slug": t["slug"], "orders": len(orders), "sales": sales})
        grand_orders += len(orders)
        grand_sales += sales
    rows.sort(key=lambda r: -r["sales"])
    return {"stores": rows, "totals": {"orders": grand_orders, "sales": round(grand_sales, 2), "store_count": len(stores)}}


async def _compute_royalties(db, brand_id: str, start_iso: str, end_iso: str) -> list[dict]:
    brand = await db.brands.find_one({"id": brand_id}, {"_id": 0})
    stores = await db.tenants.find(
        {"brand_id": brand_id}, {"_id": 0, "id": 1, "name": 1, "royalty_percent": 1},
    ).to_list(200)
    rows = []
    for t in stores:
        orders = await db.orders.find(
            {"tenant_id": t["id"], "voided": {"$ne": True}, "placedAt": {"$gte": start_iso, "$lt": end_iso}},
            {"_id": 0, "total": 1},
        ).to_list(20000)
        sales = round(sum(o.get("total", 0) or 0 for o in orders), 2)
        rate = t.get("royalty_percent")
        if rate is None:
            rate = brand.get("royalty_percent", 0) if brand else 0
        owed = round(sales * rate / 100, 2)
        rows.append({"tenant_id": t["id"], "store_name": t["name"], "sales": sales, "royalty_percent": rate, "owed": owed})
    return rows


@router.get("/{brand_id}/royalties")
async def royalties(
    brand_id: str,
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    u: dict = Depends(_brand_owner),
):
    db = get_db()
    start_iso = start or (now_ist() - timedelta(days=30)).isoformat()
    end_iso = end or now_ist().isoformat()
    rows = await _compute_royalties(db, brand_id, start_iso, end_iso)
    total_owed = round(sum(r["owed"] for r in rows), 2)
    return {"rows": rows, "total_owed": total_owed}


@router.post("/{brand_id}/royalties/invoices/generate", response_model=List[RoyaltyInvoice])
async def generate_royalty_invoices(brand_id: str, payload: RoyaltyInvoiceGenerate, u: dict = Depends(_brand_owner)):
    db = get_db()
    rows = await _compute_royalties(db, brand_id, payload.start, payload.end)
    docs = []
    for r in rows:
        if r["owed"] <= 0:
            continue
        doc = {
            "id": f"rinv_{uuid.uuid4().hex[:10]}",
            "brand_id": brand_id,
            "tenant_id": r["tenant_id"],
            "store_name": r["store_name"],
            "period_start": payload.start,
            "period_end": payload.end,
            "sales": r["sales"],
            "royalty_percent": r["royalty_percent"],
            "amount": r["owed"],
            "status": "pending",
            "created_at": now_ist().isoformat(),
            "paid_at": None,
        }
        docs.append(doc)
    if docs:
        await db.royalty_invoices.insert_many(docs)
    return [clean(dict(d)) for d in docs]


@router.get("/{brand_id}/royalties/invoices", response_model=List[RoyaltyInvoice])
async def list_royalty_invoices(brand_id: str, u: dict = Depends(_brand_owner)):
    db = get_db()
    return await db.royalty_invoices.find({"brand_id": brand_id}, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.patch("/{brand_id}/royalties/invoices/{invoice_id}", response_model=RoyaltyInvoice)
async def update_royalty_invoice_status(
    brand_id: str, invoice_id: str, payload: RoyaltyInvoiceStatusUpdate, u: dict = Depends(_brand_owner),
):
    db = get_db()
    update = {"status": payload.status}
    update["paid_at"] = now_ist().isoformat() if payload.status == "paid" else None
    res = await db.royalty_invoices.find_one_and_update(
        {"id": invoice_id, "brand_id": brand_id}, {"$set": update}, return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return clean(res)


def _render_royalty_invoice_pdf(invoice: dict, brand_name: str) -> bytes:
    """One-page portrait invoice a franchisee store owner can pay against —
    same visual style as the customer tax invoice (receipts.py) and rota PDF
    (routes/shifts.py) so downloadable documents look consistent app-wide."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.enums import TA_LEFT, TA_RIGHT

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=15 * mm, rightMargin=15 * mm,
        topMargin=15 * mm, bottomMargin=15 * mm,
        title=f"Royalty Invoice — {invoice['store_name']}",
    )
    styles = getSampleStyleSheet()
    sub_st = ParagraphStyle("sub", parent=styles["Normal"], fontSize=9, leading=13, textColor=colors.HexColor("#666666"))
    right_st = ParagraphStyle("right", parent=styles["Normal"], fontSize=10, leading=14, alignment=TA_RIGHT, textColor=colors.HexColor("#111111"))
    label_st = ParagraphStyle("label", parent=styles["Normal"], fontSize=9, leading=13, textColor=colors.HexColor("#666666"))

    header = Table([[
        Paragraph(f"<b>{brand_name}</b><br/>Royalty invoice for {invoice['store_name']}", sub_st),
        Paragraph(f"<b>ROYALTY INVOICE</b><br/>Invoice No: {invoice['id'].upper()}<br/>Issued: {invoice.get('created_at', '')[:10]}", right_st),
    ]], colWidths=[100 * mm, 75 * mm])
    header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story = [header, Spacer(1, 8 * mm)]

    rows = [
        ["Store", invoice["store_name"]],
        ["Period", f"{invoice['period_start']} → {invoice['period_end']}"],
        ["Sales in period", f"₹{invoice['sales']:.2f}"],
        ["Royalty rate", f"{invoice['royalty_percent']:g}%"],
        ["Status", invoice["status"].upper()],
    ]
    if invoice.get("paid_at"):
        rows.append(["Paid on", invoice["paid_at"][:10]])
    detail = Table(rows, colWidths=[45 * mm, 130 * mm])
    detail.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#666666")),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#e6e6e6")),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(detail)
    story.append(Spacer(1, 8 * mm))

    total = Table([["AMOUNT DUE", f"₹{invoice['amount']:.2f}"]], colWidths=[130 * mm, 45 * mm])
    total.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 14),
        ("LINEABOVE", (0, 0), (-1, 0), 1, colors.HexColor("#111111")),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(total)
    story.append(Spacer(1, 10 * mm))
    story.append(Paragraph("This is a computer-generated royalty invoice.", sub_st))

    doc.build(story)
    return buf.getvalue()


@router.get("/{brand_id}/royalties/invoices/{invoice_id}/pdf")
async def download_royalty_invoice_pdf(brand_id: str, invoice_id: str, u: dict = Depends(_brand_owner)):
    db = get_db()
    invoice = await db.royalty_invoices.find_one({"id": invoice_id, "brand_id": brand_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    brand = await db.brands.find_one({"id": brand_id}, {"_id": 0, "name": 1})
    pdf_bytes = _render_royalty_invoice_pdf(invoice, (brand or {}).get("name") or "Brand")
    filename = f"royalty_invoice_{invoice_id}.pdf"
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ===================================================================
# New franchisee store
# ===================================================================
@router.post("/{brand_id}/stores")
async def create_store(brand_id: str, payload: BrandStoreCreate, u: dict = Depends(_brand_owner)):
    db = get_db()
    slug = payload.slug.lower().strip()
    if not slug.isalnum():
        raise HTTPException(status_code=400, detail="Slug must be lowercase alphanumeric")
    if await db.tenants.find_one({"slug": slug}):
        raise HTTPException(status_code=400, detail="Store slug already taken")
    if not (payload.manager_pin.isdigit() and 4 <= len(payload.manager_pin) <= 6):
        raise HTTPException(status_code=400, detail="Manager PIN must be 4-6 digits")

    slots = await _brand_slots(db, brand_id)
    if slots["used"] >= slots["total_slots"]:
        raise HTTPException(
            status_code=402,
            detail={
                "message": f"Adding another store requires a one-time ₹{BRAND_STORE_PRICE_INR:.0f} payment.",
                "code": "payment_required",
                "price": BRAND_STORE_PRICE_INR,
                "currency": CURRENCY,
                "used": slots["used"],
                "total_slots": slots["total_slots"],
            },
        )

    brand = await db.brands.find_one({"id": brand_id}, {"_id": 0})
    tenant_id = slug
    now_iso = now_ist().isoformat()
    features = default_features(payload.business_type)
    if payload.apply_brand_defaults and brand:
        features.update((brand.get("defaults") or {}).get("features") or {})
    store = dict(payload.store)
    if payload.apply_brand_defaults and brand:
        b_defaults = brand.get("defaults") or {}
        if b_defaults.get("store_footer") is not None:
            store["footer"] = b_defaults["store_footer"]
        if b_defaults.get("logo_url") is not None:
            store["logo_url"] = b_defaults["logo_url"]

    tenant_doc = {
        "id": tenant_id,
        "slug": slug,
        "name": payload.name,
        "status": "active",
        "plan": "trial",
        "contact_email": payload.contact_email,
        "store": store,
        "created_at": now_iso,
        "business_type": payload.business_type,
        "features": features,
        "brand_id": brand_id,
        "royalty_percent": None,  # inherits the brand's rate until overridden
    }
    await db.tenants.insert_one(tenant_doc)

    initials = "".join([w[0] for w in payload.manager_name.split() if w])[:2].upper() or "MG"
    await db.users.insert_one({
        "id": f"s_{uuid.uuid4().hex[:8]}",
        "tenant_id": tenant_id,
        "name": payload.manager_name,
        "role": "Manager",
        "initials": initials,
        "pin_hash": hash_pin(payload.manager_pin),
        "created_at": now_iso,
    })
    await db.counters.update_one(
        {"_id": f"{tenant_id}:order_number"}, {"$setOnInsert": {"seq": 1000}}, upsert=True,
    )
    dashboard_accounts = await provision_tenant_dashboard(db, tenant_doc)
    return {**clean(tenant_doc), "dashboard_accounts": dashboard_accounts}


# ===================================================================
# Shared menu template — pushed from the owner's currently-active store
# ===================================================================
@router.post("/{brand_id}/menu-template/push")
async def push_menu_template(brand_id: str, u: dict = Depends(_brand_owner)):
    db = get_db()
    source_tenant_id = u["tenant_id"]
    src_cats = await db.categories.find({"tenant_id": source_tenant_id}, {"_id": 0}).to_list(200)
    src_items = await db.menu_items.find({"tenant_id": source_tenant_id}, {"_id": 0}).to_list(2000)
    targets = await db.tenants.find(
        {"brand_id": brand_id, "id": {"$ne": source_tenant_id}}, {"_id": 0, "id": 1, "name": 1},
    ).to_list(200)

    results = []
    for t in targets:
        tid = t["id"]
        existing_cats = await db.categories.find({"tenant_id": tid}, {"_id": 0, "id": 1, "name": 1}).to_list(200)
        existing_cats_by_name = {c["name"]: c["id"] for c in existing_cats}
        cat_id_map = {}
        added_cats = 0
        for c in src_cats:
            if c["name"] in existing_cats_by_name:
                cat_id_map[c["id"]] = existing_cats_by_name[c["name"]]
                continue
            new_id = f"cat_{uuid.uuid4().hex[:8]}"
            await db.categories.insert_one({**c, "id": new_id, "tenant_id": tid})
            cat_id_map[c["id"]] = new_id
            added_cats += 1

        existing_item_names = {
            m["name"] for m in await db.menu_items.find({"tenant_id": tid}, {"_id": 0, "name": 1}).to_list(2000)
        }
        added_items = 0
        for m in src_items:
            if m["name"] in existing_item_names:
                continue
            await db.menu_items.insert_one({
                **m, "id": f"m_{uuid.uuid4().hex[:8]}", "tenant_id": tid,
                "cat_id": cat_id_map.get(m["cat_id"], m["cat_id"]),
            })
            added_items += 1
        results.append({"tenant_id": tid, "store_name": t["name"], "categories_added": added_cats, "items_added": added_items})
    return {"source_tenant_id": source_tenant_id, "pushed_to": len(targets), "results": results}


# ===================================================================
# Brand-wide defaults (features, receipt footer, logo) — explicit push
# ===================================================================
@router.post("/{brand_id}/defaults/push")
async def push_defaults(brand_id: str, u: dict = Depends(_brand_owner)):
    db = get_db()
    brand = await db.brands.find_one({"id": brand_id}, {"_id": 0})
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")
    defaults = brand.get("defaults") or {}
    feature_overrides = defaults.get("features") or {}
    store_footer = defaults.get("store_footer")
    logo_url = defaults.get("logo_url")

    targets = await db.tenants.find({"brand_id": brand_id}, {"_id": 0, "id": 1, "features": 1, "store": 1}).to_list(200)
    count = 0
    for t in targets:
        update = {}
        if feature_overrides:
            update["features"] = {**(t.get("features") or {}), **feature_overrides}
        if store_footer is not None or logo_url is not None:
            store = dict(t.get("store") or {})
            if store_footer is not None:
                store["footer"] = store_footer
            if logo_url is not None:
                store["logo_url"] = logo_url
            update["store"] = store
        if update:
            await db.tenants.update_one({"id": t["id"]}, {"$set": update})
            count += 1
    return {"applied_to": count}


# ===================================================================
# Marketing — shared asset library
# ===================================================================
@router.get("/{brand_id}/assets", response_model=List[BrandAsset])
async def list_assets(brand_id: str, u: dict = Depends(_brand_owner)):
    db = get_db()
    return await db.brand_assets.find({"brand_id": brand_id}, {"_id": 0}).sort("created_at", -1).to_list(200)


@router.post("/{brand_id}/assets", response_model=BrandAsset)
async def create_asset(brand_id: str, payload: BrandAssetCreate, u: dict = Depends(_brand_owner)):
    db = get_db()
    doc = {
        "id": f"basset_{uuid.uuid4().hex[:10]}",
        "brand_id": brand_id,
        "kind": payload.kind,
        "title": payload.title,
        "content": payload.content,
        "created_at": now_ist().isoformat(),
        "created_by": u.get("name") or u["id"],
    }
    await db.brand_assets.insert_one(doc)
    return clean(doc)


@router.delete("/{brand_id}/assets/{asset_id}")
async def delete_asset(brand_id: str, asset_id: str, u: dict = Depends(_brand_owner)):
    db = get_db()
    res = await db.brand_assets.delete_one({"id": asset_id, "brand_id": brand_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"ok": True}


# ===================================================================
# Marketing — coordinated SMS campaign across every store's customers
# ===================================================================
@router.post("/{brand_id}/marketing/sms-broadcast")
async def brand_sms_broadcast(brand_id: str, payload: BrandSmsBroadcast, u: dict = Depends(_brand_owner)):
    if not payload.body.strip():
        raise HTTPException(status_code=400, detail="Message body required")
    db = get_db()
    stores = await db.tenants.find({"brand_id": brand_id}, {"_id": 0, "id": 1, "name": 1}).to_list(200)

    per_store = []
    total_sent = 0
    total_failed = 0
    for t in stores:
        customers = await db.customers.find(
            {"tenant_id": t["id"], "deleted": {"$ne": True}, "phone": {"$exists": True, "$ne": ""}},
            {"_id": 0, "id": 1, "phone": 1, "name": 1},
        ).limit(200).to_list(200)
        sent = 0
        failed = 0
        for c in customers:
            first = (c.get("name") or "").split(" ")[0]
            personalised = payload.body.replace("{name}", first)
            r = await _log_and_send(
                db, tenant_id=t["id"], sent_by=f"brand:{u.get('name') or u['id']}",
                to=c["phone"], body=personalised, customer_id=c["id"],
            )
            if r["ok"]:
                sent += 1
            else:
                failed += 1
        per_store.append({"tenant_id": t["id"], "store_name": t["name"], "recipients": len(customers), "sent": sent, "failed": failed})
        total_sent += sent
        total_failed += failed
    return {"stores": per_store, "total_sent": total_sent, "total_failed": total_failed}
