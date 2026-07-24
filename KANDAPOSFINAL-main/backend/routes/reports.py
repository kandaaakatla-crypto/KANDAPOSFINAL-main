"""Reports — rolling 7-day weekly chart + today KPIs + top items + labour cost."""
from datetime import datetime, timezone, timedelta
from tz import now_ist, IST
from typing import List

from fastapi import APIRouter, Depends

from db import get_db
from auth import get_current_user, require_role
from tenants import tenant_filter
from models import ReportSummary, WeeklyPoint, TopItem, LabourCostResponse, effective_hourly_rate
from ._shared import PROJECTION, parse_placed_at

router = APIRouter()

_DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=IST)
        return dt
    except Exception:
        return None


@router.get("/reports/labour", response_model=LabourCostResponse)
async def labour_cost(user: dict = Depends(require_role("Manager"))):
    """Today's labour spend so far + a 30-day run-rate projection.

    Pairs `time_punches` since midnight into (in, out) intervals; a lone IN
    is closed at `now` so a currently-clocked-in employee still contributes.
    Uses `effective_hourly_rate` so monthly-paid staff are normalised.
    """
    db = get_db()
    now = now_ist()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    users = await db.users.find(tenant_filter(user), {"_id": 0, "pin_hash": 0}).to_list(500)
    rate_by_id = {u["id"]: effective_hourly_rate(u) for u in users}
    name_by_id = {u["id"]: u["name"] for u in users}
    role_by_id = {u["id"]: u["role"] for u in users}

    # Pull every punch since midnight in one round-trip, sorted ascending.
    punches = await db.time_punches.find(
        tenant_filter(user, {"at": {"$gte": today_start.isoformat()}}),
        {"_id": 0},
    ).sort("at", 1).to_list(2000)

    hours_by_user: dict[str, float] = {}
    currently_in_ids: set[str] = set()
    for p in punches:
        ts = _parse_iso(p.get("at"))
        if not ts:
            continue
        uid = p["user_id"]
        if p["type"] == "in":
            currently_in_ids.add(uid)
            hours_by_user.setdefault(uid + ":pending", 0)  # marker; we walk below
        elif p["type"] == "out":
            currently_in_ids.discard(uid)

    # Pair properly per-user.
    by_user: dict[str, list[dict]] = {}
    for p in punches:
        by_user.setdefault(p["user_id"], []).append(p)

    rows: list[dict] = []
    total_today = 0.0
    for uid, pl in by_user.items():
        seconds = 0.0
        current_in = None
        for p in pl:
            ts = _parse_iso(p["at"])
            if not ts:
                continue
            if p["type"] == "in":
                current_in = ts
            elif p["type"] == "out" and current_in is not None:
                if ts > current_in:
                    seconds += (ts - current_in).total_seconds()
                current_in = None
        if current_in is not None:
            seconds += (now - current_in).total_seconds()
        hours = round(seconds / 3600.0, 2)
        if hours <= 0:
            continue
        cost = round(hours * float(rate_by_id.get(uid) or 0), 2)
        total_today += cost
        rows.append({
            "user_id": uid,
            "user_name": name_by_id.get(uid, uid),
            "role": role_by_id.get(uid, "—"),
            "hours_today": hours,
            "cost_today": cost,
            "currently_in": uid in currently_in_ids,
        })

    rows.sort(key=lambda r: -r["cost_today"])

    # Simple 30-day run-rate: today's accumulated cost extrapolated linearly.
    secs_elapsed = (now - today_start).total_seconds()
    if secs_elapsed > 0 and total_today > 0:
        day_proj = total_today * (24 * 3600 / secs_elapsed)
        monthly = round(day_proj * 30, 2)
    else:
        monthly = 0.0

    return {
        "as_of": now.isoformat(),
        "today_cost": round(total_today, 2),
        "currently_in_count": sum(1 for r in rows if r["currently_in"]),
        "currently_in": rows,
        "monthly_run_rate": monthly,
    }


