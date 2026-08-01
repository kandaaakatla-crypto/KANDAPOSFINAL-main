"""Loyalty / points engine on top of customers.

Earn/redeem rates, tier thresholds, and the new-customer welcome bonus are
all per-tenant and owner-customizable via LoyaltyConfig (GET/PUT
/loyalty/config) — see `_get_config`/`_save_config` below. Defaults mirror
the program's original hardcoded rates (1pt/₹100 earned, 1pt=₹1 redeemed).

Earn rule: `floor(net_total / earn_rate)` points per order — applied
automatically in orders.py when the customer (matched by phone) exists.

Redeem rule: cashier passes `redeem_loyalty_points` on the order; backend
subtracts from the customer's balance and discounts the order
`points * redeem_value` (capped at order subtotal). Negative balances are
refused.

Tier upgrades are recomputed every earn event from `loyalty_lifetime_spend`.

Silver/Gold members can also earn at a multiplier (silver_multiplier/
gold_multiplier in LoyaltyConfig, applied to their *current* tier — see
`_multiplier_for`), and a once-a-year birthday bonus can be configured
(birthday_bonus_points) — credited by `background_tasks.birthday_bonus_loop`.
Customers self-report their birthday (month+day only, no year) via a signed,
short-lived link — see the `/loyalty/birthday-*` endpoints below, which
mirror `routes/storefront.py`'s OTP-session JWT pattern (same `_secret()`/
`JWT_ALG`, distinguished by `iss`) rather than inventing new infra.

This module exposes the read/write surface for the UI:
  GET    /customers/{id}/loyalty       — balance + recent txns
  POST   /customers/{id}/loyalty/adjust — manager manual adjustment (with note)
  GET    /loyalty/lookup?phone=...      — quick balance by phone for checkout
  GET/PUT /loyalty/config               — owner-customizable program rules
  GET    /loyalty/overview              — Dashboard summary stats
  POST   /loyalty/birthday-request      — bulk-text customers missing a birthday
  GET/POST /loyalty/birthday-link/{token} — public, no-login self-report page
"""
import os
import uuid
from datetime import datetime, timedelta, timezone
from tz import now_ist
from typing import List, Optional

import jwt
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel

from db import get_db
from auth import get_current_user, require_role, _secret, JWT_ALG
from tenants import tenant_filter
from models import LoyaltyTxn, LoyaltyAdjust, LoyaltyConfig
from sms_service import send_sms

router = APIRouter()

BIRTHDAY_LINK_ISSUER = "birthday-link"
BIRTHDAY_LINK_TTL_DAYS = 30


def _now() -> str:
    return now_ist().isoformat()


async def _get_config(db, tenant_id: str) -> dict:
    doc = await db.loyalty_configs.find_one({"tenant_id": tenant_id}, {"_id": 0})
    if not doc:
        return LoyaltyConfig().model_dump()
    doc.pop("tenant_id", None)
    doc.pop("updated_at", None)
    # backfill defaults for old/partial rows
    d = LoyaltyConfig().model_dump()
    d.update({k: v for k, v in doc.items() if k in d})
    return d


async def _save_config(db, tenant_id: str, cfg: LoyaltyConfig) -> None:
    await db.loyalty_configs.update_one(
        {"tenant_id": tenant_id},
        {"$set": {**cfg.model_dump(), "tenant_id": tenant_id, "updated_at": _now()}},
        upsert=True,
    )


def _tier_for(lifetime_spend: float, cfg: dict) -> str:
    tier = "bronze"
    if lifetime_spend >= cfg["silver_threshold"]:
        tier = "silver"
    if lifetime_spend >= cfg["gold_threshold"]:
        tier = "gold"
    return tier


def _multiplier_for(tier: str, cfg: dict) -> float:
    """Earn-rate multiplier for the customer's *current* tier — applies to
    the purchase that's being earned on, not the tier it might bump them
    into (that upgrade takes effect on their next order)."""
    return {"silver": cfg["silver_multiplier"], "gold": cfg["gold_multiplier"]}.get(tier, 1.0)


