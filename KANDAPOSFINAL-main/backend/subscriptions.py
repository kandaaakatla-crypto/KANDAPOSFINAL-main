"""Razorpay subscriptions for Kanda POS tenant billing.

Each tenant carries:
  - plan            : one of `starter`, `pro`, `master` (or `none` for unsubscribed)
  - subscription_id : Razorpay subscription id (sub_xxx) once created
  - razorpay_plan_id: Razorpay plan id (plan_xxx) — derived on first use
  - subscription_status : `none`, `created`, `active`, `pending`, `halted`,
                          `cancelled`, `completed`, `expired`
  - current_period_end  : ISO 8601 — when the current paid cycle ends
  - grace_until         : ISO 8601 — soft warning until this date; hard block after

Subscription lifecycle (driven by Razorpay webhooks):
  - subscription.activated  → status=active, set current_period_end + grace_until=+7d
  - subscription.charged    → status=active, bump current_period_end + grace_until=+7d
  - subscription.halted     → status=halted (retry exhausted) — enter grace
  - subscription.cancelled  → status=cancelled
  - subscription.completed  → status=completed (all cycles paid)
  - subscription.pending    → status=pending (awaiting first authorisation)
"""
import os
import logging
import hmac
import hashlib
from datetime import datetime, timezone, timedelta
from tz import now_ist
from typing import Optional

import razorpay
from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel

from db import get_db
from owners import get_current_owner

logger = logging.getLogger("kanda.subscriptions")
subscriptions_router = APIRouter()

GRACE_DAYS = 7
PLAN_TOTAL_CYCLES = 24  # bill for 2 years before completing

# Plan catalogue (INR paise). Server-defined — not user-editable from UI.
PLANS: dict[str, dict] = {
    "starter": {"name": "Starter", "amount_inr": 999,  "amount_paise": 99900,  "currency": "INR"},
    "pro":     {"name": "Pro",     "amount_inr": 1999, "amount_paise": 199900, "currency": "INR"},
    "master":  {"name": "Master",  "amount_inr": 2999, "amount_paise": 299900, "currency": "INR"},
}

_client: Optional[razorpay.Client] = None


def _get_client() -> razorpay.Client:
    global _client
    if _client is None:
        kid = os.environ.get("RAZORPAY_KEY_ID")
        sec = os.environ.get("RAZORPAY_KEY_SECRET")
        if not kid or not sec:
            raise HTTPException(status_code=500, detail="Razorpay credentials not configured")
        _client = razorpay.Client(auth=(kid, sec))
    return _client


def _utc_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def grace_state(tenant: dict) -> dict:
    """Compute the subscription gate for a tenant. Returns dict with:
        ok (bool), in_grace (bool), reason (str|None),
        plan (str), status (str), grace_until (str|None), current_period_end (str|None).
    The /api/auth/login endpoint uses this to decide hard block, while
    /api/auth/me uses it to surface the soft banner.
    """
    plan = tenant.get("plan", "none")
    status = tenant.get("subscription_status", "none")
    grace_until = tenant.get("grace_until")
    cpe = tenant.get("current_period_end")
    now = now_ist()

    # Tenants without a plan yet: read-only access until they subscribe.
    if plan == "none" or status in ("none",):
        return {
            "ok": True, "in_grace": True, "reason": "no_plan",
            "plan": plan, "status": status, "grace_until": grace_until, "current_period_end": cpe,
        }

    if status in ("active",):
        # Even on active, surface a soft warning if the renewal is < 3 days away.
        soft = False
        if cpe:
            try:
                ts = datetime.fromisoformat(cpe.replace("Z", "+00:00"))
                if (ts - now).total_seconds() < 3 * 86400:
                    soft = True
            except Exception:
                pass
        return {"ok": True, "in_grace": soft, "reason": "renewal_soon" if soft else None,
                "plan": plan, "status": status, "grace_until": grace_until, "current_period_end": cpe}

    # halted / pending / cancelled / expired → check grace window
    if grace_until:
        try:
            until = datetime.fromisoformat(grace_until.replace("Z", "+00:00"))
            if now <= until:
                return {"ok": True, "in_grace": True, "reason": status,
                        "plan": plan, "status": status, "grace_until": grace_until, "current_period_end": cpe}
        except Exception:
            pass

    return {"ok": False, "in_grace": False, "reason": status,
            "plan": plan, "status": status, "grace_until": grace_until, "current_period_end": cpe}


async def ensure_plan_id(plan_key: str) -> str:
    """Idempotently create/lookup the Razorpay plan and return its id.
    Persists razorpay_plan_id in the `subscription_plans` collection."""
    if plan_key not in PLANS:
        raise HTTPException(status_code=400, detail=f"Unknown plan '{plan_key}'")
    db = get_db()
    row = await db.subscription_plans.find_one({"key": plan_key}, {"_id": 0})
    if row and row.get("razorpay_plan_id"):
        return row["razorpay_plan_id"]

    cfg = PLANS[plan_key]
    client = _get_client()
    plan = client.plan.create({
        "period": "monthly",
        "interval": 1,
        "item": {
            "name": f"Kanda POS {cfg['name']}",
            "amount": cfg["amount_paise"],
            "currency": cfg["currency"],
            "description": f"Kanda POS — {cfg['name']} plan (monthly billing)",
        },
    })
    await db.subscription_plans.update_one(
        {"key": plan_key},
        {"$set": {
            "key": plan_key,
            "razorpay_plan_id": plan["id"],
            "amount_paise": cfg["amount_paise"],
            "name": cfg["name"],
            "currency": cfg["currency"],
            "created_at": _utc_iso(now_ist()),
        }},
        upsert=True,
    )
    return plan["id"]


