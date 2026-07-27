"""Kitchen Display System (KDS) — P3 feature for Kanda POS.

Design (chosen by user during planning):
- Hybrid tickets: one card per order, per-item checkboxes inside.
- Per-item station tags wired through menu categories. The station defaults
  to `kitchen` and items are routed using `CAT_STATION` below.
- Workflow lanes: new → preparing → ready → recall.
- Auth via long-lived `kds_token` stored on the tenant doc (rotatable by the
  Platform Owner). No staff PIN required, so kitchen tablets stay logged in.
- Visual + audio alerts on new tickets — handled client-side via the
  existing WebSocket fan-out (`kds.updated` events).
"""
import os
import secrets
import logging
from datetime import datetime, timezone, timedelta
from tz import now_ist
from typing import Optional, Literal, List

from fastapi import APIRouter, HTTPException, Request, Depends, Query
from pydantic import BaseModel, Field

from db import get_db
from ws import schedule_broadcast
from owners import get_current_owner
from auth import require_role

logger = logging.getLogger("kanda.kds")

kds_router = APIRouter(prefix="/kds")

# Categories → station mapping. Anything not listed defaults to `kitchen`.
CAT_STATION: dict[str, str] = {
    "pizzas": "pizza",
    "drinks": "drinks",
    "desserts": "desserts",
    "chicken": "grill",
    "burgers": "grill",
}
STATIONS = ("kitchen", "pizza", "grill", "drinks", "desserts")
RECALL_WINDOW_MIN = 5
ItemStatus = Literal["new", "preparing", "ready"]


def station_for_item_name(name: str, menu_lookup: dict[str, str]) -> str:
    """Best-effort station resolution. Pizza orders are sometimes serialised as
    `Pepperoni Passion 12"` so we strip the size suffix before lookup."""
    key = name.strip()
    if key in menu_lookup:
        return menu_lookup[key]
    # Strip size suffix like ' 12"', ' 15"', ' 9.5"'
    base = key.split('"')[0].rsplit(" ", 1)[0] if '"' in key else key
    if base in menu_lookup:
        return menu_lookup[base]
    # Fallback heuristics on the name itself
    lower = key.lower()
    if "pizza" in lower or '"' in key:
        return "pizza"
    if any(k in lower for k in ("coke", "fanta", "water", "drink")):
        return "drinks"
    if any(k in lower for k in ("cake", "ice cream", "cookie", "dessert", "fudge")):
        return "desserts"
    if any(k in lower for k in ("wing", "chicken", "burger", "wrap")):
        return "grill"
    return "kitchen"


async def annotate_order_items_for_kds(db, tenant_id: str, items: List[dict]) -> List[dict]:
    """Mutate-and-return: stamp `station` and `kds_status='new'` on each item.
    Called inside the create-order path so historical orders without these
    fields don't blow up the KDS later."""
    menu = await db.menu_items.find(
        {"tenant_id": tenant_id},
        {"_id": 0, "name": 1, "cat_id": 1},
    ).to_list(2000)
    lookup = {m["name"]: CAT_STATION.get(m.get("cat_id", ""), "kitchen") for m in menu}
    for it in items:
        it["station"] = station_for_item_name(it.get("name", ""), lookup)
        it.setdefault("kds_status", "new")
    return items


def _compute_lane(order: dict) -> str:
    """Pure lane derivation from item statuses. Recall always wins."""
    if order.get("kds_recalled_at"):
        # Stay in recall only for RECALL_WINDOW_MIN minutes.
        try:
            ts = datetime.fromisoformat(order["kds_recalled_at"].replace("Z", "+00:00"))
            if now_ist() - ts <= timedelta(minutes=RECALL_WINDOW_MIN):
                return "recall"
        except Exception:
            pass
    items = order.get("items", [])
    statuses = [it.get("kds_status", "new") for it in items]
    if not statuses:
        return "new"
    if all(s == "ready" for s in statuses):
        return "ready"
    if any(s == "preparing" for s in statuses) or any(s == "ready" for s in statuses):
        return "preparing"
    return "new"


def _kds_view(order: dict, station: Optional[str]) -> Optional[dict]:
    """Project the order doc into the KDS payload shape. Returns None if the
    order has no items matching the requested station (so the board stays clean)."""
    items_with_idx = list(enumerate(order.get("items", [])))
    if station and station != "all":
        items_with_idx = [(i, it) for i, it in items_with_idx if it.get("station") == station]
    if not items_with_idx:
        return None
    return {
        "id": order["id"],
        "number": order.get("number"),
        "type": order.get("type"),
        "table": order.get("table"),
        "customer_name": (order.get("customer") or {}).get("name", "—"),
        "placed_at": order.get("placedAt"),
        "lane": _compute_lane(order),
        "kds_recalled_at": order.get("kds_recalled_at"),
        "items": [
            {
                "index": i,
                "name": it.get("name"),
                "qty": it.get("qty", 1),
                "mods": it.get("mods", []),
                "station": it.get("station", "kitchen"),
                "kds_status": it.get("kds_status", "new"),
            }
            for i, it in items_with_idx
        ],
    }