@router.get("/reports/daily-rollup")
async def daily_rollup(user: dict = Depends(get_current_user), days: int = 30):
    """Aggregate sales & ticket count per calendar day.

    Historic days come from the `report_rollups` cache (materialised each
    night by the daily_rollup_cron_loop, or lazily on first request). Today
    is always computed fresh.
    """
    db = get_db()
    now = now_ist()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0).date()

    rollups: list[dict] = []
    for back in range(days, -1, -1):
        d = today - timedelta(days=back)
        is_today = (d == today)
        cached = None
        if not is_today:
            cached = await db.report_rollups.find_one(
                tenant_filter(user, {"date": d.isoformat()}), {"_id": 0},
            )
        if cached:
            rollups.append({k: v for k, v in cached.items() if k != "tenant_id"})
            continue
        start_iso = datetime(d.year, d.month, d.day, tzinfo=IST).isoformat()
        end_iso = (datetime(d.year, d.month, d.day, tzinfo=IST) + timedelta(days=1)).isoformat()
        docs = await db.orders.find(
            tenant_filter(user, {"placedAt": {"$gte": start_iso, "$lt": end_iso}, "voided": {"$ne": True}}),
            {"_id": 0, "total": 1, "refunded_amount": 1},
        ).to_list(5000)
        gross = sum(float(o.get("total", 0)) for o in docs)
        refunded = sum(float(o.get("refunded_amount", 0) or 0) for o in docs)
        entry = {
            "date": d.isoformat(),
            "orders": len(docs),
            "gross_sales": round(gross, 2),
            "refunded": round(refunded, 2),
            "net_sales": round(gross - refunded, 2),
            "computed_at": now.isoformat(),
        }
        if not is_today:
            entry["tenant_id"] = user["tenant_id"]
            await db.report_rollups.replace_one(
                {"tenant_id": user["tenant_id"], "date": entry["date"]},
                entry, upsert=True,
            )
        rollups.append({k: v for k, v in entry.items() if k != "tenant_id"})
    return {"days": days, "rollups": rollups}


@router.post("/reports/daily-rollup/rebuild")
async def rebuild_rollups(user: dict = Depends(require_role("Manager")), days: int = 30):
    """Manually rebuild the daily-rollup cache for the last N days. Handy after
    a large historical import or when the schema changes."""
    from background_tasks import _compute_day_rollup
    db = get_db()
    now = now_ist()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    count = 0
    for back in range(1, days + 1):
        day = today - timedelta(days=back)
        entry = await _compute_day_rollup(db, user["tenant_id"], day)
        await db.report_rollups.replace_one(
            {"tenant_id": user["tenant_id"], "date": entry["date"]}, entry, upsert=True,
        )
        count += 1
    return {"ok": True, "rebuilt": count, "days": days}


@router.get("/reports/summary", response_model=ReportSummary)
async def report_summary(user: dict = Depends(get_current_user)):
    db = get_db()

    now = now_ist()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=6)

    # `placedAt` is stored as an ISO-8601 IST string (`datetime.isoformat()`),
    # which sorts lexicographically — so a string $gte filter at the DB layer
    # is correct and lets the (tenant_id, placedAt) index do the heavy lifting
    # instead of pulling the whole order history into Python.
    db_filter = tenant_filter(user, {"placedAt": {"$gte": week_start.isoformat()}})
    week_docs = await db.orders.find(db_filter, PROJECTION).to_list(5000)

    today_orders = []
    week_orders = []
    for o in week_docs:
        ts = parse_placed_at(o.get("placedAt", ""))
        if not ts:
            continue
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=IST)
        if ts >= today_start:
            today_orders.append(o)
        week_orders.append((ts, o))

    today_sales = sum(o.get("total", 0) for o in today_orders)
    today_count = len(today_orders)
    avg = (today_sales / today_count) if today_count else 0
    deliveries = sum(1 for o in today_orders if o.get("type") == "delivery")
    cash = sum(o["total"] for o in today_orders if o.get("payment") == "cash")
    card = sum(o["total"] for o in today_orders if o.get("payment") == "card")
    unpaid = sum(o["total"] for o in today_orders if o.get("payment") == "unpaid")

    weekly: List[WeeklyPoint] = []
    for i in range(6, -1, -1):
        day = today_start - timedelta(days=i)
        day_end = day + timedelta(days=1)
        bucket = [o for ts, o in week_orders if day <= ts < day_end]
        weekly.append(WeeklyPoint(
            day=_DAY_LABELS[day.weekday()],
            sales=round(sum(o.get("total", 0) for o in bucket), 2),
            orders=len(bucket),
        ))

    counts: dict[str, dict] = {}
    for _ts, o in week_orders:
        for it in o.get("items", []):
            key = it["name"]
            entry = counts.setdefault(key, {"name": key, "sold": 0, "revenue": 0.0})
            entry["sold"] += it["qty"]
            entry["revenue"] += it["qty"] * it["price"]
    top = sorted(counts.values(), key=lambda x: x["sold"], reverse=True)[:5]

    return ReportSummary(
        todaySales=round(today_sales, 2),
        ordersToday=today_count,
        avgOrder=round(avg, 2),
        deliveriesToday=deliveries,
        cashTotal=round(cash, 2),
        cardTotal=round(card, 2),
        unpaidTotal=round(unpaid, 2),
        weeklySales=weekly,
        topItems=[TopItem(**t) for t in top],
    )
