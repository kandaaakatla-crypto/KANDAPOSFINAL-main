"""Reports — rolling 7-day weekly chart + today KPIs + top items + labour cost."""
from datetime import datetime, timezone, timedelta
from tz import now_ist, IST
from typing import List

from fastapi import APIRouter, Depends, HTTPException

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


@router.get("/reports/menu-engineering")
async def menu_engineering(user: dict = Depends(require_role("Manager")), days: int = 30):
    """Classic menu-engineering matrix (Kasavana & Smith): classify each item
    sold in the last `days` by popularity vs. contribution margin.

    - Popularity: an item is "popular" if it sold at least 70% of an even
      per-item share of total volume (the standard 70% rule).
    - Profitability: an item is "profitable" if its margin (selling price
      minus recipe cost, via `recipes` + `inventory.cost_per_unit`) is at or
      above the sales-weighted average margin across items with a known cost.
    - Quadrant: Star (both), Plowhorse (popular only), Puzzle (profitable
      only), Dog (neither). Items with no recipe get `quadrant: "unknown"`
      since margin can't be computed — `has_recipe` flags this for the UI.

    Order items only store a `name`, not a menu_item_id, so sold items are
    matched back to the live menu by longest-prefix name match (same
    approach as the "top items" aggregation below) — accurate for typical
    naming (e.g. "Margherita 12\"" matches menu item "Margherita").
    """
    db = get_db()
    now = now_ist()
    start = (now - timedelta(days=days)).isoformat()

    order_docs = await db.orders.find(
        tenant_filter(user, {"placedAt": {"$gte": start}, "voided": {"$ne": True}}),
        {"_id": 0, "items": 1},
    ).to_list(10000)

    sold: dict[str, dict] = {}
    for o in order_docs:
        for it in o.get("items", []):
            entry = sold.setdefault(it["name"], {"name": it["name"], "qty": 0, "revenue": 0.0})
            entry["qty"] += it["qty"]
            entry["revenue"] += it["qty"] * it["price"]

    if not sold:
        return {"days": days, "items": [], "avg_margin": None, "popularity_threshold": 0}

    menu_docs = await db.menu_items.find(tenant_filter(user), {"_id": 0, "id": 1, "name": 1}).to_list(1000)
    # Longest-name-first so "Margherita Deluxe" wins over "Margherita" for a
    # sold name like "Margherita Deluxe 12\"".
    menu_docs.sort(key=lambda m: -len(m["name"]))

    def match_menu_item(sold_name: str):
        for m in menu_docs:
            if sold_name == m["name"] or sold_name.startswith(m["name"] + " ") or sold_name.startswith(m["name"] + " —"):
                return m
        return None

    matched: dict[str, dict] = {}  # sold_name -> menu doc
    menu_ids = set()
    for name in sold:
        m = match_menu_item(name)
        if m:
            matched[name] = m
            menu_ids.add(m["id"])

    recipes = await db.recipes.find(
        tenant_filter(user, {"menu_item_id": {"$in": list(menu_ids)}}), {"_id": 0},
    ).to_list(500) if menu_ids else []
    inv_ids = {ing["inventory_id"] for r in recipes for ing in r.get("ingredients", [])}
    inv_docs = await db.inventory.find(
        tenant_filter(user, {"id": {"$in": list(inv_ids)}}), {"_id": 0, "id": 1, "cost_per_unit": 1},
    ).to_list(500) if inv_ids else []
    cost_by_inv = {d["id"]: float(d.get("cost_per_unit", 0) or 0) for d in inv_docs}

    # Average recipe cost per menu item across whatever size variants exist —
    # a fair approximation since sold-item names don't reliably tell us which
    # size was ordered.
    cost_by_menu_id: dict[str, float] = {}
    counts_by_menu_id: dict[str, int] = {}
    for r in recipes:
        c = sum(ing["qty"] * cost_by_inv.get(ing["inventory_id"], 0) for ing in r.get("ingredients", []))
        cost_by_menu_id[r["menu_item_id"]] = cost_by_menu_id.get(r["menu_item_id"], 0) + c
        counts_by_menu_id[r["menu_item_id"]] = counts_by_menu_id.get(r["menu_item_id"], 0) + 1
    for mid in cost_by_menu_id:
        cost_by_menu_id[mid] /= counts_by_menu_id[mid]

    rows = []
    for name, s in sold.items():
        avg_price = s["revenue"] / s["qty"] if s["qty"] else 0
        m = matched.get(name)
        cost = cost_by_menu_id.get(m["id"]) if m else None
        has_recipe = cost is not None
        margin = round(avg_price - cost, 2) if has_recipe else None
        rows.append({
            "name": name, "qty_sold": s["qty"], "revenue": round(s["revenue"], 2),
            "avg_price": round(avg_price, 2), "cost": round(cost, 2) if has_recipe else None,
            "margin": margin, "has_recipe": has_recipe,
        })

    total_qty = sum(r["qty_sold"] for r in rows)
    n_items = len(rows)
    even_share = total_qty / n_items if n_items else 0
    popularity_threshold = 0.7 * even_share

    costed = [r for r in rows if r["has_recipe"]]
    total_costed_qty = sum(r["qty_sold"] for r in costed)
    avg_margin = (sum(r["margin"] * r["qty_sold"] for r in costed) / total_costed_qty) if total_costed_qty else None

    for r in rows:
        popular = r["qty_sold"] >= popularity_threshold
        r["popular"] = popular
        if not r["has_recipe"] or avg_margin is None:
            r["quadrant"] = "unknown"
            continue
        profitable = r["margin"] >= avg_margin
        r["profitable"] = profitable
        r["quadrant"] = "star" if popular and profitable else "plowhorse" if popular else "puzzle" if profitable else "dog"

    rows.sort(key=lambda r: -r["revenue"])
    return {
        "days": days,
        "items": rows,
        "avg_margin": round(avg_margin, 2) if avg_margin is not None else None,
        "popularity_threshold": round(popularity_threshold, 2),
    }