# ------------------- Auth: long-lived KDS token -------------------
async def _tenant_from_token(token: str, db) -> dict:
    if not token:
        raise HTTPException(status_code=401, detail="KDS token required")
    tenant = await db.tenants.find_one({"kds_token": token}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=401, detail="Invalid KDS token")
    if tenant.get("status") == "suspended":
        raise HTTPException(status_code=402, detail="Tenant suspended")
    return tenant


async def kds_tenant(
    request: Request,
    token: Optional[str] = Query(default=None),
) -> dict:
    """Resolve tenant from the `token` query param or `X-KDS-Token` header."""
    db = get_db()
    tok = token or request.headers.get("X-KDS-Token", "")
    return await _tenant_from_token(tok, db)


# ------------------- KDS public routes -------------------
@kds_router.get("/tickets")
async def list_tickets(
    station: str = "all",
    tenant: dict = Depends(kds_tenant),
):
    if station != "all" and station not in STATIONS:
        raise HTTPException(status_code=400, detail=f"Unknown station '{station}'")
    db = get_db()
    # Only show orders from the last 12 hours that aren't completed or already on the road.
    cutoff = (now_ist() - timedelta(hours=12)).isoformat()
    cursor = db.orders.find(
        {
            "tenant_id": tenant["id"],
            "status": {"$nin": ["completed", "out-for-delivery"]},
            "placedAt": {"$gte": cutoff},
        },
        {"_id": 0},
    ).sort("placedAt", 1)
    raw = await cursor.to_list(500)
    # Resolve stations lazily for any pre-KDS orders that don't have the field yet.
    menu = await db.menu_items.find({"tenant_id": tenant["id"]}, {"_id": 0, "name": 1, "cat_id": 1}).to_list(2000)
    lookup = {m["name"]: CAT_STATION.get(m.get("cat_id", ""), "kitchen") for m in menu}
    for o in raw:
        for it in o.get("items", []):
            if not it.get("station"):
                it["station"] = station_for_item_name(it.get("name", ""), lookup)
            it.setdefault("kds_status", "new")
    out = []
    for o in raw:
        v = _kds_view(o, station if station != "all" else None)
        if v:
            out.append(v)
    return {
        "tenant": {"id": tenant["id"], "slug": tenant.get("slug"), "name": tenant.get("name")},
        "station": station,
        "stations": list(STATIONS),
        "tickets": out,
    }


@kds_router.get("/display")
async def customer_display(tenant: dict = Depends(kds_tenant)):
    """Public, no-auth feed for a customer-facing screen — collection/dine-in
    orders only, collapsed to a simple preparing/ready status. Reuses the
    same long-lived kds_token as the kitchen tablet."""
    db = get_db()
    cutoff = (now_ist() - timedelta(hours=6)).isoformat()
    cursor = db.orders.find(
        {
            "tenant_id": tenant["id"],
            "type": {"$in": ["collection", "dine-in"]},
            "status": {"$in": ["new", "in-kitchen", "ready"]},
            "voided": {"$ne": True},
            "placedAt": {"$gte": cutoff},
        },
        {"_id": 0, "number": 1, "type": 1, "status": 1, "table": 1, "customer": 1, "placedAt": 1},
    ).sort("placedAt", 1)
    raw = await cursor.to_list(200)
    orders = [{
        "number": o["number"],
        "type": o["type"],
        "table": o.get("table"),
        "name": (o.get("customer") or {}).get("name"),
        "status": "ready" if o["status"] == "ready" else "preparing",
    } for o in raw]
    return {"tenant": {"name": tenant.get("name")}, "orders": orders}


@kds_router.get("/packing")
async def packing_board(tenant: dict = Depends(kds_tenant)):
    """Public, no-auth feed for the packing station — every order that's
    ready for packing/collection, packed or not. Reuses the same long-lived
    kds_token as the kitchen tablet and customer display."""
    db = get_db()
    cutoff = (now_ist() - timedelta(hours=12)).isoformat()
    cursor = db.orders.find(
        {
            "tenant_id": tenant["id"],
            "status": "ready",
            "voided": {"$ne": True},
            "placedAt": {"$gte": cutoff},
        },
        {"_id": 0, "id": 1, "number": 1, "type": 1, "table": 1, "customer": 1, "items": 1, "packed": 1},
    ).sort("placedAt", 1)
    raw = await cursor.to_list(200)
    return {"tenant": {"name": tenant.get("name")}, "orders": raw}


