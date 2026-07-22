"""Background scheduled tasks.

Currently:
  - daily_rollup_cron_loop: at 00:05 UTC every day, materialise "yesterday's"
    sales aggregate for every tenant so Reports & Digest read from cache
    instead of scanning orders.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger("kanda.cron")


async def _compute_day_rollup(db, tenant_id: str, day: datetime) -> dict:
    start_iso = day.isoformat()
    end_iso = (day + timedelta(days=1)).isoformat()
    docs = await db.orders.find(
        {"tenant_id": tenant_id, "placedAt": {"$gte": start_iso, "$lt": end_iso},
         "voided": {"$ne": True}},
        {"_id": 0, "total": 1, "refunded_amount": 1, "items": 1, "placedAt": 1},
    ).to_list(20000)

    gross = 0.0
    refunded = 0.0
    hourly = [0.0] * 24
    item_agg: dict[str, dict] = {}
    for o in docs:
        total = float(o.get("total", 0) or 0)
        gross += total
        refunded += float(o.get("refunded_amount", 0) or 0)
        # Hourly bucket by UTC hour of placedAt.
        placed = o.get("placedAt") or ""
        try:
            hr = int(placed[11:13])
            if 0 <= hr < 24:
                hourly[hr] += total
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
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "is_final": True,
    }


async def _rollup_yesterday_for_all_tenants(db) -> int:
    """Materialise yesterday's rollup for every tenant. Idempotent — replaces
    an existing row for that (tenant, date)."""
    now = datetime.now(timezone.utc)
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


async def daily_rollup_cron_loop(get_db_fn, target_hour_utc: int = 0,
                                 target_minute_utc: int = 5,
                                 interval_sec: int = 60):
    """Fire once per UTC day around the configured hour:minute. Uses the
    `report_rollups` cache doc's presence to dedupe within a day so a bounce
    of the process won't double-fire."""
    logger.info("Daily rollup cron loop started (target=%02d:%02d UTC)",
                target_hour_utc, target_minute_utc)
    while True:
        try:
            db = get_db_fn()
            now = datetime.now(timezone.utc)
            today_utc = now.strftime("%Y-%m-%d")
            target = now.replace(hour=target_hour_utc, minute=target_minute_utc,
                                 second=0, microsecond=0)
            if now >= target:
                # Have we already produced a rollup with today's `computed_at` date?
                last = await db.cron_state.find_one({"id": "daily_rollup"}, {"_id": 0})
                if not last or (last.get("last_run_date") != today_utc):
                    count = await _rollup_yesterday_for_all_tenants(db)
                    await db.cron_state.replace_one(
                        {"id": "daily_rollup"},
                        {"id": "daily_rollup", "last_run_date": today_utc,
                         "last_run_at": now.isoformat(), "tenant_count": count},
                        upsert=True,
                    )
                    logger.info("Daily rollup cron completed for %d tenant(s)", count)
        except Exception:
            logger.exception("daily_rollup_cron_loop tick failed")
        await asyncio.sleep(interval_sec)
