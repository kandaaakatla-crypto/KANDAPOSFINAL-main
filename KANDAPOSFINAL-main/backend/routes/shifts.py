"""Shifts / Rota — Manager creates a shift schedule, employees see theirs."""
import io
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse

from db import get_db
from auth import require_role, get_current_user
from tenants import tenant_filter, get_tenant
from models import Shift, ShiftCreate, ShiftUpdate

router = APIRouter()


def _doc_to_shift(d: dict) -> dict:
    return {
        "id": d["id"],
        "user_id": d["user_id"],
        "user_name": d.get("user_name", ""),
        "role": d.get("role", "Cashier"),
        "start": d["start"],
        "end": d["end"],
        "station": d.get("station"),
        "notes": d.get("notes"),
        "location_id": d.get("location_id"),
        "published": bool(d.get("published", False)),
    }


@router.get("/shifts", response_model=List[Shift])
async def list_shifts(
    user: dict = Depends(get_current_user),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    mine: bool = Query(False, description="True → restrict to current user"),
):
    db = get_db()
    flt = tenant_filter(user)
    if mine or user.get("role") != "Manager":
        flt["user_id"] = user["id"]
        # Non-managers only see published shifts
        if user.get("role") != "Manager":
            flt["published"] = True
    if start or end:
        flt["start"] = {}
        if start:
            flt["start"]["$gte"] = start
        if end:
            flt["start"]["$lt"] = end
    docs = await db.shifts.find(flt, {"_id": 0}).sort("start", 1).to_list(1000)
    return [_doc_to_shift(d) for d in docs]