class PackedPayload(BaseModel):
    packed: bool


@kds_router.patch("/packing/{order_id}/pack")
async def set_packed(order_id: str, payload: PackedPayload, tenant: dict = Depends(kds_tenant)):
    db = get_db()
    res = await db.orders.find_one_and_update(
        {"tenant_id": tenant["id"], "id": order_id},
        {"$set": {"packed": payload.packed}},
        return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Order not found")
    res.pop("_id", None)
    schedule_broadcast("order.upserted", res, tenant["id"])
    return {"id": res["id"], "packed": res.get("packed", False)}


class ItemStatusPayload(BaseModel):
    status: ItemStatus


@kds_router.patch("/orders/{order_id}/items/{item_index}")
async def update_item_status(
    order_id: str,
    item_index: int,
    payload: ItemStatusPayload,
    tenant: dict = Depends(kds_tenant),
):
    db = get_db()
    order = await db.orders.find_one({"tenant_id": tenant["id"], "id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    items = order.get("items") or []
    if item_index < 0 or item_index >= len(items):
        raise HTTPException(status_code=404, detail="Item not found")
    items[item_index]["kds_status"] = payload.status
    update = {"items": items, "kds_recalled_at": None}  # any item bump clears stale recall

    # Auto-promote the legacy `status` so the POS Orders screen reflects KDS progress.
    new_lane = _compute_lane({**order, "items": items, "kds_recalled_at": None})
    legacy = order.get("status")
    if new_lane == "ready" and legacy in ("new", "in-kitchen"):
        update["status"] = "ready"
    elif new_lane == "preparing" and legacy == "new":
        update["status"] = "in-kitchen"
    res = await db.orders.find_one_and_update(
        {"tenant_id": tenant["id"], "id": order_id},
        {"$set": update},
        return_document=True,
    )
    res.pop("_id", None)
    schedule_broadcast("kds.updated", {"orderId": order_id, "lane": new_lane}, tenant["id"])
    schedule_broadcast("order.upserted", res, tenant["id"])
    return _kds_view(res, None)


@kds_router.patch("/orders/{order_id}/recall")
async def recall_order(order_id: str, tenant: dict = Depends(kds_tenant)):
    db = get_db()
    now = now_ist().isoformat()
    res = await db.orders.find_one_and_update(
        {"tenant_id": tenant["id"], "id": order_id},
        {"$set": {"kds_recalled_at": now, "status": "in-kitchen"}},
        return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Order not found")
    res.pop("_id", None)
    schedule_broadcast("kds.updated", {"orderId": order_id, "lane": "recall"}, tenant["id"])
    return _kds_view(res, None)


# ------------------- Manager-facing: self-serve kiosk links -------------------
@kds_router.get("/my-token")
async def my_kds_token(user: dict = Depends(require_role("Manager"))):
    """Lets a tenant's own Manager fetch (and lazily create) their kiosk
    token without needing the Platform Owner — used for the KDS tablet URL
    and the customer-facing order-status display."""
    db = get_db()
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    token = tenant.get("kds_token")
    if not token:
        token = f"kds_{user['tenant_id']}_{secrets.token_urlsafe(24)}"
        await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"kds_token": token}})
    return {"token": token}


# ------------------- Owner-facing: KDS token management -------------------
owner_kds_router = APIRouter()  # mounted under /api/owner/tenants/{tenant_id}/...


@owner_kds_router.get("/kds-token")
async def get_kds_token(tenant_id: str, owner: dict = Depends(get_current_owner)):
    db = get_db()
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    token = tenant.get("kds_token")
    if not token:
        token = f"kds_{tenant_id}_{secrets.token_urlsafe(24)}"
        await db.tenants.update_one({"id": tenant_id}, {"$set": {"kds_token": token}})
    base = os.environ.get("PUBLIC_BASE_URL") or ""
    return {"token": token, "url": f"{base}/kds?token={token}", "stations": list(STATIONS)}


@owner_kds_router.post("/kds-token/rotate")
async def rotate_kds_token(tenant_id: str, owner: dict = Depends(get_current_owner)):
    db = get_db()
    token = f"kds_{tenant_id}_{secrets.token_urlsafe(24)}"
    res = await db.tenants.update_one({"id": tenant_id}, {"$set": {"kds_token": token}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Tenant not found")
    base = os.environ.get("PUBLIC_BASE_URL") or ""
    return {"token": token, "url": f"{base}/kds?token={token}"}
