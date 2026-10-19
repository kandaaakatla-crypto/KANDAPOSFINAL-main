"""Background scheduled tasks.

Currently:
  - daily_rollup_cron_loop: at 00:05 IST every day, materialise "yesterday's"
    sales aggregate for every tenant so Reports & Digest read from cache
    instead of scanning orders.
  - birthday_bonus_loop: at 09:00 IST every day, credit each tenant's
    configured birthday-bonus loyalty points to customers whose birthday
    (month+day) is today, and text them a happy-birthday message.
  - leads_digest_loop: at 23:55 IST every day, email SUPPORT_TO_EMAIL a
    summary of that day's kandapos.com "Book a demo" / "Sign up for
    updates" submissions. Separate from the per-submission notification
    already sent in routes/leads.py — this is the once-a-day recap for
    someone who doesn't want to watch their inbox in real time.
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from tz import now_ist
from routes.loyalty import _get_config as _get_loyalty_config
from sms_service import send_sms
from email_service import send_email, landing_leads_digest_email
from sales import PAID_NOT_VOIDED, net_sales

logger = logging.getLogger("kanda.cron")


# Bump when the definition of a rollup changes: cached days with an older (or
# missing) `v` are recomputed on read instead of showing stale numbers.
ROLLUP_VERSION = 2


async def _compute_day_rollup(db, tenant_id: str, day: datetime) -> dict:
    start_iso = day.isoformat()
    end_iso = (day + timedelta(days=1)).isoformat()
    # Paid, non-voided orders only (sales.py) — unpaid/voided orders are not
    # sales, and refunds are netted out so nothing is counted twice.
    docs = await db.orders.find(
        {"tenant_id": tenant_id, "placedAt": {"$gte": start_iso, "$lt": end_iso},
         **PAID_NOT_VOIDED},
        {"_id": 0, "total": 1, "refunded_amount": 1, "items": 1, "placedAt": 1, "payment": 1},
    ).to_list(20000)

    gross = 0.0
    refunded = 0.0
    hourly = [0.0] * 24
    item_agg: dict[str, dict] = {}
    for o in docs:
        total = float(o.get("total", 0) or 0)
        gross += total
        refunded += float(o.get("refunded_amount", 0) or 0)
        # Hourly bucket by IST hour of placedAt (net of refunds).
        placed = o.get("placedAt") or ""
        try:
            hr = int(placed[11:13])
            if 0 <= hr < 24:
                hourly[hr] += net_sales(o)
        except (ValueError, IndexError):
            pass
        for it in (o.get("items") or []):
            name = it.get("name") or "?"
            qty = float(it.get("qty") or it.get("quantity") or 1)
            price = float(it.get("price") or 0)
            row = item_agg.setdefault(name, {"name": name, "qty": 0, "revenue": 0.0})
            row["qty"] += qty
            row["revenue"] += qty * price

    top_items = sorted(item_agg.values(), key=lambda r: r["revenue"], reverse=True)[:10]
    for t in top_items:
        t["revenue"] = round(t["revenue"], 2)
        t["qty"] = round(t["qty"], 2)

    return {
        "tenant_id": tenant_id,
        "date": day.date().isoformat(),
        "orders": len(docs),
        "gross_sales": round(gross, 2),
        "refunded": round(refunded, 2),
        "net_sales": round(gross - refunded, 2),
        "avg_ticket": round(gross / len(docs), 2) if docs else 0.0,
        "hourly_revenue": [round(h, 2) for h in hourly],
        "top_items": top_items,
        "computed_at": now_ist().isoformat(),
        "is_final": True,
        "v": ROLLUP_VERSION,
    }


async def _rollup_yesterday_for_all_tenants(db) -> int:
    """Materialise yesterday's rollup for every tenant. Idempotent — replaces
    an existing row for that (tenant, date)."""
    now = now_ist()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday = today - timedelta(days=1)

    tenants = await db.tenants.find({}, {"_id": 0, "id": 1}).to_list(1000)
    count = 0
    for t in tenants:
        entry = await _compute_day_rollup(db, t["id"], yesterday)
        await db.report_rollups.replace_one(
            {"tenant_id": t["id"], "date": entry["date"]}, entry, upsert=True,
        )
        count += 1
    return count


async def daily_rollup_cron_loop(get_db_fn, target_hour_ist: int = 0,
                                 target_minute_ist: int = 5,
                                 interval_sec: int = 60):
    """Fire once per IST day around the configured hour:minute. Uses the
    `report_rollups` cache doc's presence to dedupe within a day so a bounce
    of the process won't double-fire."""
    logger.info("Daily rollup cron loop started (target=%02d:%02d IST)",
                target_hour_ist, target_minute_ist)
    while True:
        try:
            db = get_db_fn()
            now = now_ist()
            today_ist = now.strftime("%Y-%m-%d")
            target = now.replace(hour=target_hour_ist, minute=target_minute_ist,
                                 second=0, microsecond=0)
            if now >= target:
                # Have we already produced a rollup with today's `computed_at` date?
                last = await db.cron_state.find_one({"id": "daily_rollup"}, {"_id": 0})
                if not last or (last.get("last_run_date") != today_ist):
                    count = await _rollup_yesterday_for_all_tenants(db)
                    await db.cron_state.replace_one(
                        {"id": "daily_rollup"},
                        {"id": "daily_rollup", "last_run_date": today_ist,
                         "last_run_at": now.isoformat(), "tenant_count": count},
                        upsert=True,
                    )
                    logger.info("Daily rollup cron completed for %d tenant(s)", count)
        except Exception:
            logger.exception("daily_rollup_cron_loop tick failed")
        await asyncio.sleep(interval_sec)