@router.get("/reports/summary", response_model=ReportSummary)
async def report_summary(user: dict = Depends(get_current_user)):
    db = get_db()

    now = now_ist()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=6)
    # Same weekday last week, midnight up to this clock time: a fair
    # "are we ahead?" line for a day that isn't over yet.
    lw_now = now - timedelta(days=7)
    lw_start = today_start - timedelta(days=7)

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

    lw_docs = await db.orders.find(
        tenant_filter(user, {"placedAt": {"$gte": lw_start.isoformat(), "$lt": week_start.isoformat()}}),
        PROJECTION,
    ).to_list(5000)
    lw_orders = []
    for o in lw_docs:
        ts = parse_placed_at(o.get("placedAt", ""))
        if not ts:
            continue
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=IST)
        if lw_start <= ts <= lw_now:
            lw_orders.append(o)

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
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "daily_sales_target": 1})

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
        sameTimeLastWeek=round(sum(o.get("total", 0) for o in lw_orders), 2),
        sameTimeLastWeekOrders=len(lw_orders),
        dailyTarget=(tenant or {}).get("daily_sales_target"),
    )


@router.get("/reports/channels")
async def report_channels(user: dict = Depends(get_current_user), days: int = 1):
    """Sales split by where orders came from (`source`) and by order type,
    from IST midnight `days - 1` days ago up to now. Voided orders are left
    out; orders with no recorded source were rung up at the counter."""
    if days not in (1, 7, 30):
        raise HTTPException(status_code=422, detail="days must be 1, 7 or 30")
    start = now_ist().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)
    match = tenant_filter(user, {"placedAt": {"$gte": start.isoformat()}, "voided": {"$ne": True}})

    async def split(field: str, default: str) -> list:
        rows = await get_db().orders.aggregate([
            {"$match": match},
            {"$group": {"_id": {"$ifNull": [f"${field}", default]}, "orders": {"$sum": 1}, "sales": {"$sum": "$total"}}},
            {"$sort": {"sales": -1}},
        ]).to_list(50)
        return [{"key": r["_id"], "orders": r["orders"], "sales": round(r["sales"] or 0, 2)} for r in rows]

    by_source = await split("source", "in-store")
    return {
        "days": days,
        "total": round(sum(r["sales"] for r in by_source), 2),
        "bySource": by_source,
        "byType": await split("type", "sale"),
    }


