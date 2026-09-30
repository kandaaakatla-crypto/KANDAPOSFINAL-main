"""Inventory routes — list + create/update/delete + adjust + reorder."""
import io
import uuid
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse

from db import get_db
from auth import get_current_user, require_role
from tenants import tenant_filter, get_tenant
from tz import now_ist
from ws import schedule_broadcast
from models import InventoryItem, InventoryItemCreate, InventoryItemUpdate, AdjustStockPayload, StockTransfer, StockTransferCreate
from email_service import send_email, purchase_order_email
from ._shared import PROJECTION, NOT_DELETED, clean

router = APIRouter()


@router.get("/inventory", response_model=List[InventoryItem])
async def list_inventory(since: Optional[str] = Query(None), user: dict = Depends(get_current_user)):
    db = get_db()
    q = tenant_filter(user, {"updated_at": {"$gt": since}}) if since else tenant_filter(user, NOT_DELETED)
    docs = await db.inventory.find(q, PROJECTION).to_list(500)
    return docs


@router.post("/inventory", response_model=InventoryItem)
async def create_inventory(payload: InventoryItemCreate, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    doc = {
        "id": f"i_{uuid.uuid4().hex[:8]}", "tenant_id": user["tenant_id"], **payload.model_dump(),
        "updated_at": now_ist().isoformat(), "deleted_at": None,
    }
    await db.inventory.insert_one(doc)
    cleaned = clean(doc)
    schedule_broadcast("inventory.updated", {"item": cleaned, "low": cleaned["stock"] <= cleaned["reorder"]}, user["tenant_id"])
    return cleaned


@router.patch("/inventory/{item_id}", response_model=InventoryItem)
async def update_inventory(item_id: str, payload: InventoryItemUpdate, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        item = await db.inventory.find_one(tenant_filter(user, {"id": item_id}), PROJECTION)
        if not item:
            raise HTTPException(status_code=404, detail="Inventory item not found")
        return clean(item)
    updates["updated_at"] = now_ist().isoformat()
    res = await db.inventory.find_one_and_update(
        tenant_filter(user, {"id": item_id}), {"$set": updates}, return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    cleaned = clean(res)
    schedule_broadcast("inventory.updated", {"item": cleaned, "low": cleaned["stock"] <= cleaned["reorder"]}, user["tenant_id"])
    return cleaned


@router.delete("/inventory/{item_id}")
async def delete_inventory(item_id: str, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    res = await db.inventory.update_one(
        tenant_filter(user, {"id": item_id, **NOT_DELETED}),
        {"$set": {"deleted_at": now_ist().isoformat(), "updated_at": now_ist().isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    return {"ok": True}


@router.patch("/inventory/{item_id}/adjust", response_model=InventoryItem)
async def adjust_inventory(item_id: str, payload: AdjustStockPayload, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    item = await db.inventory.find_one(tenant_filter(user, {"id": item_id}), PROJECTION)
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    new_stock = max(0.0, round((item["stock"] + payload.delta) * 10) / 10)
    res = await db.inventory.find_one_and_update(
        tenant_filter(user, {"id": item_id}), {"$set": {"stock": new_stock, "updated_at": now_ist().isoformat()}}, return_document=True,
    )
    cleaned = clean(res)
    schedule_broadcast(
        "inventory.updated",
        {"item": cleaned, "low": cleaned["stock"] <= cleaned["reorder"]},
        user["tenant_id"],
    )
    return cleaned


async def _log_transfer(db, tenant_id: str, item_name: str, unit: str, qty: float,
                         from_location_id: Optional[str], to_location_id: Optional[str],
                         source: str, note: Optional[str], user: dict) -> dict:
    doc = {
        "id": f"xfer_{uuid.uuid4().hex[:10]}",
        "tenant_id": tenant_id,
        "item_name": item_name,
        "unit": unit,
        "qty": qty,
        "from_location_id": from_location_id,
        "to_location_id": to_location_id,
        "source": source,
        "note": note,
        "by_user_id": user.get("id"),
        "by_user_name": user.get("name"),
        "at": now_ist().isoformat(),
    }
    await db.stock_transfers.insert_one(doc)
    return clean(dict(doc))


@router.get("/inventory/transfers", response_model=List[StockTransfer])
async def list_transfers(user: dict = Depends(get_current_user)):
    db = get_db()
    return await db.stock_transfers.find(tenant_filter(user), PROJECTION).sort("at", -1).to_list(500)


@router.post("/inventory/{item_id}/transfer")
async def transfer_stock(item_id: str, payload: StockTransferCreate, user: dict = Depends(require_role("Manager"))):
    """Move stock from one location to another within this tenant. The
    destination is a *separate* inventory doc for the same item name — one
    doc per (name, location) pair — auto-created if this is the first stock
    that location has ever held of this item."""
    db = get_db()
    if payload.qty <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be positive")
    src = await db.inventory.find_one(tenant_filter(user, {"id": item_id}), PROJECTION)
    if not src:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    if src.get("location_id") == payload.to_location_id:
        raise HTTPException(status_code=400, detail="Source and destination are the same location")
    if src["stock"] < payload.qty:
        raise HTTPException(status_code=400, detail=f"Only {src['stock']} {src['unit']} available to transfer")

    await db.inventory.update_one(
        tenant_filter(user, {"id": item_id}), {"$inc": {"stock": -payload.qty}, "$set": {"updated_at": now_ist().isoformat()}},
    )
    dest = await db.inventory.find_one(
        tenant_filter(user, {"name": src["name"], "location_id": payload.to_location_id}), PROJECTION,
    )
    if dest:
        dest = await db.inventory.find_one_and_update(
            tenant_filter(user, {"id": dest["id"]}),
            {"$inc": {"stock": payload.qty}, "$set": {"updated_at": now_ist().isoformat()}},
            return_document=True,
        )
    else:
        dest = {
            "id": f"i_{uuid.uuid4().hex[:8]}", "tenant_id": user["tenant_id"],
            "name": src["name"], "unit": src["unit"], "stock": payload.qty,
            "reorder": src.get("reorder", 0), "supplier": src.get("supplier", ""),
            "cost_per_unit": src.get("cost_per_unit", 0.0), "expiry_date": None,
            "location_id": payload.to_location_id,
            "updated_at": now_ist().isoformat(), "deleted_at": None,
        }
        await db.inventory.insert_one(dest)

    transfer = await _log_transfer(
        db, user["tenant_id"], src["name"], src["unit"], payload.qty,
        src.get("location_id"), payload.to_location_id, "location", payload.note, user,
    )
    src_after = await db.inventory.find_one(tenant_filter(user, {"id": item_id}), PROJECTION)
    schedule_broadcast("inventory.updated", {"item": clean(src_after), "low": src_after["stock"] <= src_after["reorder"]}, user["tenant_id"])
    schedule_broadcast("inventory.updated", {"item": clean(dict(dest)), "low": dest["stock"] <= dest["reorder"]}, user["tenant_id"])
    return {"ok": True, "transfer": transfer, "source": clean(src_after), "destination": clean(dict(dest))}


@router.post("/inventory/{item_id}/reorder")
async def reorder_inventory(item_id: str, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    item = await db.inventory.find_one(tenant_filter(user, {"id": item_id}), PROJECTION)
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    qty_ordered = item["reorder"] * 2
    new_stock = item["stock"] + qty_ordered
    res = await db.inventory.find_one_and_update(
        tenant_filter(user, {"id": item_id}), {"$set": {"stock": new_stock, "updated_at": now_ist().isoformat()}}, return_document=True,
    )
    cleaned = clean(res)
    schedule_broadcast("inventory.updated", {"item": cleaned, "low": False}, user["tenant_id"])

    # Best-effort supplier notification — never blocks the reorder itself.
    supplier_emailed = False
    supplier_email = None
    supplier_name = (item.get("supplier") or "").strip()
    if supplier_name:
        supplier = await db.suppliers.find_one(
            tenant_filter(user, {"name": {"$regex": f"^{supplier_name}$", "$options": "i"}}), PROJECTION,
        )
        if supplier and supplier.get("email"):
            supplier_email = supplier["email"]
            tenant = await get_tenant(user, db)
            subject, html = purchase_order_email(item, tenant, qty_ordered)
            result = await send_email(supplier_email, subject, html)
            supplier_emailed = not result.get("error") and not result.get("skipped")

    return {**cleaned, "supplier_emailed": supplier_emailed, "supplier_email": supplier_email}


def _render_po_pdf(item: dict, supplier: Optional[dict], store_name: str, qty: float, po_no: str) -> bytes:
    """One-page portrait purchase order — same visual style as the tax
    invoice (receipts.py) and rota PDF (routes/shifts.py). Generated
    on demand from current inventory state rather than a persisted PO
    record — there's no separate purchase_orders collection (yet)."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.enums import TA_LEFT, TA_RIGHT
    from receipts import _invoice_fonts

    font, font_bold = _invoice_fonts()  # Helvetica has no ₹ glyph
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=15 * mm, rightMargin=15 * mm,
        topMargin=15 * mm, bottomMargin=15 * mm,
        title=f"Purchase Order — {item['name']}",
    )
    styles = getSampleStyleSheet()
    sub_st = ParagraphStyle("sub", parent=styles["Normal"], fontSize=9, leading=13, textColor=colors.HexColor("#666666"))
    right_st = ParagraphStyle("right", parent=styles["Normal"], fontSize=10, leading=14, alignment=TA_RIGHT, textColor=colors.HexColor("#111111"))
    label_st = ParagraphStyle("label", parent=styles["Normal"], fontSize=9, leading=13, textColor=colors.HexColor("#666666"))

    supplier_block = f"<b>To</b><br/>{supplier['name']}" if supplier else f"<b>To</b><br/>{item.get('supplier') or 'Supplier not on file'}"
    if supplier and supplier.get("email"):
        supplier_block += f"<br/>{supplier['email']}"
    if supplier and supplier.get("phone"):
        supplier_block += f"<br/>{supplier['phone']}"

    header = Table([[
        Paragraph(f"<b>{store_name}</b><br/>Purchase order", sub_st),
        Paragraph(f"<b>PURCHASE ORDER</b><br/>PO No: {po_no}<br/>Date: {now_ist().strftime('%Y-%m-%d')}", right_st),
    ]], colWidths=[100 * mm, 75 * mm])
    header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story = [header, Spacer(1, 6 * mm), Paragraph(supplier_block, label_st), Spacer(1, 8 * mm)]

    cost = float(item.get("cost_per_unit") or 0)
    rows = [
        ["Item", "Unit", "Qty ordered", "Est. cost/unit", "Est. total"],
        [item["name"], item["unit"], f"{qty:g}", f"₹{cost:.2f}", f"₹{cost * qty:.2f}"],
    ]
    tbl = Table(rows, colWidths=[65 * mm, 25 * mm, 30 * mm, 30 * mm, 25 * mm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111111")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), font),
        ("FONTNAME", (0, 0), (-1, 0), font_bold),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("GRID", (0, 1), (-1, -1), 0.25, colors.HexColor("#e6e6e6")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 10 * mm))
    story.append(Paragraph(
        "Please confirm receipt of this order and expected delivery date. "
        "Estimated cost is based on the last recorded unit cost and may vary.",
        sub_st,
    ))
    story.append(Paragraph("This is a computer-generated purchase order.", sub_st))

    doc.build(story)
    return buf.getvalue()


@router.get("/inventory/{item_id}/reorder.pdf")
async def reorder_pdf(
    item_id: str,
    qty: Optional[float] = Query(None, description="Quantity to order — defaults to 2× the reorder level, same as the Reorder action"),
    user: dict = Depends(require_role("Manager")),
):
    db = get_db()
    item = await db.inventory.find_one(tenant_filter(user, {"id": item_id}), PROJECTION)
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    supplier = None
    supplier_name = (item.get("supplier") or "").strip()
    if supplier_name:
        supplier = await db.suppliers.find_one(
            tenant_filter(user, {"name": {"$regex": f"^{supplier_name}$", "$options": "i"}}), PROJECTION,
        )
    tenant = await get_tenant(user, db)
    store_name = (tenant.get("store") or {}).get("name") or tenant.get("name") or "Kanda POS"
    order_qty = qty if qty and qty > 0 else item["reorder"] * 2
    po_no = f"PO-{item_id[-6:].upper()}-{now_ist().strftime('%Y%m%d%H%M')}"
    pdf_bytes = _render_po_pdf(item, supplier, store_name, order_qty, po_no)
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{po_no}.pdf"'},
    )
