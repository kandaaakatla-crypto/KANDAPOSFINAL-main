"""Pause online orders — the owner's "kitchen is slammed" switch.

While a store is paused, new customer-placed orders from the QR pickup page
and unpaid orders from the store's own website are refused with 409, so the
customer sees the store as busy instead of the kitchen drowning. A website
order the customer has already paid for is still accepted: refusing it would
leave money taken with no order behind it. Dine-in QR orders from customers
already seated are not affected.

The pause is a single `online_paused_until` field on the tenant: an ISO
timestamp for a timed pause (it lifts itself once that time passes — no
background job), or "closed" for "until I reopen".
"""
from datetime import datetime, timedelta
from typing import Literal, Optional, Union

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import require_role
from db import get_db
from tz import now_ist

router = APIRouter()

UNTIL_REOPENED = "closed"
PAUSED_DETAIL = "This store isn't taking online orders right now. Please try again shortly."


class OnlinePauseUpdate(BaseModel):
    # minutes=None (sent explicitly) pauses until reopened; resume lifts it.
    minutes: Optional[Literal[15, 30, 60, 120]] = None
    resume: bool = False


class OnlinePauseState(BaseModel):
    paused: bool
    until: Optional[str] = None  # ISO time a timed pause ends; None = until reopened (or not paused)


def pause_state(tenant: dict) -> OnlinePauseState:
    raw: Union[str, None] = tenant.get("online_paused_until")
    if not raw:
        return OnlinePauseState(paused=False)
    if raw == UNTIL_REOPENED:
        return OnlinePauseState(paused=True)
    try:
        until = datetime.fromisoformat(raw)
    except ValueError:
        return OnlinePauseState(paused=False)
    if until.tzinfo is None:
        until = until.replace(tzinfo=now_ist().tzinfo)
    if until <= now_ist():
        return OnlinePauseState(paused=False)
    return OnlinePauseState(paused=True, until=raw)


def assert_taking_online_orders(tenant: dict) -> None:
    if pause_state(tenant).paused:
        raise HTTPException(status_code=409, detail=PAUSED_DETAIL)


@router.get("/tenant/online-pause", response_model=OnlinePauseState)
async def get_online_pause(user: dict = Depends(require_role("Manager"))):
    tenant = await get_db().tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "online_paused_until": 1})
    return pause_state(tenant or {})


@router.put("/tenant/online-pause", response_model=OnlinePauseState)
async def set_online_pause(payload: OnlinePauseUpdate, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    if payload.resume:
        await db.tenants.update_one({"id": user["tenant_id"]}, {"$unset": {"online_paused_until": ""}})
        return OnlinePauseState(paused=False)
    value = UNTIL_REOPENED if payload.minutes is None else (now_ist() + timedelta(minutes=payload.minutes)).isoformat()
    res = await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"online_paused_until": value}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return pause_state({"online_paused_until": value})
