"""Day-part menu schedules — e.g. "Breakfast" 07:00-11:00, or "Happy Hour"
17:00-19:00. Menu items reference a schedule (`schedule_id`) either to be
hidden outside the window (`schedule_only`) or to get a % discount while it's
active (`sale_discount_pct`). See `scheduling.py` for the shared time logic
consumed by both the POS menu API and the storefront checkout.
"""
import uuid
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends, Query

from db import get_db
from auth import get_current_user, require_role
from tenants import tenant_filter
from tz import now_ist
from models import MenuSchedule, MenuScheduleCreate, MenuScheduleUpdate
from ._shared import PROJECTION, NOT_DELETED, clean

router = APIRouter()


@router.get("/menu/schedules", response_model=List[MenuSchedule])
async def list_schedules(since: Optional[str] = Query(None), user: dict = Depends(get_current_user)):
    db = get_db()
    q = tenant_filter(user, {"updated_at": {"$gt": since}}) if since else tenant_filter(user, NOT_DELETED)
    docs = await db.menu_schedules.find(q, PROJECTION).sort("name", 1).to_list(100)
    return docs


@router.post("/menu/schedules", response_model=MenuSchedule)
async def create_schedule(payload: MenuScheduleCreate, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    doc = {
        "id": f"sch_{uuid.uuid4().hex[:8]}",
        "tenant_id": user["tenant_id"],
        "name": payload.name.strip(),
        "days": payload.days,
        "start_time": payload.start_time,
        "end_time": payload.end_time,
        "active": payload.active,
        "restrict_availability": payload.restrict_availability,
        "pricing_mode": payload.pricing_mode,
        "discount_pct": payload.discount_pct,
        "fixed_price": payload.fixed_price,
        "category_ids": payload.category_ids,
        "item_ids": payload.item_ids,
        "updated_at": now_ist().isoformat(),
        "deleted_at": None,
    }
    await db.menu_schedules.insert_one(doc)
    return clean(doc)


@router.put("/menu/schedules/{schedule_id}", response_model=MenuSchedule)
async def update_schedule(schedule_id: str, payload: MenuScheduleUpdate, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    update = payload.model_dump(exclude_none=True)
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    update["updated_at"] = now_ist().isoformat()
    res = await db.menu_schedules.find_one_and_update(
        tenant_filter(user, {"id": schedule_id}), {"$set": update}, return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return clean(res)


@router.delete("/menu/schedules/{schedule_id}")
async def delete_schedule(schedule_id: str, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    in_use = await db.menu_items.count_documents(tenant_filter(user, {"schedule_id": schedule_id}))
    if in_use:
        raise HTTPException(status_code=409, detail=f"{in_use} menu items use this schedule. Unlink them first.")
    res = await db.menu_schedules.update_one(
        tenant_filter(user, {"id": schedule_id, **NOT_DELETED}),
        {"$set": {"deleted_at": now_ist().isoformat(), "updated_at": now_ist().isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return {"ok": True}