async def _birthday_bonus_for_all(db) -> int:
    """Credit each tenant's configured birthday bonus to every customer
    whose `birthday` (stored as "MM-DD") matches today, once per calendar
    year (tracked via `last_birthday_bonus_year` on the customer doc).
    Birthday matches are rare per day, so this scans across all tenants in
    one query rather than looping tenant-by-tenant like the sales rollup."""
    today_md = now_ist().strftime("%m-%d")
    year = now_ist().year
    customers = await db.customers.find(
        {"birthday": today_md, "$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}]},
        {"_id": 0},
    ).to_list(5000)
    if not customers:
        return 0

    feature_cache: dict[str, bool] = {}
    cfg_cache: dict[str, dict] = {}
    credited = 0
    for cust in customers:
        if cust.get("last_birthday_bonus_year") == year:
            continue
        tenant_id = cust["tenant_id"]
        if tenant_id not in feature_cache:
            tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "features": 1})
            feature_cache[tenant_id] = ((tenant or {}).get("features") or {}).get("loyalty", True)
        if not feature_cache[tenant_id]:
            continue
        if tenant_id not in cfg_cache:
            cfg_cache[tenant_id] = await _get_loyalty_config(db, tenant_id)
        bonus = int(cfg_cache[tenant_id].get("birthday_bonus_points") or 0)
        if bonus <= 0:
            continue

        await db.customers.update_one(
            {"tenant_id": tenant_id, "id": cust["id"]},
            {"$inc": {"loyalty_points": bonus}, "$set": {"last_birthday_bonus_year": year}},
        )
        await db.loyalty_txns.insert_one({
            "id": f"lt_{uuid.uuid4().hex[:10]}",
            "tenant_id": tenant_id,
            "customer_id": cust["id"],
            "customer_name": cust["name"],
            "kind": "bonus",
            "points": bonus,
            "order_id": None,
            "note": "Happy birthday! 🎂",
            "by_user_id": None,
            "by_user_name": "Birthday bonus (automatic)",
            "at": now_ist().isoformat(),
        })
        if cust.get("phone"):
            first = (cust.get("name") or "there").split(" ")[0]
            try:
                await send_sms(cust["phone"], f"Happy Birthday {first}! 🎂 We've added {bonus} bonus loyalty points to your account. Treat yourself soon!")
            except Exception:
                logger.exception("Birthday SMS failed for customer %s", cust["id"])
        credited += 1
    return credited