@router.post("/shifts", response_model=Shift)
async def create_shift(payload: ShiftCreate, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    target = await db.users.find_one(tenant_filter(user, {"id": payload.user_id}), {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Employee not found")
    if payload.end <= payload.start:
        raise HTTPException(status_code=400, detail="Shift end must be after start")
    doc = {
        "id": f"sh_{uuid.uuid4().hex[:10]}",
        "tenant_id": user["tenant_id"],
        "user_id": payload.user_id,
        "user_name": target["name"],
        "role": target["role"],
        "start": payload.start,
        "end": payload.end,
        "station": payload.station,
        "notes": payload.notes,
        "location_id": payload.location_id,
        "published": bool(payload.published),
    }
    await db.shifts.insert_one(doc)
    return _doc_to_shift(doc)


@router.patch("/shifts/{shift_id}", response_model=Shift)
async def update_shift(shift_id: str, payload: ShiftUpdate, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    existing = await db.shifts.find_one(tenant_filter(user, {"id": shift_id}), {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Shift not found")
    updates = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if updates.get("user_id"):
        target = await db.users.find_one(tenant_filter(user, {"id": updates["user_id"]}), {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="Employee not found")
        updates["user_name"] = target["name"]
        updates["role"] = target["role"]
    if updates:
        await db.shifts.update_one(tenant_filter(user, {"id": shift_id}), {"$set": updates})
    fresh = await db.shifts.find_one(tenant_filter(user, {"id": shift_id}), {"_id": 0})
    return _doc_to_shift(fresh)


@router.delete("/shifts/{shift_id}")
async def delete_shift(shift_id: str, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    res = await db.shifts.delete_one(tenant_filter(user, {"id": shift_id}))
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Shift not found")
    return {"ok": True, "id": shift_id}


@router.post("/shifts/publish")
async def publish_range(
    user: dict = Depends(require_role("Manager")),
    start: str = Query(..., description="Range start (ISO)"),
    end: str = Query(..., description="Range end (ISO)"),
):
    """Bulk-publish every shift in a window so employees can see them."""
    db = get_db()
    res = await db.shifts.update_many(
        tenant_filter(user, {"start": {"$gte": start, "$lt": end}}),
        {"$set": {"published": True}},
    )
    return {"published": res.modified_count}


def _fmt_dt(iso: str) -> tuple[str, str]:
    """Return (date_str, time_str) tuples for the PDF table."""
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.strftime("%a %d %b"), dt.strftime("%H:%M")
    except Exception:
        return iso[:10], iso[11:16]


def _render_rota_pdf(store_name: str, start: str, end: str, shifts: list[dict]) -> bytes:
    """Build a one-page (or multi-page) tabular PDF of the rota.
    Grouped by employee → days → start–end blocks. Uses ReportLab so we have
    no external font deps and the bytes can be streamed back via FastAPI."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.enums import TA_LEFT

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=landscape(A4),
        leftMargin=12 * mm, rightMargin=12 * mm,
        topMargin=12 * mm, bottomMargin=12 * mm,
        title=f"Rota — {store_name}",
    )
    styles = getSampleStyleSheet()
    title_st = ParagraphStyle("title", parent=styles["Title"], fontSize=18, leading=22, alignment=TA_LEFT, textColor=colors.HexColor("#111111"))
    sub_st = ParagraphStyle("sub", parent=styles["Normal"], fontSize=10, leading=13, textColor=colors.HexColor("#666666"))
    cell_st = ParagraphStyle("cell", parent=styles["Normal"], fontSize=9, leading=11)

    story = []
    story.append(Paragraph(f"{store_name} — Rota", title_st))
    story.append(Paragraph(
        f"Week: {_fmt_dt(start)[0]} → {_fmt_dt(end)[0]} · Generated {datetime.now(timezone.utc).strftime('%d %b %Y %H:%M UTC')}",
        sub_st,
    ))
    story.append(Spacer(1, 6 * mm))

    if not shifts:
        story.append(Paragraph("No shifts scheduled for this period.", cell_st))
    else:
        # Group by employee, then sort.
        rows: list[list] = [["Employee", "Role", "Day", "Start", "End", "Hours", "Station", "Status"]]
        # Stable sort: employee name, then start time
        for sh in sorted(shifts, key=lambda s: (s.get("user_name", ""), s.get("start", ""))):
            day, st = _fmt_dt(sh["start"])
            _, en = _fmt_dt(sh["end"])
            try:
                start_dt = datetime.fromisoformat(sh["start"].replace("Z", "+00:00"))
                end_dt = datetime.fromisoformat(sh["end"].replace("Z", "+00:00"))
                hours = round((end_dt - start_dt).total_seconds() / 3600.0, 2)
            except Exception:
                hours = 0
            rows.append([
                sh.get("user_name", ""), sh.get("role", ""), day, st, en, f"{hours:g}h",
                sh.get("station") or "—", "Published" if sh.get("published") else "Draft",
            ])
        tbl = Table(rows, repeatRows=1, colWidths=[55 * mm, 25 * mm, 30 * mm, 18 * mm, 18 * mm, 16 * mm, 35 * mm, 22 * mm])
        tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111111")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 9),
            ("FONTSIZE", (0, 1), (-1, -1), 9),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8f9fb")]),
            ("LINEBELOW", (0, 0), (-1, 0), 1, colors.HexColor("#111111")),
            ("GRID", (0, 1), (-1, -1), 0.25, colors.HexColor("#e6e6e6")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(tbl)

    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph(
        "Distribute this to staff via WhatsApp or print and pin in the staff room. "
        "Generated by Kanda POS.",
        sub_st,
    ))
    doc.build(story)
    return buf.getvalue()


@router.get("/shifts.pdf")
async def export_rota_pdf(
    user: dict = Depends(require_role("Manager")),
    start: str = Query(..., description="Range start (ISO)"),
    end: str = Query(..., description="Range end (ISO)"),
):
    """Download a printable PDF of the week's rota."""
    db = get_db()
    shifts = await db.shifts.find(
        tenant_filter(user, {"start": {"$gte": start, "$lt": end}}),
        {"_id": 0},
    ).sort("start", 1).to_list(2000)
    tenant = await get_tenant(user, db) or {}
    store_name = (tenant.get("store") or {}).get("name") or tenant.get("name") or "Kanda POS"
    pdf_bytes = _render_rota_pdf(store_name, start, end, shifts)
    filename = f"rota-{start[:10]}.pdf"
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
