"""Tip pool — distribute tips by hours worked across staff on a given day."""
import uuid
from datetime import datetime, timezone, timedelta
from typing import List

from fastapi import APIRouter, HTTPException, Depends

from db import get_db
from auth import require_role
from tenants import tenant_filter
from models import TipPool, TipPoolCreate, TipAllocation

router = APIRouter()


def _parse(s: str) -> datetime:
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


@router.get("/tips", response_model=List[TipPool])
async def list_tips(user: dict = Depends(require_role("Manager")), limit: int = 60):
    db = get_db()
    docs = await db.tip_pools.find(tenant_filter(user), {"_id": 0}).sort("shift_date", -1).limit(limit).to_list(limit)
    return docs


@router.post("/tips", response_model=TipPool)
async def create_tip_pool(payload: TipPoolCreate, user: dict = Depends(require_role("Manager"))):
    if payload.total_pool < 0:
        raise HTTPException(status_code=400, detail="Tip pool must be non-negative")
    if len(payload.shift_date) != 10:
        raise HTTPException(status_code=400, detail="shift_date must be YYYY-MM-DD")
    db = get_db()
    day_start = _parse(payload.shift_date + "T00:00:00+00:00")
    day_end = day_start + timedelta(days=1)

    # Build hours-by-user from the time_punches on that day.
    user_filter: dict = {
        "at": {"$gte": day_start.isoformat(), "$lt": day_end.isoformat()},
    }
    if payload.user_ids:
        user_filter["user_id"] = {"$in": payload.user_ids}
    punches = await db.time_punches.find(
        tenant_filter(user, user_filter), {"_id": 0},
    ).sort("at", 1).to_list(2000)

    by_user: dict[str, list[dict]] = {}
    for p in punches:
        by_user.setdefault(p["user_id"], []).append(p)

    hours_by_user: dict[str, float] = {}
    for uid, pl in by_user.items():
        seconds = 0.0
        current_in = None
        for p in pl:
            ts = _parse(p["at"])
            if p["type"] == "in":
                current_in = ts
            elif p["type"] == "out" and current_in is not None:
                if ts > current_in:
                    seconds += (ts - current_in).total_seconds()
                current_in = None
        if seconds > 0:
            hours_by_user[uid] = round(seconds / 3600.0, 2)

    if not hours_by_user:
        raise HTTPException(status_code=400, detail="No clocked-in hours found for that date")

    total_hours = sum(hours_by_user.values())
    users = await db.users.find(tenant_filter(user), {"_id": 0, "pin_hash": 0}).to_list(500)
    name_by_id = {u["id"]: u["name"] for u in users}

    allocations: list[dict] = []
    running = 0.0
    items = list(hours_by_user.items())
    for i, (uid, hrs) in enumerate(items):
        if i == len(items) - 1:
            # Last allocation absorbs any rounding remainder.
            share = round(payload.total_pool - running, 2)
        else:
            share = round((hrs / total_hours) * payload.total_pool, 2)
            running += share
        allocations.append({
            "user_id": uid,
            "user_name": name_by_id.get(uid, uid),
            "hours": hrs,
            "share": share,
        })

    doc = {
        "id": f"tp_{uuid.uuid4().hex[:10]}",
        "tenant_id": user["tenant_id"],
        "shift_date": payload.shift_date,
        "total_pool": float(payload.total_pool),
        "allocations": allocations,
        "created_by": user["name"],
        "at": datetime.now(timezone.utc).isoformat(),
        "notes": payload.notes,
    }
    await db.tip_pools.insert_one(doc)
    return doc


@router.delete("/tips/{tip_id}")
async def delete_tip(tip_id: str, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    res = await db.tip_pools.delete_one(tenant_filter(user, {"id": tip_id}))
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Tip pool not found")
    return {"ok": True}
