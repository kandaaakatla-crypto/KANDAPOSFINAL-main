"""Shared helpers for route modules."""
from typing import Optional
from datetime import datetime

PROJECTION = {"_id": 0}


def clean(doc: dict) -> dict:
    """Strip Mongo's `_id` before returning a doc over the wire."""
    doc.pop("_id", None)
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
