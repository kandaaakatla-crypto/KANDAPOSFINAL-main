"""Shareable sales report — today's or this week's numbers in a form the
owner can send on WhatsApp: JSON (the app builds the message text from it)
and a one-page PDF of the same numbers to attach."""
import io
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from auth import require_role
from db import get_db
from tenants import tenant_filter, get_tenant
from tz import now_ist
from .reports import report_channels

router = APIRouter()

PERIODS = {1: "Today", 7: "Last 7 days"}
CHANNEL_LABELS = {"in-store": "Counter", "phone": "Phone", "swiggy": "Swiggy", "zomato": "Zomato",
                  "qr": "Table QR", "website": "Website", "other": "Other"}
PAYMENT_LABELS = {"cash": "Cash", "card": "Card", "upi": "UPI", "unpaid": "Unpaid"}


async def _share_data(user: dict, days: int) -> dict:
    if days not in PERIODS:
        raise HTTPException(status_code=422, detail="days must be 1 or 7")
    db = get_db()
    now = now_ist()
    start = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)
    docs = await db.orders.find(
        tenant_filter(user, {"placedAt": {"$gte": start.isoformat()}, "voided": {"$ne": True}}),
        {"_id": 0, "total": 1, "payment": 1, "items": 1},
    ).to_list(20000)

    sales = sum(float(o.get("total", 0) or 0) for o in docs)
    payments: dict[str, float] = {}
    items: dict[str, dict] = {}
    for o in docs:
        key = o.get("payment") or "unpaid"
        payments[key] = payments.get(key, 0) + float(o.get("total", 0) or 0)
        for it in o.get("items", []):
            row = items.setdefault(it["name"], {"name": it["name"], "qty": 0, "revenue": 0.0})
            row["qty"] += it.get("qty", 0)
            row["revenue"] += it.get("qty", 0) * it.get("price", 0)
    top = sorted(items.values(), key=lambda r: (-r["qty"], -r["revenue"]))[:5]
    channels = (await report_channels(user=user, days=days))["bySource"]
    tenant = await get_tenant(user, db) or {}

    return {
        "days": days,
        "label": PERIODS[days],
        "storeName": (tenant.get("store") or {}).get("name") or tenant.get("name") or "Kanda POS",
        "from": start.date().isoformat(),
        "to": now.date().isoformat(),
        "generatedAt": now.isoformat(),
        "sales": round(sales, 2),
        "orders": len(docs),
        "avgOrder": round(sales / len(docs), 2) if docs else 0,
        "payments": {k: round(v, 2) for k, v in payments.items()},
        "channels": channels,
        "topItems": [{**r, "revenue": round(r["revenue"], 2)} for r in top],
    }


def _inr(v: float) -> str:
    """₹ with Indian digit grouping (₹3,11,950), as the app shows it."""
    whole = f"{abs(round(v)):d}"
    head, tail = whole[:-3], whole[-3:]
    while len(head) > 2:
        tail = f"{head[-2:]},{tail}"
        head = head[:-2]
    return ("-" if v < 0 else "") + "₹" + (f"{head},{tail}" if head else tail)


def _day(iso_date: str) -> str:
    return datetime.fromisoformat(iso_date).strftime("%d %b %Y").lstrip("0")


def _render_share_pdf(d: dict) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    from receipts import _invoice_fonts

    font, bold = _invoice_fonts()  # Helvetica has no ₹ glyph
    inr = _inr
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
                            title=f"{d['storeName']} — {d['label']}")
    h1 = ParagraphStyle("h1", fontName=bold, fontSize=18, leading=22)
    sub = ParagraphStyle("sub", fontName=font, fontSize=10, leading=13, textColor=colors.HexColor("#666666"))
    h2 = ParagraphStyle("h2", fontName=bold, fontSize=11, leading=14, spaceBefore=6 * mm, spaceAfter=2 * mm)

    def table(rows, widths):
        t = Table(rows, colWidths=widths)
        t.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), font), ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
            ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#e6e6e6")),
            ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        return t

    period = _day(d["from"]) if d["from"] == d["to"] else f"{_day(d['from'])} to {_day(d['to'])}"
    story = [
        Paragraph(f"{d['storeName']} · {d['label']}", h1),
        Paragraph(f"{period} · up to {d['generatedAt'][11:16]} IST · totals include GST", sub),
        Spacer(1, 5 * mm),
    ]
    kpi = Table([[inr(d["sales"]), str(d["orders"]), inr(d["avgOrder"])], ["Sales", "Orders", "Average order"]],
                colWidths=[60 * mm, 50 * mm, 60 * mm])
    kpi.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, 0), bold), ("FONTSIZE", (0, 0), (-1, 0), 20), ("LEADING", (0, 0), (-1, 0), 24),
        ("FONTNAME", (0, 1), (-1, 1), font), ("FONTSIZE", (0, 1), (-1, 1), 9), ("TEXTCOLOR", (0, 1), (-1, 1), colors.HexColor("#666666")),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fdf6ec")), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(kpi)

    if d["payments"]:
        story.append(Paragraph("Payments", h2))
        story.append(table([[PAYMENT_LABELS.get(k, k.title()), inr(v)] for k, v in sorted(d["payments"].items(), key=lambda kv: -kv[1])],
                           [120 * mm, 50 * mm]))
    if d["channels"]:
        story.append(Paragraph("Channels", h2))
        story.append(table([[CHANNEL_LABELS.get(c["key"], c["key"]), f"{c['orders']} orders", inr(c["sales"])] for c in d["channels"]],
                           [90 * mm, 30 * mm, 50 * mm]))
    if d["topItems"]:
        story.append(Paragraph("Top items", h2))
        story.append(table([[i["name"], f"{i['qty']:g} sold", inr(i["revenue"])] for i in d["topItems"]],
                           [90 * mm, 30 * mm, 50 * mm]))
    if not d["orders"]:
        story.append(Spacer(1, 6 * mm))
        story.append(Paragraph("No orders in this period yet.", sub))
    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph("Voided orders are left out. Generated by Kanda POS.", sub))
    doc.build(story)
    return buf.getvalue()


@router.get("/reports/share")
async def share_report(user: dict = Depends(require_role("Manager")), days: int = 1):
    return await _share_data(user, days)


@router.get("/reports/share.pdf")
async def share_report_pdf(user: dict = Depends(require_role("Manager")), days: int = 1):
    d = await _share_data(user, days)
    filename = f"sales-{d['to']}.pdf" if days == 1 else f"sales-{d['from']}-to-{d['to']}.pdf"
    return StreamingResponse(iter([_render_share_pdf(d)]), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})
