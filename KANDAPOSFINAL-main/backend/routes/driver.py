"""Kanda Driver app endpoints — one feed with everything a delivery driver
needs, scoped to that driver, plus their on/off-duty switch.

The driver screen used to poll GET /orders (every order in the store, with
every customer's phone and address) and filter on the phone. This feed
returns only:
  - available: unclaimed delivery orders still to go out, with the customer
    name and address (so the driver can judge the run) but no phone number
    until they've claimed it;
  - active: this driver's deliveries that aren't completed yet;
  - completed: this driver's deliveries completed today (IST);
plus today's totals (deliveries, cash in hand, tips, delivery fees, average
pickup-to-door time), the store's pickup address/phone, and duty status.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from db import get_db
from tenants import tenant_filter
from tz import now_ist
from ._shared import PROJECTION

router = APIRouter()

_OPEN_STATUSES = ["new", "in-kitchen", "ready", "out-for-delivery"]


def require_driver(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "Driver":
        raise HTTPException(status_code=403, detail="Drivers only")
    return user


def owns_delivery(order: dict, user: dict) -> bool:
    """Whether `order` is this driver's. Matches on driver_id when the order
    has one (set by /orders/{id}/claim since the driver app), else on the
    display name — orders assigned from Dispatch only carry the name."""
    if order.get("driver_id"):
        return order["driver_id"] == user["id"]
    return bool(order.get("driver")) and order.get("driver") == user.get("name")


def _mine_filter(user: dict) -> dict:
    return {"$or": [
        {"driver_id": user["id"]},
        {"driver_id": None, "driver": user["name"]},
    ]}


def _minutes_between(a: Optional[str], b: Optional[str]) -> Optional[float]:
    try:
        return (datetime.fromisoformat(b) - datetime.fromisoformat(a)).total_seconds() / 60
    except (TypeError, ValueError):
        return None


def _without_phone(order: dict) -> dict:
    cust = dict(order.get("customer") or {})
    cust.pop("phone", None)
    cust.pop("email", None)
    cust.pop("gstin", None)
    out = dict(order)
    out["customer"] = cust
    out.pop("customer_email", None)
    return out


@router.get("/driver/feed")
async def driver_feed(user: dict = Depends(require_driver)):
    db = get_db()
    today = now_ist().date().isoformat()

    available = await db.orders.find(
        tenant_filter(user, {
            "type": "delivery", "driver": None, "voided": {"$ne": True},
            "status": {"$in": ["new", "in-kitchen", "ready"]},
        }),
        PROJECTION,
    ).sort("placedAt", 1).to_list(100)

    mine = await db.orders.find(
        tenant_filter(user, {"type": "delivery", **_mine_filter(user)}),
        PROJECTION,
    ).sort("placedAt", -1).to_list(300)

    active = [o for o in mine if o.get("status") in _OPEN_STATUSES and not o.get("voided")]
    active.sort(key=lambda o: o.get("placedAt") or "")
    completed = [
        o for o in mine
        if o.get("status") == "completed"
        and ((o.get("statusTimes") or {}).get("completed") or o.get("placedAt") or "")[:10] == today
    ]

    cash_in_hand = sum(float(o.get("total") or 0) for o in completed if o.get("payment") == "cash")
    tips = sum(float(o.get("tip") or 0) for o in completed)
    fees = sum(float(o.get("deliveryFee") or 0) for o in completed)
    durations = [
        m for m in (
            _minutes_between((o.get("statusTimes") or {}).get("out-for-delivery"),
                             (o.get("statusTimes") or {}).get("completed"))
            for o in completed
        ) if m is not None and m >= 0
    ]

    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "name": 1, "store": 1}) or {}
    store = tenant.get("store") or {}
    duty = await db.driver_duty.find_one({"tenant_id": user["tenant_id"], "user_id": user["id"]}, {"_id": 0}) or {}

    return {
        "driver": {"id": user["id"], "name": user["name"], "initials": user.get("initials")},
        "store": {
            "name": store.get("name") or tenant.get("name") or "",
            "address": store.get("address") or "",
            "phone": store.get("phone") or "",
        },
        "duty": {"online": bool(duty.get("online")), "since": duty.get("since")},
        "available": [_without_phone(o) for o in available],
        "active": active,
        "completed": completed,
        "stats": {
            "delivered": len(completed),
            "active": len(active),
            "available": len(available),
            "cashInHand": round(cash_in_hand, 2),
            "tips": round(tips, 2),
            "deliveryFees": round(fees, 2),
            "avgDeliveryMins": round(sum(durations) / len(durations)) if durations else None,
        },
    }


class DutyPayload(BaseModel):
    online: bool


@router.post("/driver/duty")
async def set_duty(payload: DutyPayload, user: dict = Depends(require_driver)):
    db = get_db()
    since = now_ist().isoformat() if payload.online else None
    await db.driver_duty.update_one(
        {"tenant_id": user["tenant_id"], "user_id": user["id"]},
        {"$set": {"online": payload.online, "since": since, "name": user["name"]}},
        upsert=True,
    )
    return {"online": payload.online, "since": since}