@router.get("/reports/food-cost")
async def report_food_cost(user: dict = Depends(require_role("Manager")), days: int = 7):
    """Waste and food cost over the last `days` (rolling, same window as the
    menu-engineering report it builds on).

    - waste: logged waste valued at each inventory item's current
      `cost_per_unit`, grouped by item and by reason.
    - food: recipe cost of the dishes sold vs what they sold for, over the
      dishes that have a recipe (`coveragePct` says how much of item revenue
      that is, so a low-coverage % isn't mistaken for the whole menu).
    """
    if days not in (7, 30):
        raise HTTPException(status_code=422, detail="days must be 7 or 30")
    db = get_db()
    since = (now_ist() - timedelta(days=days)).isoformat()

    waste_docs = await db.waste_entries.find(
        tenant_filter(user, {"at": {"$gte": since}}), {"_id": 0, "inventory_id": 1, "inventory_name": 1, "qty": 1, "unit": 1, "reason": 1},
    ).to_list(5000)
    inv_ids = list({w["inventory_id"] for w in waste_docs})
    inv_docs = await db.inventory.find(
        tenant_filter(user, {"id": {"$in": inv_ids}}), {"_id": 0, "id": 1, "cost_per_unit": 1},
    ).to_list(len(inv_ids) or 1) if inv_ids else []
    cost_by_inv = {d["id"]: float(d.get("cost_per_unit", 0) or 0) for d in inv_docs}

    by_item: dict[str, dict] = {}
    by_reason: dict[str, dict] = {}
    for w in waste_docs:
        value = float(w.get("qty", 0) or 0) * cost_by_inv.get(w["inventory_id"], 0)
        it = by_item.setdefault(w["inventory_id"], {"name": w.get("inventory_name", ""), "qty": 0.0, "unit": w.get("unit", ""), "value": 0.0})
        it["qty"] += float(w.get("qty", 0) or 0)
        it["value"] += value
        rs = by_reason.setdefault(w.get("reason", ""), {"reason": w.get("reason", ""), "entries": 0, "value": 0.0})
        rs["entries"] += 1
        rs["value"] += value
    for row in (*by_item.values(), *by_reason.values()):
        row["value"] = round(row["value"], 2)
        if "qty" in row:
            row["qty"] = round(row["qty"], 3)

    eng = await menu_engineering(user=user, days=days)
    items = eng.get("items", [])
    costed = [i for i in items if i.get("has_recipe")]
    revenue = sum(i["revenue"] for i in costed)
    cost = sum(i["cost"] * i["qty_sold"] for i in costed)
    all_revenue = sum(i["revenue"] for i in items)

    return {
        "days": days,
        "waste": {
            "value": round(sum(r["value"] for r in by_item.values()), 2),
            "entries": len(waste_docs),
            "byItem": sorted(by_item.values(), key=lambda r: -r["value"])[:10],
            "byReason": sorted(by_reason.values(), key=lambda r: -r["value"]),
        },
        "food": {
            "revenue": round(revenue, 2),
            "cost": round(cost, 2),
            "pct": round(cost / revenue * 100, 1) if revenue else None,
            "coveragePct": round(revenue / all_revenue * 100) if all_revenue else None,
        },
    }
