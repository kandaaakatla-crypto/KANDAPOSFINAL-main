"""Time clock — PIN-based punch in/out + timesheet aggregation.

Public-ish `POST /api/timeclock/punch` endpoint: an employee taps their
4-digit PIN on a shared terminal and (when configured) the terminal also
captures a webcam selfie. The endpoint auto-detects whether this is an
`in` or `out` punch by inspecting the user's most recent punch.

Future biometric devices (ZKTeco / ESSL via `pyzk`, browser WebAuthn,
QR-based) post the same payload with `source` set accordingly — see
`/app/backend/BIOMETRIC_INTEGRATION.md` for the contract.

Manager endpoints:
  GET    /timeclock/current        — who's currently clocked in
  GET    /timeclock/punches        — paginated punch history (last 200)
  POST   /timeclock/punches        — manual punch insert (missed-punch fix)
  DELETE /timeclock/punches/{id}   — remove a bogus punch
  GET    /timeclock/timesheet      — aggregated hours/pay for a date range
"""
import io
import csv
import uuid
from datetime import datetime, timezone, timedelta
from tz import now_ist, IST
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends, Query, Request
from fastapi.responses import StreamingResponse

from db import get_db
from auth import verify_pin, find_pin_matches, get_current_user, require_role
from routes.pos_devices import require_pos_device
from tenants import resolve_tenant_from_request, tenant_filter
from models import (
    TimePunch, TimePunchRequest, TimePunchManualEdit, TimesheetRow,
)

router = APIRouter()

OVERTIME_THRESHOLD_HOURS = 40.0


def _now_iso() -> str:
    return now_ist().isoformat()


def _parse(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=IST)
        return dt
    except Exception:
        return None


def _doc_to_punch(d: dict) -> dict:
    return {
        "id": d["id"],
        "user_id": d["user_id"],
        "user_name": d.get("user_name", ""),
        "type": d["type"],
        "at": d["at"],
        "source": d.get("source", "pin"),
        "location_id": d.get("location_id"),
        "device_id": d.get("device_id"),
        "selfie_b64": d.get("selfie_b64"),
        "note": d.get("note"),
    }


# ----- Public punch endpoint (no JWT — uses PIN + tenant header) -----
@router.post("/timeclock/punch", response_model=TimePunch)
async def punch(payload: TimePunchRequest, request: Request):
    db = get_db()
    tenant = await resolve_tenant_from_request(request, db)
    await require_pos_device(request, tenant, db)
    pin = (payload.pin or "").strip()
    if not (pin.isdigit() and len(pin) == 4):
        raise HTTPException(status_code=400, detail="PIN must be 4 digits")

    users = await db.users.find({"tenant_id": tenant["id"]}, {"_id": 0}).to_list(500)
    found = await find_pin_matches(db, tenant["id"], users, pin)
    matched = found[0] if found else None
    if not matched:
        raise HTTPException(status_code=401, detail="Unknown PIN")
    if matched.get("active") is False:
        raise HTTPException(status_code=403, detail="This employee is deactivated")

    # Auto-detect in/out by inspecting the most recent punch.
    last = await db.time_punches.find(
        {"tenant_id": tenant["id"], "user_id": matched["id"]},
        {"_id": 0},
    ).sort("at", -1).limit(1).to_list(1)
    next_type = "out" if last and last[0]["type"] == "in" else "in"

    doc = {
        "id": f"tp_{uuid.uuid4().hex[:10]}",
        "tenant_id": tenant["id"],
        "user_id": matched["id"],
        "user_name": matched["name"],
        "type": next_type,
        "at": _now_iso(),
        "source": "pin",
        "location_id": payload.location_id,
        "device_id": payload.device_id,
        "selfie_b64": (payload.selfie_b64 or None),
        "note": None,
    }
    await db.time_punches.insert_one(doc)
    return _doc_to_punch(doc)


# ----- Manager endpoints (JWT-protected) -----
@router.get("/timeclock/current")
async def currently_clocked_in(user: dict = Depends(require_role("Manager"))):
    """Return everyone whose most recent punch is `in`."""
    db = get_db()
    users = await db.users.find(tenant_filter(user), {"_id": 0, "pin_hash": 0}).to_list(500)
    result = []
    for u in users:
        last = await db.time_punches.find(
            tenant_filter(user, {"user_id": u["id"]}), {"_id": 0},
        ).sort("at", -1).limit(1).to_list(1)
        if last and last[0]["type"] == "in":
            result.append({
                "user_id": u["id"],
                "user_name": u["name"],
                "role": u["role"],
                "since": last[0]["at"],
                "punch_id": last[0]["id"],
                "selfie_b64": last[0].get("selfie_b64"),
            })
    result.sort(key=lambda x: x["since"])
    return result


