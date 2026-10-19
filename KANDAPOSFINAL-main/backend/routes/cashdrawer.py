"""Cash drawer / Z-Report — open with float, close with counted cash, variance recorded."""
import uuid
from datetime import datetime, timedelta, timezone
from tz import now_ist
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends, Query

from db import get_db
from auth import require_role
from tenants import tenant_filter
from models import CashDrawer, CashDrawerOpen, CashDrawerClose

router = APIRouter()


def _now_iso() -> str:
    return now_ist().isoformat()


def _today() -> str:
    return now_ist().date().isoformat()


def _when(value: str) -> datetime:
    """Parse an ISO timestamp (browser "...Z" or IST "+05:30") to an aware
    datetime. Comparing these as strings is wrong across offsets."""
    dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def expected_cash_sales(orders: list, opened_at: str) -> float:
    """Cash taken since the drawer opened: cash orders (net of cash refunds)
    plus the cash portion of split payments; voided orders never count."""
    opened = _when(opened_at)
    total = 0.0
    for o in orders:
        if o.get("voided"):
            continue
        try:
            if _when(o.get("placedAt")) < opened:
                continue
        except (TypeError, ValueError):
            continue
        if o.get("payment") == "cash":
            total += float(o.get("total", 0)) - float(o.get("refunded_amount") or 0)
        elif o.get("payment") == "split":
            total += sum(float(s.get("amount", 0)) for s in (o.get("splits") or []) if s.get("method") == "cash")
    return round(total, 2)


def _doc(d: dict) -> dict:
    return {
        "id": d["id"], "date": d["date"],
        "opening_float": d["opening_float"],
        "counted_cash": d.get("counted_cash"),
        "expected_cash": d.get("expected_cash"),
        "variance": d.get("variance"),
        "opened_by": d["opened_by"],
        "closed_by": d.get("closed_by"),
        "opened_at": d["opened_at"],
        "closed_at": d.get("closed_at"),
        "notes": d.get("notes"),
        "status": d.get("status", "open"),
    }


@router.get("/cashdrawer/current", response_model=Optional[CashDrawer])
async def current(user: dict = Depends(require_role("Manager", "Cashier"))):
    db = get_db()
    doc = await db.cash_drawers.find_one(tenant_filter(user, {"status": "open"}), {"_id": 0})
    return _doc(doc) if doc else None


@router.post("/cashdrawer/open", response_model=CashDrawer)
async def open_drawer(payload: CashDrawerOpen, user: dict = Depends(require_role("Manager", "Cashier"))):
    db = get_db()
    if await db.cash_drawers.find_one(tenant_filter(user, {"status": "open"})):
        raise HTTPException(status_code=409, detail="A drawer is already open — close it first")
    doc = {
        "id": f"cd_{uuid.uuid4().hex[:10]}",
        "tenant_id": user["tenant_id"],
        "date": _today(),
        "opening_float": float(payload.opening_float),
        "opened_by": user["name"],
        "opened_at": _now_iso(),
        "status": "open",
        "notes": payload.notes,
    }
    await db.cash_drawers.insert_one(doc)
    return _doc(doc)


@router.post("/cashdrawer/close", response_model=CashDrawer)
async def close_drawer(payload: CashDrawerClose, user: dict = Depends(require_role("Manager", "Cashier"))):
    db = get_db()
    drawer = await db.cash_drawers.find_one(tenant_filter(user, {"status": "open"}), {"_id": 0})
    if not drawer:
        raise HTTPException(status_code=404, detail="No open drawer")
    # Expected cash = opening float + cash sales since drawer opened.
    # placedAt strings can be UTC or IST, so the DB filter is only a coarse
    # day-level prefilter (opened date minus a day); the exact cut-off is
    # applied on parsed datetimes.
    day_floor = (_when(drawer["opened_at"]) - timedelta(days=1)).date().isoformat()
    cash_orders = await db.orders.find(
        tenant_filter(user, {"payment": {"$in": ["cash", "split"]}, "placedAt": {"$gte": day_floor}}),
        {"_id": 0, "total": 1, "placedAt": 1, "payment": 1, "voided": 1, "refunded_amount": 1, "splits": 1},
    ).to_list(5000)
    cash_sales = expected_cash_sales(cash_orders, drawer["opened_at"])
    expected = round(float(drawer["opening_float"]) + cash_sales, 2)
    variance = round(float(payload.counted_cash) - expected, 2)
    updates = {
        "counted_cash": float(payload.counted_cash),
        "expected_cash": expected,
        "variance": variance,
        "closed_by": user["name"],
        "closed_at": _now_iso(),
        "status": "closed",
        "cash_sales": round(cash_sales, 2),
    }
    if payload.notes:
        updates["notes"] = (drawer.get("notes") or "") + ("\n" if drawer.get("notes") else "") + payload.notes
    await db.cash_drawers.update_one(tenant_filter(user, {"id": drawer["id"]}), {"$set": updates})
    drawer.update(updates)
    return _doc(drawer)


@router.get("/cashdrawer/history", response_model=List[CashDrawer])
async def history(user: dict = Depends(require_role("Manager")),
                  limit: int = Query(30, ge=1, le=200)):
    db = get_db()
    docs = await db.cash_drawers.find(tenant_filter(user), {"_id": 0}).sort("opened_at", -1).limit(limit).to_list(limit)
    return [_doc(d) for d in docs]