async def credit_for_order(db, user_doc: dict, order_doc: dict) -> int:
    """Called from orders.create — auto-earn points for a paid order.
    Returns the number of points earned (0 if no matching customer)."""
    phone = (order_doc.get("customer") or {}).get("phone") or ""
    if not phone:
        return 0
    cust = await db.customers.find_one(
        {"tenant_id": user_doc["tenant_id"], "phone": phone,
         "$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}]},
        {"_id": 0},
    )
    if not cust:
        return 0
    cfg = await _get_config(db, user_doc["tenant_id"])
    # Earn on net subtotal — excludes tip + delivery to keep it honest.
    net = float(order_doc.get("total", 0)) - float(order_doc.get("tip", 0) or 0) - float(order_doc.get("deliveryFee", 0) or 0)
    base_points = int(net // cfg["earn_rate"])
    multiplier = _multiplier_for(cust.get("loyalty_tier") or "bronze", cfg)
    earned = max(0, int(base_points * multiplier))
    if earned == 0:
        return 0
    new_lifetime = float(cust.get("loyalty_lifetime_spend") or 0) + max(0.0, net)
    new_tier = _tier_for(new_lifetime, cfg)
    await db.customers.update_one(
        {"tenant_id": user_doc["tenant_id"], "id": cust["id"]},
        {"$inc": {"loyalty_points": earned},
         "$set": {"loyalty_lifetime_spend": new_lifetime, "loyalty_tier": new_tier}},
    )
    await db.loyalty_txns.insert_one({
        "id": f"lt_{uuid.uuid4().hex[:10]}",
        "tenant_id": user_doc["tenant_id"],
        "customer_id": cust["id"],
        "customer_name": cust["name"],
        "kind": "earn",
        "points": earned,
        "order_id": order_doc["id"],
        "note": None,
        "by_user_id": user_doc["id"],
        "by_user_name": user_doc["name"],
        "at": _now(),
    })
    return earned


async def burn_for_order(db, user_doc: dict, order_doc: dict, points: int) -> int:
    """Redeem `points` against an order. Returns the number actually burned
    (capped by balance and order *gross* item subtotal — not `total`, which
    is already discounted client-side). Raises on no-such-customer."""
    if points <= 0:
        return 0
    phone = (order_doc.get("customer") or {}).get("phone") or ""
    cust = await db.customers.find_one(
        {"tenant_id": user_doc["tenant_id"], "phone": phone,
         "$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}]},
        {"_id": 0},
    ) if phone else None
    if not cust:
        raise HTTPException(status_code=400, detail="Customer not found — loyalty points cannot be redeemed")
    cfg = await _get_config(db, user_doc["tenant_id"])
    balance = int(cust.get("loyalty_points") or 0)
    # Cap by the gross item subtotal — the client-side `total` may already
    # reflect the loyalty discount, so it would falsely cap us at zero and
    # let the customer walk out without their balance being debited.
    gross_items = sum(float(it.get("price", 0)) * float(it.get("qty", 0)) for it in order_doc.get("items", []))
    subtotal_cap = int(gross_items // cfg["redeem_value"])
    burned = min(points, balance, subtotal_cap)
    if burned <= 0:
        return 0
    await db.customers.update_one(
        {"tenant_id": user_doc["tenant_id"], "id": cust["id"]},
        {"$inc": {"loyalty_points": -burned}},
    )
    await db.loyalty_txns.insert_one({
        "id": f"lt_{uuid.uuid4().hex[:10]}",
        "tenant_id": user_doc["tenant_id"],
        "customer_id": cust["id"],
        "customer_name": cust["name"],
        "kind": "redeem",
        "points": -burned,
        "order_id": order_doc["id"],
        "note": f"Redeemed against order #{order_doc['number']}",
        "by_user_id": user_doc["id"],
        "by_user_name": user_doc["name"],
        "at": _now(),
    })
    return burned


@router.get("/customers/{customer_id}/loyalty")
async def get_loyalty(customer_id: str, user: dict = Depends(get_current_user)):
    db = get_db()
    cust = await db.customers.find_one(tenant_filter(user, {"id": customer_id}), {"_id": 0})
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    txns = await db.loyalty_txns.find(
        tenant_filter(user, {"customer_id": customer_id}), {"_id": 0},
    ).sort("at", -1).limit(50).to_list(50)
    return {
        "customer_id": cust["id"],
        "name": cust["name"],
        "phone": cust["phone"],
        "loyalty_points": int(cust.get("loyalty_points") or 0),
        "loyalty_tier": cust.get("loyalty_tier") or "bronze",
        "loyalty_lifetime_spend": float(cust.get("loyalty_lifetime_spend") or 0),
        "transactions": txns,
    }


@router.post("/customers/{customer_id}/loyalty/adjust")
async def adjust_loyalty(customer_id: str, payload: LoyaltyAdjust,
                         user: dict = Depends(require_role("Manager"))):
    if payload.points == 0:
        raise HTTPException(status_code=400, detail="Points adjustment cannot be zero")
    if not (payload.note or "").strip():
        raise HTTPException(status_code=400, detail="Reason note is required")
    db = get_db()
    cust = await db.customers.find_one(tenant_filter(user, {"id": customer_id}), {"_id": 0})
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    current = int(cust.get("loyalty_points") or 0)
    if current + payload.points < 0:
        raise HTTPException(status_code=400, detail="Adjustment would make balance negative")
    await db.customers.update_one(
        tenant_filter(user, {"id": customer_id}),
        {"$inc": {"loyalty_points": int(payload.points)}},
    )
    await db.loyalty_txns.insert_one({
        "id": f"lt_{uuid.uuid4().hex[:10]}",
        "tenant_id": user["tenant_id"],
        "customer_id": customer_id,
        "customer_name": cust["name"],
        "kind": "adjust",
        "points": int(payload.points),
        "note": payload.note.strip(),
        "by_user_id": user["id"],
        "by_user_name": user["name"],
        "at": _now(),
    })
    return {"ok": True, "balance": current + int(payload.points)}


@router.get("/loyalty/lookup")
async def lookup_by_phone(user: dict = Depends(get_current_user),
                          phone: str = Query(..., min_length=4)):
    """Cashier checkout: 'how many points does this phone have available?'"""
    db = get_db()
    cust = await db.customers.find_one(
        tenant_filter(user, {"phone": phone, "$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}]}), {"_id": 0},
    )
    if not cust:
        return {"found": False}
    return {
        "found": True,
        "id": cust["id"],
        "name": cust["name"],
        "loyalty_points": int(cust.get("loyalty_points") or 0),
        "loyalty_tier": cust.get("loyalty_tier") or "bronze",
    }


@router.get("/loyalty/txns", response_model=List[LoyaltyTxn])
async def list_txns(user: dict = Depends(require_role("Manager")),
                    limit: int = Query(100, ge=1, le=500)):
    db = get_db()
    docs = await db.loyalty_txns.find(tenant_filter(user), {"_id": 0}).sort("at", -1).limit(limit).to_list(limit)
    return docs


@router.get("/loyalty/config", response_model=LoyaltyConfig)
async def get_config(user: dict = Depends(get_current_user)):
    """Any staff can read — the POS checkout needs `redeem_value` to price
    a points redemption before the order is submitted."""
    db = get_db()
    return await _get_config(db, user["tenant_id"])


@router.put("/loyalty/config", response_model=LoyaltyConfig)
async def put_config(cfg: LoyaltyConfig, user: dict = Depends(require_role("Manager"))):
    """Owner/manager-only — same trust level as the tenant feature toggles."""
    if cfg.gold_threshold < cfg.silver_threshold:
        raise HTTPException(status_code=400, detail="Gold threshold must be at or above the Silver threshold")
    db = get_db()
    await _save_config(db, user["tenant_id"], cfg)
    return cfg


@router.get("/loyalty/overview")
async def loyalty_overview(user: dict = Depends(require_role("Manager"))):
    """Summary stats for the Dashboard's Loyalty screen: outstanding points
    liability, enrolled customers, tier mix, and 30-day earn/redeem totals."""
    db = get_db()
    cfg = await _get_config(db, user["tenant_id"])

    tier_agg = await db.customers.aggregate([
        {"$match": tenant_filter(user, {"$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}]})},
        {"$group": {
            "_id": "$loyalty_tier",
            "count": {"$sum": 1},
            "points": {"$sum": {"$ifNull": ["$loyalty_points", 0]}},
        }},
    ]).to_list(10)
    tiers = {"bronze": 0, "silver": 0, "gold": 0}
    outstanding_points = 0
    enrolled = 0
    for row in tier_agg:
        tier = row["_id"] or "bronze"
        tiers[tier] = tiers.get(tier, 0) + row["count"]
        outstanding_points += row["points"]
        enrolled += row["count"]

    since = (now_ist() - timedelta(days=30)).isoformat()
    txn_agg = await db.loyalty_txns.aggregate([
        {"$match": {**tenant_filter(user), "at": {"$gte": since}}},
        {"$group": {"_id": "$kind", "points": {"$sum": "$points"}}},
    ]).to_list(10)
    earned_30d = sum(r["points"] for r in txn_agg if r["_id"] in ("earn", "bonus") and r["points"] > 0)
    redeemed_30d = -sum(r["points"] for r in txn_agg if r["_id"] == "redeem")

    birthdays_missing = await db.customers.count_documents({
        **tenant_filter(user),
        "$and": [
            {"$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}]},
            {"$or": [{"birthday": {"$exists": False}}, {"birthday": None}, {"birthday": ""}]},
        ],
    })

    return {
        "config": cfg,
        "enrolled_customers": enrolled,
        "outstanding_points": outstanding_points,
        "outstanding_value": round(outstanding_points * cfg["redeem_value"], 2),
        "tiers": tiers,
        "earned_last_30d": earned_30d,
        "redeemed_last_30d": redeemed_30d,
        "birthdays_missing": birthdays_missing,
    }


# ===================================================================
# Birthday self-report link — public, no staff/customer login required.
# ===================================================================
def _validate_birthday_md(value: str) -> str:
    """Accepts "MM-DD"; validates against a dummy leap year (2000) so
    Feb 29 birthdays are accepted like any other date."""
    v = (value or "").strip()
    try:
        datetime.strptime(f"2000-{v}", "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Enter a valid date (month and day)")
    return v


def _mint_birthday_link(customer_id: str, tenant_id: str) -> str:
    return jwt.encode({
        "sub": customer_id, "tenant_id": tenant_id, "iss": BIRTHDAY_LINK_ISSUER,
        "exp": now_ist() + timedelta(days=BIRTHDAY_LINK_TTL_DAYS),
    }, _secret(), algorithm=JWT_ALG)


def _decode_birthday_link(token: str) -> dict:
    try:
        payload = jwt.decode(token, _secret(), algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="This link has expired — ask the restaurant to send a new one")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid link")
    if payload.get("iss") != BIRTHDAY_LINK_ISSUER:
        raise HTTPException(status_code=401, detail="Invalid link")
    return payload


class BirthdayRequestPayload(BaseModel):
    customer_ids: Optional[List[str]] = None  # default: everyone missing a birthday


class BirthdaySubmitPayload(BaseModel):
    birthday: str  # "MM-DD"


@router.post("/loyalty/birthday-request")
async def request_birthdays(payload: BirthdayRequestPayload, user: dict = Depends(require_role("Manager"))):
    """Bulk-text a self-report link to customers who haven't shared a
    birthday yet (or an explicit list). Capped at 200/send, same as the
    Customer SMS broadcast, to keep this a deliberate action not a spam risk."""
    db = get_db()
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "name": 1})
    tenant_name = (tenant or {}).get("name") or "us"
    base = os.environ.get("PUBLIC_BASE_URL") or ""

    if payload.customer_ids:
        query = {**tenant_filter(user), "id": {"$in": payload.customer_ids}}
    else:
        query = {
            **tenant_filter(user),
            "$and": [
                {"$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}]},
                {"$or": [{"birthday": {"$exists": False}}, {"birthday": None}, {"birthday": ""}]},
                {"phone": {"$exists": True, "$ne": ""}},
            ],
        }
    customers = await db.customers.find(query, {"_id": 0, "id": 1, "name": 1, "phone": 1}).limit(200).to_list(200)

    sent = 0
    failed = 0
    for cust in customers:
        if not cust.get("phone"):
            continue
        token = _mint_birthday_link(cust["id"], user["tenant_id"])
        link = f"{base}/loyalty/birthday/{token}"
        first = (cust.get("name") or "there").split(" ")[0]
        body = f"Hi {first}! Tell {tenant_name} your birthday and get a treat when it comes around: {link}"
        ok = await send_sms(cust["phone"], body)
        if ok:
            sent += 1
        else:
            failed += 1
    return {"requested": len(customers), "sent": sent, "failed": failed}


@router.get("/loyalty/birthday-link/{token}")
async def get_birthday_link(token: str):
    """Public — no auth. Lets the self-report page greet the customer by
    name and show whether they've already told us their birthday."""
    payload = _decode_birthday_link(token)
    db = get_db()
    cust = await db.customers.find_one(
        {"tenant_id": payload["tenant_id"], "id": payload["sub"]}, {"_id": 0, "name": 1, "birthday": 1},
    )
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    return {"name": cust["name"], "birthday": cust.get("birthday"), "already_set": bool(cust.get("birthday"))}


@router.post("/loyalty/birthday-link/{token}")
async def submit_birthday_link(token: str, payload: BirthdaySubmitPayload):
    """Public — no auth. The signed token is the only credential; anyone
    holding the link can (re-)submit that one customer's birthday."""
    claims = _decode_birthday_link(token)
    md = _validate_birthday_md(payload.birthday)
    db = get_db()
    res = await db.customers.update_one(
        {"tenant_id": claims["tenant_id"], "id": claims["sub"]}, {"$set": {"birthday": md}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Customer not found")
    return {"ok": True, "birthday": md}
