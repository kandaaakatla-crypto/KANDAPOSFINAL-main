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
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from push import send_push

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


_PRIVATE = ("deliveryOtp", "deliveryOtpFails", "trackingToken")


def _for_driver(order: dict) -> dict:
    """What a driver may see of their own order: everything but the
    customer's OTP and tracking token, plus whether completing it needs the
    OTP (true only when the customer was actually sent one)."""
    from .tracking import otp_required
    out = {k: v for k, v in order.items() if k not in _PRIVATE}
    out["otpRequired"] = otp_required(order)
    return out


def _without_phone(order: dict) -> dict:
    out = _for_driver(order)
    cust = dict(out.get("customer") or {})
    cust.pop("phone", None)
    cust.pop("email", None)
    cust.pop("gstin", None)
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
    duty = await db.driver_duty.find_one({"tenant_id": user["tenant_id"], "user_id": user["id"]},
                                         {"_id": 0, "online": 1, "since": 1}) or {}

    return {
        "driver": {"id": user["id"], "name": user["name"], "initials": user.get("initials")},
        "store": {
            "name": store.get("name") or tenant.get("name") or "",
            "address": store.get("address") or "",
            "phone": store.get("phone") or "",
        },
        "duty": {"online": bool(duty.get("online")), "since": duty.get("since")},
        "available": [_without_phone(o) for o in available],
        "active": [_for_driver(o) for o in active],
        "completed": [_for_driver(o) for o in completed],
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


class LocationPayload(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy: Optional[float] = None
    heading: Optional[float] = None
    speed: Optional[float] = None


@router.post("/driver/location")
async def update_location(payload: LocationPayload, user: dict = Depends(require_driver)):
    """The driver app posts its GPS fix here every few seconds while the
    driver is online. Only the latest fix is kept; customers' tracking pages
    read it for orders this driver has out for delivery."""
    db = get_db()
    doc = {**payload.model_dump(), "at": now_ist().isoformat(), "name": user["name"]}
    await db.driver_locations.update_one(
        {"tenant_id": user["tenant_id"], "user_id": user["id"]}, {"$set": doc}, upsert=True,
    )
    return {"ok": True}


class PushTokenPayload(BaseModel):
    token: str = Field(min_length=10, max_length=4096)


@router.post("/driver/push-token")
async def register_push_token(payload: PushTokenPayload, user: dict = Depends(require_driver)):
    """FCM registration token from the Kanda Driver app on this phone. One
    per driver: signing in on a new phone replaces the old one, and the
    token is taken off any other driver who had it (a shared phone)."""
    db = get_db()
    await db.driver_duty.update_many(
        {"push_token": payload.token, "user_id": {"$ne": user["id"]}}, {"$set": {"push_token": None}},
    )
    await db.driver_duty.update_one(
        {"tenant_id": user["tenant_id"], "user_id": user["id"]},
        {"$set": {"push_token": payload.token, "name": user["name"]}}, upsert=True,
    )
    return {"ok": True}


async def notify_drivers_new_delivery(db, order: dict) -> int:
    """Push "new delivery" to every on-duty driver of the store with a
    registered phone. Called when a delivery is placed or turns ready with
    no driver. Never raises."""
    try:
        rows = await db.driver_duty.find(
            {"tenant_id": order["tenant_id"], "online": True, "push_token": {"$nin": [None, ""]}},
            {"_id": 0, "push_token": 1},
        ).to_list(200)
        if not rows:
            return 0
        area = (order.get("customer") or {}).get("address") or ""
        ready = order.get("status") == "ready"
        title = f"New delivery #{order.get('number')}" + (" · ready for pickup" if ready else "")
        body = (area[:80] + " · " if area else "") + ("Collect cash" if order.get("payment") == "unpaid" else "Prepaid")
        return await send_push([r["push_token"] for r in rows], title, body,
                               {"orderId": order.get("id"), "kind": "new-delivery"})
    except Exception:  # noqa: BLE001
        return 0


@router.post("/driver/orders/{order_id}/resend-tracking")
async def resend_tracking(order_id: str, user: dict = Depends(require_driver)):
    """Driver at the door, customer says they never got the link/OTP: send
    it again. At most once a minute per order."""
    from .tracking import ensure_tracking, notify_customer
    db = get_db()
    order = await db.orders.find_one(tenant_filter(user, {"id": order_id}), PROJECTION)
    if not order or order.get("type") != "delivery" or not owns_delivery(order, user):
        raise HTTPException(status_code=404, detail="Delivery not found")
    if order.get("status") != "out-for-delivery":
        raise HTTPException(status_code=409, detail="Only for orders out for delivery")
    last = (order.get("trackingNotified") or {}).get("at")
    try:
        if last and now_ist() - datetime.fromisoformat(last) < timedelta(seconds=60):
            raise HTTPException(status_code=429, detail="Sent less than a minute ago. Give it a moment.")
    except (TypeError, ValueError):
        pass
    order = await ensure_tracking(db, order)
    result = await notify_customer(db, order)
    return {"ok": result["ok"], "channel": result.get("channel"), "error": result.get("error")}
