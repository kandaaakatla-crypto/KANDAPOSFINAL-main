"""Aggregator surge / peak pricing rules — e.g. "+10% on Swiggy, always" or
"+5% on Swiggy and Zomato, Fri–Sun 19:00–23:00". A rule targets one
aggregator (separate) or several at once (combined); every active rule that
matches an order's source stacks, so a combined dinner peak on top of a
Swiggy-only markup adds both percentages.

Applied on the POS (frontend/src/utils/surge.js) when the cashier rings up
an order with an aggregator source, same trust model as day-part schedule
pricing: the surged line price is what's sent, with base_price/surge_pct
alongside it so the order records how much of the bill was surge.
"""
import uuid
from typing import List

from fastapi import APIRouter, HTTPException, Depends

from db import get_db
from auth import get_current_user, require_role
from tenants import tenant_filter
from tz import now_ist
from models import SurgeRule, SurgeRuleCreate, SurgeRuleUpdate
from ._shared import PROJECTION, NOT_DELETED, clean

router = APIRouter()


def _validate_window(days, start_time, end_time) -> None:
    if days is not None and any(d not in range(1, 8) for d in days):
        raise HTTPException(status_code=400, detail="days must be ISO weekdays 1 (Mon) to 7 (Sun)")
    if (start_time is None) != (end_time is None):
        raise HTTPException(status_code=400, detail="Set both a start and end time, or neither for all day")
    if start_time is not None and start_time == end_time:
        raise HTTPException(status_code=400, detail="Start and end time can't be the same")


@router.get("/pricing/surge-rules", response_model=List[SurgeRule])
async def list_surge_rules(user: dict = Depends(get_current_user)):
    db = get_db()
    return await db.surge_rules.find(tenant_filter(user, NOT_DELETED), PROJECTION).sort("name", 1).to_list(200)


@router.post("/pricing/surge-rules", response_model=SurgeRule)
async def create_surge_rule(payload: SurgeRuleCreate, user: dict = Depends(require_role("Manager"))):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Name is required")
    _validate_window(payload.days, payload.start_time, payload.end_time)
    db = get_db()
    doc = {
        "id": f"sr_{uuid.uuid4().hex[:8]}",
        "tenant_id": user["tenant_id"],
        "name": payload.name.strip(),
        "channels": sorted(set(payload.channels)),
        "pct": round(float(payload.pct), 2),
        "days": sorted(set(payload.days)),
        "start_time": payload.start_time,
        "end_time": payload.end_time,
        "active": payload.active,
        "updated_at": now_ist().isoformat(),
        "deleted_at": None,
    }
    await db.surge_rules.insert_one(doc)
    return clean(doc)


@router.put("/pricing/surge-rules/{rule_id}", response_model=SurgeRule)
async def update_surge_rule(rule_id: str, payload: SurgeRuleUpdate, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    existing = await db.surge_rules.find_one(tenant_filter(user, {"id": rule_id, **NOT_DELETED}), PROJECTION)
    if not existing:
        raise HTTPException(status_code=404, detail="Surge rule not found")
    update = payload.model_dump(exclude_none=True, exclude={"all_day"})
    if payload.all_day:
        update["start_time"] = None
        update["end_time"] = None
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    merged = {**existing, **update}
    _validate_window(merged.get("days"), merged.get("start_time"), merged.get("end_time"))
    if "name" in update:
        update["name"] = update["name"].strip()
        if not update["name"]:
            raise HTTPException(status_code=400, detail="Name is required")
    if "channels" in update:
        update["channels"] = sorted(set(update["channels"]))
    if "days" in update:
        update["days"] = sorted(set(update["days"]))
    if "pct" in update:
        update["pct"] = round(float(update["pct"]), 2)
    update["updated_at"] = now_ist().isoformat()
    res = await db.surge_rules.find_one_and_update(
        tenant_filter(user, {"id": rule_id, **NOT_DELETED}), {"$set": update}, projection=PROJECTION, return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Surge rule not found")
    return clean(res)


@router.delete("/pricing/surge-rules/{rule_id}")
async def delete_surge_rule(rule_id: str, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    now = now_ist().isoformat()
    res = await db.surge_rules.update_one(
        tenant_filter(user, {"id": rule_id, **NOT_DELETED}),
        {"$set": {"deleted_at": now, "updated_at": now}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Surge rule not found")
    return {"ok": True}