@router.get("/timeclock/punches", response_model=List[TimePunch])
async def list_punches(
    user: dict = Depends(require_role("Manager")),
    user_id: Optional[str] = Query(None),
    since: Optional[str] = Query(None),
    until: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
):
    db = get_db()
    flt = tenant_filter(user)
    if user_id:
        flt["user_id"] = user_id
    if since or until:
        flt["at"] = {}
        if since:
            flt["at"]["$gte"] = since
        if until:
            flt["at"]["$lte"] = until
    docs = await db.time_punches.find(flt, {"_id": 0}).sort("at", -1).limit(limit).to_list(limit)
    return [_doc_to_punch(d) for d in docs]


@router.post("/timeclock/punches/{user_id}", response_model=TimePunch)
async def insert_manual_punch(
    user_id: str,
    payload: TimePunchManualEdit,
    user: dict = Depends(require_role("Manager")),
):
    db = get_db()
    target = await db.users.find_one(tenant_filter(user, {"id": user_id}), {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Employee not found")
    if not _parse(payload.at):
        raise HTTPException(status_code=400, detail="Invalid timestamp")
    doc = {
        "id": f"tp_{uuid.uuid4().hex[:10]}",
        "tenant_id": user["tenant_id"],
        "user_id": user_id,
        "user_name": target["name"],
        "type": payload.type,
        "at": payload.at,
        "source": "manual",
        "note": (payload.note or f"Manual entry by {user['name']}"),
    }
    await db.time_punches.insert_one(doc)
    return _doc_to_punch(doc)


@router.delete("/timeclock/punches/{punch_id}")
async def delete_punch(punch_id: str, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    res = await db.time_punches.delete_one(tenant_filter(user, {"id": punch_id}))
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Punch not found")
    return {"ok": True, "id": punch_id}


# ----- Timesheet aggregation -----
def _pair_punches(punches: list[dict]) -> list[tuple[datetime, datetime]]:
    """Walk a chronologically sorted list of punches and yield (in, out) pairs.
    Lone IN at the tail is closed at `now` so a currently-clocked-in worker
    still shows hours. Lone OUT (no matching IN) is ignored."""
    pairs: list[tuple[datetime, datetime]] = []
    current_in: Optional[datetime] = None
    for p in punches:
        ts = _parse(p["at"])
        if not ts:
            continue
        if p["type"] == "in":
            current_in = ts
        elif p["type"] == "out" and current_in is not None:
            if ts > current_in:
                pairs.append((current_in, ts))
            current_in = None
    if current_in is not None:
        pairs.append((current_in, now_ist()))
    return pairs


@router.get("/timeclock/timesheet", response_model=List[TimesheetRow])
async def timesheet(
    user: dict = Depends(require_role("Manager")),
    start: Optional[str] = Query(None, description="ISO start (inclusive)"),
    end: Optional[str] = Query(None, description="ISO end (exclusive)"),
):
    """Aggregate punches into per-employee total/overtime/gross-pay rows."""
    db = get_db()
    start_dt = _parse(start) or (now_ist() - timedelta(days=7))
    end_dt = _parse(end) or now_ist()

    users = await db.users.find(tenant_filter(user), {"_id": 0, "pin_hash": 0}).to_list(500)
    rows: list[dict] = []
    for u in users:
        punches = await db.time_punches.find(
            tenant_filter(user, {"user_id": u["id"], "at": {"$gte": start_dt.isoformat(), "$lt": end_dt.isoformat()}}),
            {"_id": 0},
        ).sort("at", 1).to_list(2000)
        pairs = _pair_punches(punches)
        total_seconds = sum((b - a).total_seconds() for a, b in pairs)
        total_hours = round(total_seconds / 3600.0, 2)
        ot = round(max(0.0, total_hours - OVERTIME_THRESHOLD_HOURS), 2)
        rate = float(u.get("hourly_rate") or 0)
        gross = round(total_hours * rate + ot * rate * 0.5, 2)  # 1.5x = base + 0.5x OT premium
        days = len({_parse(p["at"]).date().isoformat() for p in punches if _parse(p["at"])})
        rows.append({
            "user_id": u["id"],
            "user_name": u["name"],
            "role": u["role"],
            "hourly_rate": rate,
            "total_hours": total_hours,
            "overtime_hours": ot,
            "gross_pay": gross,
            "days_worked": days,
        })
    rows.sort(key=lambda r: r["user_name"])
    return rows


@router.get("/timeclock/timesheet.csv")
async def timesheet_csv(
    user: dict = Depends(require_role("Manager")),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
):
    rows = await timesheet(user=user, start=start, end=end)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["employee", "role", "hourly_rate", "total_hours", "overtime_hours", "gross_pay", "days_worked"])
    for r in rows:
        w.writerow([r["user_name"], r["role"], r["hourly_rate"], r["total_hours"], r["overtime_hours"], r["gross_pay"], r["days_worked"]])
    return StreamingResponse(
        iter([buf.getvalue().encode("utf-8")]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="kanda-timesheet.csv"'},
    )
