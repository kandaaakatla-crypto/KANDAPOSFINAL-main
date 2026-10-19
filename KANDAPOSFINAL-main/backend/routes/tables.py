"""Tables + floor layout routes."""
import base64
import io
import os
import uuid
from typing import List, Optional

import qrcode
from fastapi import APIRouter, HTTPException, Depends, Query

from db import get_db
from auth import get_current_user, require_role
from tenants import tenant_filter, get_tenant
from tz import now_ist
from ws import schedule_broadcast
from models import Table, TableUpdate, TablePosition, TableCreate, FloorElement, FloorElementCreate, FloorElementUpdate
from ._shared import PROJECTION, clean, table_doc_to_response

router = APIRouter()


def _qr_response(url: str) -> dict:
    img = qrcode.make(url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return {"url": url, "qrPngBase64": base64.b64encode(buf.getvalue()).decode("ascii")}


@router.get("/tables", response_model=List[Table])
async def list_tables(since: Optional[str] = Query(None), user: dict = Depends(get_current_user)):
    db = get_db()
    # Self-heal: if a table is marked occupied but its linked order is completed / paid /
    # voided / missing, free it. Prevents "empty bill on occupied table" drift.
    stale = await db.tables.find(
        tenant_filter(user, {"status": "occupied", "order_id": {"$ne": None}}),
        {"_id": 0, "id": 1, "order_id": 1},
    ).to_list(500)
    for t in stale:
        o = await db.orders.find_one(
            tenant_filter(user, {"id": t["order_id"]}),
            {"_id": 0, "status": 1, "payment": 1, "voided": 1},
        )
        if not o or o.get("status") == "completed" or o.get("voided") or (o.get("payment") or "unpaid") != "unpaid":
            await db.tables.update_one(
                tenant_filter(user, {"id": t["id"]}),
                {"$set": {"status": "available", "order_id": None, "updated_at": now_ist().isoformat()}},
            )
    q = tenant_filter(user, {"updated_at": {"$gt": since}}) if since else tenant_filter(user)
    docs = await db.tables.find(q, PROJECTION).sort("number", 1).to_list(200)
    return [table_doc_to_response(d) for d in docs]


@router.patch("/tables/{table_id}", response_model=Table)
async def update_table(table_id: str, payload: TableUpdate, user: dict = Depends(get_current_user)):
    db = get_db()
    update = {"status": payload.status, "updated_at": now_ist().isoformat()}
    if payload.status == "available":
        update["order_id"] = None
    elif payload.orderId is not None:
        update["order_id"] = payload.orderId
    res = await db.tables.find_one_and_update(
        tenant_filter(user, {"id": table_id}), {"$set": update}, return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Table not found")
    response = table_doc_to_response(clean(res))
    schedule_broadcast("table.updated", response, user["tenant_id"])
    return response


@router.post("/tables", response_model=Table)
async def create_table(payload: TableCreate, user: dict = Depends(require_role("Manager"))):
    """Add a new table (used by the layout editor)."""
    db = get_db()
    exists = await db.tables.find_one(tenant_filter(user, {"number": payload.number}), PROJECTION)
    if exists:
        raise HTTPException(status_code=409, detail=f"Table {payload.number} already exists")
    doc = {
        "id": f"t_{uuid.uuid4().hex[:8]}",
        "tenant_id": user["tenant_id"],
        "number": payload.number,
        "seats": payload.seats,
        "status": "available",
        "order_id": None,
        "x": payload.x, "y": payload.y,
        "width": payload.width, "height": payload.height,
        "shape": payload.shape, "rotation": payload.rotation,
        "updated_at": now_ist().isoformat(),
    }
    await db.tables.insert_one(doc)
    return table_doc_to_response(clean(doc))


@router.delete("/tables/{table_id}")
async def delete_table(table_id: str, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    res = await db.tables.delete_one(tenant_filter(user, {"id": table_id}))
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Table not found")
    return {"ok": True}


@router.patch("/tables/{table_id}/position", response_model=Table)
async def update_position(table_id: str, payload: TablePosition, user: dict = Depends(require_role("Manager"))):
    """Save a table's layout-editor coordinates + shape."""
    db = get_db()
    update = payload.model_dump(exclude_none=True)
    update["updated_at"] = now_ist().isoformat()
    res = await db.tables.find_one_and_update(
        tenant_filter(user, {"id": table_id}),
        {"$set": update},
        return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Table not found")
    response = table_doc_to_response(clean(res))
    schedule_broadcast("table.updated", response, user["tenant_id"])
    return response


# -------------------- QR ordering codes --------------------
@router.get("/tables/{table_id}/qr")
async def table_qr(table_id: str, user: dict = Depends(require_role("Manager"))):
    """QR code linking to the customer-facing table-ordering page, table
    pre-selected — print this and stick it on the table."""
    db = get_db()
    table = await db.tables.find_one(tenant_filter(user, {"id": table_id}), PROJECTION)
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    tenant = await get_tenant(user, db)
    base = os.environ.get("PUBLIC_BASE_URL") or ""
    url = f"{base}/order/{tenant.get('slug')}/table/{table['number']}"
    return _qr_response(url)


@router.get("/tables/pickup-qr")
async def pickup_qr(user: dict = Depends(require_role("Manager"))):
    """QR code linking to the customer-facing pickup-ordering page (name +
    phone, OTP-verified) — print this near the counter / on takeaway bags."""
    db = get_db()
    tenant = await get_tenant(user, db)
    base = os.environ.get("PUBLIC_BASE_URL") or ""
    url = f"{base}/order/{tenant.get('slug')}/pickup"
    return _qr_response(url)


# -------------------- Floor elements (walls, room labels) --------------------
@router.get("/tables/floor", response_model=List[FloorElement])
async def list_floor_elements(user: dict = Depends(get_current_user)):
    db = get_db()
    docs = await db.floor_elements.find(tenant_filter(user), PROJECTION).to_list(200)
    return docs


@router.post("/tables/floor", response_model=FloorElement)
async def create_floor_element(payload: FloorElementCreate, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    doc = {
        "id": f"fe_{uuid.uuid4().hex[:8]}",
        "tenant_id": user["tenant_id"],
        **payload.model_dump(),
    }
    await db.floor_elements.insert_one(doc)
    return clean(doc)


@router.patch("/tables/floor/{fe_id}", response_model=FloorElement)
async def update_floor_element(fe_id: str, payload: FloorElementUpdate, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    update = payload.model_dump(exclude_none=True)
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    res = await db.floor_elements.find_one_and_update(
        tenant_filter(user, {"id": fe_id}), {"$set": update}, return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Floor element not found")
    return clean(res)


@router.delete("/tables/floor/{fe_id}")
async def delete_floor_element(fe_id: str, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    res = await db.floor_elements.delete_one(tenant_filter(user, {"id": fe_id}))
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Floor element not found")
    return {"ok": True}
