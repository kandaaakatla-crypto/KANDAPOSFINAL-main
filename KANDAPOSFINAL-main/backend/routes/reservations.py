"""Reservations — book a table for a future time slot."""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends, Query

from db import get_db
from auth import get_current_user
from tenants import tenant_filter
from models import Reservation, ReservationCreate, ReservationUpdate
from ._shared import PROJECTION, clean

router = APIRouter()


@router.get("/reservations", response_model=List[Reservation])
async def list_reservations(
    user: dict = Depends(get_current_user),
    from_at: Optional[str] = Query(default=None),
    to_at: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
):
    db = get_db()
    q = tenant_filter(user)
    if status:
        q["status"] = status
    if from_at:
        q.setdefault("at", {})["$gte"] = from_at
    if to_at:
        q.setdefault("at", {})["$lte"] = to_at
    docs = await db.reservations.find(q, PROJECTION).sort("at", 1).to_list(500)
    return docs


@router.post("/reservations", response_model=Reservation)
async def create_reservation(payload: ReservationCreate, user: dict = Depends(get_current_user)):
    db = get_db()
    tbl = await db.tables.find_one(tenant_filter(user, {"id": payload.table_id}), PROJECTION)
    if not tbl:
        raise HTTPException(status_code=404, detail="Table not found")

    # Overlap guard: pull every active reservation for this table within a wide
    # bracket around the requested slot, then compare actual time-windows.
    from datetime import timedelta
    try:
        new_start = datetime.fromisoformat(payload.at.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid `at` datetime")
    new_end = new_start + timedelta(minutes=payload.duration_min)
    lo = (new_start - timedelta(hours=12)).isoformat()
    hi = (new_start + timedelta(hours=12)).isoformat()
    candidates = await db.reservations.find(
        tenant_filter(user, {
            "table_id": payload.table_id,
            "status": {"$in": ["booked", "seated"]},
            "at": {"$gte": lo, "$lte": hi},
        }),
        PROJECTION,
    ).to_list(50)
    for ex in candidates:
        try:
            ex_start = datetime.fromisoformat(ex["at"].replace("Z", "+00:00"))
        except Exception:
            continue
        ex_end = ex_start + timedelta(minutes=ex.get("duration_min", 90))
        if new_start < ex_end and ex_start < new_end:
            raise HTTPException(status_code=409, detail=f"Table already reserved at {ex['at']}")

    doc = {
        "id": f"rv_{uuid.uuid4().hex[:8]}",
        "tenant_id": user["tenant_id"],
        "table_id": payload.table_id,
        "customer_name": payload.customer_name,
        "phone": payload.phone,
        "party_size": payload.party_size,
        "at": payload.at,
        "duration_min": payload.duration_min,
        "notes": payload.notes or "",
        "created_by": user.get("id"),
        "status": "booked",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.reservations.insert_one(doc)
    return clean(doc)


@router.patch("/reservations/{res_id}", response_model=Reservation)
async def update_reservation(res_id: str, payload: ReservationUpdate, user: dict = Depends(get_current_user)):
    db = get_db()
    update = payload.model_dump(exclude_none=True)
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    res = await db.reservations.find_one_and_update(
        tenant_filter(user, {"id": res_id}), {"$set": update}, return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Reservation not found")
    return clean(res)


@router.delete("/reservations/{res_id}")
async def delete_reservation(res_id: str, user: dict = Depends(get_current_user)):
    db = get_db()
    res = await db.reservations.delete_one(tenant_filter(user, {"id": res_id}))
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Reservation not found")
    return {"ok": True}
