"""Payroll — combines time-tracking, tip allocations, and staff pay setup
(see StaffPublic.pay_type/hourly_rate/monthly_pay in models.py) into one
per-employee gross-pay figure for a date range.

Wage pay is computed differently per pay_type, matching how each is actually
paid in practice:
  - hourly:  hours worked in the period × hourly_rate, plus a 0.5x premium on
             any hours past OVERTIME_THRESHOLD_HOURS (same formula as the
             existing /timeclock/timesheet endpoint, kept in sync here).
  - monthly: the monthly salary prorated by the fraction of a 30-day month the
             requested period covers, since a fixed salary isn't hours-based.

Tips are summed from `tip_pools` allocations whose shift_date falls in range
(see routes/tips.py) and added on top to produce gross_pay.
"""
import io
import csv
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from db import get_db
from auth import require_role
from tenants import tenant_filter
from tz import now_ist
from datetime import timedelta
from models import PayrollRow
from .timeclock import _parse, _pair_punches, OVERTIME_THRESHOLD_HOURS

router = APIRouter()


async def _payroll_rows(user: dict, start: Optional[str], end: Optional[str]) -> List[dict]:
    db = get_db()
    start_dt = _parse(start) or (now_ist() - timedelta(days=30))
    end_dt = _parse(end) or now_ist()
    period_days = max(0.0, (end_dt - start_dt).total_seconds() / 86400.0)

    users = await db.users.find(tenant_filter(user), {"_id": 0, "pin_hash": 0}).to_list(500)

    # Tips owed per user across every tip pool whose shift_date falls in range.
    start_date, end_date = start_dt.date().isoformat(), end_dt.date().isoformat()
    pools = await db.tip_pools.find(
        tenant_filter(user, {"shift_date": {"$gte": start_date, "$lt": end_date}}), {"_id": 0},
    ).to_list(500)
    tips_by_user: dict[str, float] = {}
    for pool in pools:
        for alloc in pool.get("allocations", []):
            tips_by_user[alloc["user_id"]] = tips_by_user.get(alloc["user_id"], 0.0) + alloc.get("share", 0.0)

    rows: list[dict] = []
    for u in users:
        punches = await db.time_punches.find(
            tenant_filter(user, {"user_id": u["id"], "at": {"$gte": start_dt.isoformat(), "$lt": end_dt.isoformat()}}),
            {"_id": 0},
        ).sort("at", 1).to_list(2000)
        pairs = _pair_punches(punches)
        total_hours = round(sum((b - a).total_seconds() for a, b in pairs) / 3600.0, 2)
        ot = round(max(0.0, total_hours - OVERTIME_THRESHOLD_HOURS), 2)

        pay_type = u.get("pay_type") or "monthly"
        hourly_rate = float(u.get("hourly_rate") or 0)
        monthly_pay = float(u.get("monthly_pay") or 0)
        if pay_type == "hourly":
            wage_pay = round(total_hours * hourly_rate + ot * hourly_rate * 0.5, 2)
        else:
            wage_pay = round(monthly_pay * (period_days / 30.0), 2)

        tips = round(tips_by_user.get(u["id"], 0.0), 2)
        rows.append({
            "user_id": u["id"],
            "user_name": u["name"],
            "role": u["role"],
            "pay_type": pay_type,
            "hourly_rate": hourly_rate,
            "monthly_pay": monthly_pay,
            "total_hours": total_hours,
            "overtime_hours": ot,
            "wage_pay": wage_pay,
            "tips": tips,
            "gross_pay": round(wage_pay + tips, 2),
        })
    rows.sort(key=lambda r: r["user_name"])
    return rows


@router.get("/payroll/summary", response_model=List[PayrollRow])
async def payroll_summary(
    user: dict = Depends(require_role("Manager")),
    start: Optional[str] = Query(None, description="ISO start (inclusive)"),
    end: Optional[str] = Query(None, description="ISO end (exclusive)"),
):
    return await _payroll_rows(user, start, end)


@router.get("/payroll/summary.csv")
async def payroll_summary_csv(
    user: dict = Depends(require_role("Manager")),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
):
    rows = await _payroll_rows(user, start, end)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["employee", "role", "pay_type", "hourly_rate", "monthly_pay",
                "total_hours", "overtime_hours", "wage_pay", "tips", "gross_pay"])
    for r in rows:
        w.writerow([r["user_name"], r["role"], r["pay_type"], r["hourly_rate"], r["monthly_pay"],
                    r["total_hours"], r["overtime_hours"], r["wage_pay"], r["tips"], r["gross_pay"]])
    return StreamingResponse(
        iter([buf.getvalue().encode("utf-8")]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="kanda-payroll.csv"'},
    )
