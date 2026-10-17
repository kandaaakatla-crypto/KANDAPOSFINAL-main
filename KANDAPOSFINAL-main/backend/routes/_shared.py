"""Shared helpers for route modules."""
from typing import Optional
from datetime import datetime

PROJECTION = {"_id": 0}

# Soft-delete convention (matches customers.py's pre-existing `deleted_at`
# pattern, extended to menu_items/categories for offline delta-sync
# tombstones): merge into a tenant_filter() extra dict to exclude trashed
# docs from any query that reads the full collection.
NOT_DELETED = {"$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}]}


def clean(doc: dict) -> dict:
    """Strip Mongo's `_id` before returning a doc over the wire. Also drops
    an order's delivery OTP / tracking token, which only the customer sees
    (via routes/tracking.py) — never staff or drivers."""
    doc.pop("_id", None)
    for k in ("deliveryOtp", "deliveryOtpFails", "trackingToken"):
        doc.pop(k, None)
    return doc


def table_doc_to_response(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "number": doc["number"],
        "seats": doc["seats"],
        "status": doc["status"],
        "orderId": doc.get("order_id"),
        # Layout-editor fields — preserve whatever's been saved.
        "x": doc.get("x", 0),
        "y": doc.get("y", 0),
        "width": doc.get("width", 80),
        "height": doc.get("height", 80),
        "shape": doc.get("shape", "square"),
        "rotation": doc.get("rotation", 0),
        "updated_at": doc.get("updated_at"),
    }


def menu_doc_to_response(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "catId": doc.get("cat_id"),
        "name": doc["name"],
        "desc": doc.get("desc"),
        "price": doc.get("price"),
        "sizes": doc.get("sizes"),
        "available": doc.get("available", True),
        "isPizza": doc.get("is_pizza", False),
        "dealGroups": doc.get("deal_groups"),
        "imageUrl": doc.get("image_url"),
        "barcode": doc.get("barcode"),
        "variants": doc.get("variants"),
        "tax_rate": doc.get("tax_rate"),
        "updated_at": doc.get("updated_at"),
        "deleted_at": doc.get("deleted_at"),
    }


async def next_order_number(db, tenant_id: str) -> int:
    res = await db.counters.find_one_and_update(
        {"_id": f"{tenant_id}:order_number"},
        {"$inc": {"seq": 1}},
        return_document=True,
        upsert=True,
    )
    return res["seq"]


def parse_placed_at(s: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None