# -------------------- Owner-facing routes (mounted under /api/owner) --------------------
class SubscribeRequest(BaseModel):
    plan: str  # starter | pro | master


class SubscribeResponse(BaseModel):
    subscription_id: str
    short_url: Optional[str] = None
    status: str
    plan: str


async def subscribe_tenant(tenant_id: str, plan_key: str) -> dict:
    """Create (or upgrade) a Razorpay subscription for the given tenant.
    Returns {subscription_id, short_url, status, plan}."""
    db = get_db()
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    razor_plan_id = await ensure_plan_id(plan_key)
    client = _get_client()
    sub = client.subscription.create({
        "plan_id": razor_plan_id,
        "total_count": PLAN_TOTAL_CYCLES,
        "customer_notify": 1,
        "notes": {"tenant_id": tenant_id, "tenant_slug": tenant.get("slug", "")},
    })

    now_iso = _utc_iso(now_ist())
    update = {
        "plan": plan_key,
        "subscription_id": sub["id"],
        "razorpay_plan_id": razor_plan_id,
        "subscription_status": sub.get("status", "created"),
        # On `created` Razorpay hasn't billed yet; give a 7-day grace from now so the tenant can pay.
        "grace_until": _utc_iso(now_ist() + timedelta(days=GRACE_DAYS)),
        "subscribed_at": now_iso,
    }
    await db.tenants.update_one({"id": tenant_id}, {"$set": update})
    await db.subscription_events.insert_one({
        "tenant_id": tenant_id, "kind": "subscribe", "plan": plan_key,
        "subscription_id": sub["id"], "at": now_iso,
    })
    return {
        "subscription_id": sub["id"],
        "short_url": sub.get("short_url"),
        "status": sub.get("status", "created"),
        "plan": plan_key,
    }


async def cancel_tenant_subscription(tenant_id: str, immediate: bool = False) -> dict:
    db = get_db()
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    sub_id = tenant.get("subscription_id")
    if not sub_id:
        raise HTTPException(status_code=400, detail="Tenant has no active subscription")
    client = _get_client()
    res = client.subscription.cancel(sub_id, {"cancel_at_cycle_end": 0 if immediate else 1})
    now_iso = _utc_iso(now_ist())
    await db.tenants.update_one({"id": tenant_id}, {"$set": {
        "subscription_status": res.get("status", "cancelled"),
        "cancelled_at": now_iso,
    }})
    await db.subscription_events.insert_one({
        "tenant_id": tenant_id, "kind": "cancel", "immediate": immediate,
        "subscription_id": sub_id, "at": now_iso,
    })
    return {"status": res.get("status", "cancelled"), "immediate": immediate}


# -------------------- Webhook --------------------
def _verify_webhook(body: bytes, signature: str) -> bool:
    secret = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "").encode("utf-8")
    if not secret or not signature:
        return False
    expected = hmac.new(secret, body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


@subscriptions_router.post("/webhook")
async def razorpay_webhook(request: Request):
    raw = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")
    if not _verify_webhook(raw, signature):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    import json
    payload = json.loads(raw.decode("utf-8"))
    event = payload.get("event", "")
    sub_payload = (payload.get("payload", {}).get("subscription", {}) or {}).get("entity", {})
    sub_id = sub_payload.get("id")
    if not sub_id:
        return {"ok": True, "skipped": "no_subscription_id"}

    db = get_db()
    tenant = await db.tenants.find_one({"subscription_id": sub_id}, {"_id": 0})
    if not tenant:
        logger.warning("Webhook %s for unknown subscription %s", event, sub_id)
        return {"ok": True, "skipped": "unknown_subscription"}

    now = now_ist()
    update: dict = {}
    if event in ("subscription.activated", "subscription.charged"):
        update["subscription_status"] = "active"
        ce = sub_payload.get("current_end")  # epoch seconds
        if ce:
            cpe = datetime.fromtimestamp(int(ce), tz=timezone.utc)
            update["current_period_end"] = _utc_iso(cpe)
            update["grace_until"] = _utc_iso(cpe + timedelta(days=GRACE_DAYS))
        update["last_payment_at"] = _utc_iso(now)
    elif event == "subscription.halted":
        update["subscription_status"] = "halted"
        update["grace_until"] = _utc_iso(now + timedelta(days=GRACE_DAYS))
    elif event == "subscription.cancelled":
        update["subscription_status"] = "cancelled"
    elif event == "subscription.completed":
        update["subscription_status"] = "completed"
    elif event == "subscription.pending":
        update["subscription_status"] = "pending"

    if update:
        await db.tenants.update_one({"id": tenant["id"]}, {"$set": update})
    await db.subscription_events.insert_one({
        "tenant_id": tenant["id"], "kind": "webhook", "event": event,
        "subscription_id": sub_id, "at": _utc_iso(now), "payload": sub_payload,
    })
    return {"ok": True, "applied": update}