async def birthday_bonus_loop(get_db_fn, target_hour_ist: int = 9,
                              target_minute_ist: int = 0,
                              interval_sec: int = 60):
    """Fire once per IST day around the configured hour:minute. Dedupes
    within a day via `cron_state` (same pattern as the sales rollup); the
    per-customer `last_birthday_bonus_year` field is the real once-a-year
    guarantee, so a re-run this same day is still harmless."""
    logger.info("Birthday bonus cron loop started (target=%02d:%02d IST)",
                target_hour_ist, target_minute_ist)
    while True:
        try:
            db = get_db_fn()
            now = now_ist()
            today_ist = now.strftime("%Y-%m-%d")
            target = now.replace(hour=target_hour_ist, minute=target_minute_ist,
                                 second=0, microsecond=0)
            if now >= target:
                last = await db.cron_state.find_one({"id": "birthday_bonus"}, {"_id": 0})
                if not last or (last.get("last_run_date") != today_ist):
                    count = await _birthday_bonus_for_all(db)
                    await db.cron_state.replace_one(
                        {"id": "birthday_bonus"},
                        {"id": "birthday_bonus", "last_run_date": today_ist,
                         "last_run_at": now.isoformat(), "credited_count": count},
                        upsert=True,
                    )
                    logger.info("Birthday bonus cron completed — %d customer(s) credited", count)
        except Exception:
            logger.exception("birthday_bonus_loop tick failed")
        await asyncio.sleep(interval_sec)


async def _send_leads_digest(db) -> int:
    """Email SUPPORT_TO_EMAIL a summary of today's landing-page leads.
    Returns the number of leads included (0 still sends — a "nothing today"
    email confirms the job is alive rather than looking like it silently
    stopped working)."""
    to = os.environ.get("SUPPORT_TO_EMAIL", "").strip()
    if not to:
        logger.info("leads digest: SUPPORT_TO_EMAIL not set, skipping send")
        return 0

    now = now_ist()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    leads = await db.landing_leads.find(
        {"at": {"$gte": today_start.isoformat()}}, {"_id": 0},
    ).sort("at", 1).to_list(1000)

    subject, html = landing_leads_digest_email(leads, today_start.strftime("%d %b %Y"))
    await send_email(to, subject, html)
    return len(leads)


async def leads_digest_loop(get_db_fn, target_hour_ist: int = 23,
                            target_minute_ist: int = 55,
                            interval_sec: int = 60):
    """Fire once per IST day around the configured hour:minute (default
    23:55, so the whole day's submissions are captured). Same
    once-per-day-via-cron_state dedupe as the other loops in this file."""
    logger.info("Leads digest cron loop started (target=%02d:%02d IST)",
                target_hour_ist, target_minute_ist)
    while True:
        try:
            db = get_db_fn()
            now = now_ist()
            today_ist = now.strftime("%Y-%m-%d")
            target = now.replace(hour=target_hour_ist, minute=target_minute_ist,
                                 second=0, microsecond=0)
            if now >= target:
                last = await db.cron_state.find_one({"id": "leads_digest"}, {"_id": 0})
                if not last or (last.get("last_run_date") != today_ist):
                    count = await _send_leads_digest(db)
                    await db.cron_state.replace_one(
                        {"id": "leads_digest"},
                        {"id": "leads_digest", "last_run_date": today_ist,
                         "last_run_at": now.isoformat(), "lead_count": count},
                        upsert=True,
                    )
                    logger.info("Leads digest cron completed — %d lead(s)", count)
        except Exception:
            logger.exception("leads_digest_loop tick failed")
        await asyncio.sleep(interval_sec)
