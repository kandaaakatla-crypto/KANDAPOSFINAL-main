"""Receipt + KOT (kitchen order ticket) generation.

Three formats:
  - JSON payload used by the React `ReceiptView` for HTML browser printing.
  - Raw ESC/POS byte stream (scaffolded — transport to physical thermal printer
    is left for a future networking layer; the bytes themselves are correct and
    can be piped to /dev/usb/lp0, a TCP socket, or printed via cups).
  - A downloadable PDF tax invoice — same authoritative order data as the
    receipt, formatted for a customer who needs a proper paper/PDF invoice
    (e.g. a B2B buyer) rather than a thermal-printer strip.

Store info is sourced from the tenant document (per-tenant branding).
"""
import io
from fastapi import APIRouter, HTTPException, Depends, Response
from fastapi.responses import StreamingResponse
from typing import Literal

from auth import get_current_user
from db import get_db
from tenants import tenant_filter, get_tenant


receipts_router = APIRouter()

FALLBACK_STORE = {
    "name": "Demo Restaurant",
    "address": "Plot 22, HiTech City Main Rd, Madhapur, Hyderabad 500081",
    "phone": "+91 40 4500 1234",
    "tax_id": "GSTIN 36ABCDE1234F1Z5",
    "footer": "Thank you for ordering!",
}

# ---------- ESC/POS helpers ----------
ESC = b"\x1b"
GS = b"\x1d"
INIT = ESC + b"@"
ALIGN_LEFT = ESC + b"a\x00"
ALIGN_CENTER = ESC + b"a\x01"
BOLD_ON = ESC + b"E\x01"
BOLD_OFF = ESC + b"E\x00"
DBL_ON = GS + b"!\x11"
DBL_OFF = GS + b"!\x00"
LF = b"\n"
CUT = GS + b"V\x42\x00"


def _line(s: str) -> bytes:
    return s.encode("cp437", errors="replace") + LF


def _row(left: str, right: str, width: int = 32) -> bytes:
    pad = max(1, width - len(left) - len(right))
    return _line(left + " " * pad + right)


def _money(v: float) -> str:
    return f"Rs.{v:.2f}"


def _build_escpos(order: dict, store: dict, kind: str) -> bytes:
    out = bytearray()
    out += INIT
    out += ALIGN_CENTER
    out += BOLD_ON + DBL_ON + _line(store["name"]) + DBL_OFF + BOLD_OFF
    if kind == "kitchen":
        out += BOLD_ON + DBL_ON + _line("*** KITCHEN ***") + DBL_OFF + BOLD_OFF
    else:
        out += _line(store["address"])
        out += _line("Tel " + store["phone"])
        out += _line(store.get("tax_id") or store.get("vat") or "")
    out += _line("-" * 32)

    out += ALIGN_LEFT
    out += _row("Order #" + str(order.get("number", "")), order.get("type", "").upper())
    out += _line("Time " + order.get("placedAt", "")[:19].replace("T", " "))
    cust = order.get("customer") or {}
    if cust.get("name"):
        out += _line("For  " + cust["name"])
    if cust.get("address"):
        out += _line(cust["address"][:32])
    if cust.get("postcode"):
        out += _line(cust["postcode"])
    if order.get("table"):
        out += _line("Table " + str(order["table"]))
    out += _line("-" * 32)

    out += BOLD_ON
    for it in order.get("items", []):
        line = f"{it['qty']}x {it['name']}"[:24]
        if kind == "kitchen":
            out += _line(line)
        else:
            out += _row(line, _money(it["qty"] * it["price"]))
        for mod in (it.get("mods") or []):
            out += _line("   " + mod[:28])
    out += BOLD_OFF

    if kind != "kitchen":
        out += _line("-" * 32)
        subtotal = order.get("subtotal")
        if subtotal is None:
            subtotal = sum(it["qty"] * it["price"] for it in order.get("items", []))
        out += _row("Subtotal", _money(subtotal))
        if order.get("taxTotal"):
            tax_label = "GST (incl.)" if order.get("taxInclusive") else "GST"
            out += _row(tax_label, _money(order["taxTotal"]))
            out += _row("  CGST", _money(order.get("cgst", 0)))
            out += _row("  SGST", _money(order.get("sgst", 0)))
        if order.get("deliveryFee"):
            out += _row("Delivery", _money(order["deliveryFee"]))
        if order.get("discount"):
            out += _row("Discount", "-" + _money(order["discount"]))
        out += _row("TOTAL", _money(order.get("total", 0)))
        out += _line("-" * 32)
        out += _row("Paid by", str(order.get("payment", "?")).upper())
        if order.get("razorpayPaymentId"):
            out += _line("Ref " + order["razorpayPaymentId"])
        out += LF
        out += ALIGN_CENTER + _line(store.get("footer") or "")

    out += LF + LF + LF + CUT
    return bytes(out)


async def _load_order_and_store(order_id: str, user: dict):
    db = get_db()
    order = await db.orders.find_one(tenant_filter(user, {"id": order_id}), {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    tenant = await get_tenant(user, db)
    store = tenant.get("store") or FALLBACK_STORE
    return order, store


# ---------- Routes ----------
@receipts_router.get("/orders/{order_id}/receipt")
async def receipt_json(order_id: str, user: dict = Depends(get_current_user)):
    order, store = await _load_order_and_store(order_id, user)
    # Prefer the authoritative GST breakdown stamped at checkout (see tax.py).
    # Falls back to a naive re-sum for pre-tax-feature orders that predate it.
    subtotal = order.get("subtotal")
    if subtotal is None:
        subtotal = round(sum(it["qty"] * it["price"] for it in order.get("items", [])), 2)
    return {
        "store": store,
        "order": order,
        "subtotal": subtotal,
        "taxTotal": order.get("taxTotal", 0),
        "cgst": order.get("cgst", 0),
        "sgst": order.get("sgst", 0),
        "taxInclusive": order.get("taxInclusive", False),
        "issuedAt": order.get("placedAt"),
        "cashier": user.get("name"),
    }


@receipts_router.get("/orders/{order_id}/receipt/escpos")
async def receipt_escpos(
    order_id: str,
    kind: Literal["customer", "kitchen"] = "customer",
    user: dict = Depends(get_current_user),
):
    order, store = await _load_order_and_store(order_id, user)
    payload = _build_escpos(order, store, kind)
    return Response(content=payload, media_type="application/octet-stream", headers={
        "Content-Disposition": f'attachment; filename="receipt_{order_id}_{kind}.bin"'
    })


def _render_invoice_pdf(order: dict, store: dict, cashier: str) -> bytes:
    """One-page portrait tax invoice for a single order — same colours/table
    style as the rota PDF (routes/shifts.py`_render_rota_pdf`) so downloadable
    documents look consistent across the app."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.enums import TA_LEFT, TA_RIGHT

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=15 * mm, rightMargin=15 * mm,
        topMargin=15 * mm, bottomMargin=15 * mm,
        title=f"Tax Invoice — Order #{order.get('number')}",
    )
    styles = getSampleStyleSheet()
    title_st = ParagraphStyle("title", parent=styles["Title"], fontSize=16, leading=20, alignment=TA_LEFT, textColor=colors.HexColor("#111111"))
    sub_st = ParagraphStyle("sub", parent=styles["Normal"], fontSize=9, leading=13, textColor=colors.HexColor("#666666"))
    right_st = ParagraphStyle("right", parent=styles["Normal"], fontSize=10, leading=14, alignment=TA_RIGHT, textColor=colors.HexColor("#111111"))
    label_st = ParagraphStyle("label", parent=styles["Normal"], fontSize=9, leading=13, textColor=colors.HexColor("#666666"))

    invoice_no = f"INV-{order.get('number', '')}"
    placed = (order.get("placedAt") or "")[:19].replace("T", " ")
    cust = order.get("customer") or {}

    story = []
    header = Table([[
        Paragraph(f"<b>{store.get('name', 'Kanda POS')}</b><br/>{store.get('address', '')}<br/>Tel {store.get('phone', '')}<br/>{store.get('tax_id', '')}", sub_st),
        Paragraph(f"<b>TAX INVOICE</b><br/>Invoice No: {invoice_no}<br/>Order #{order.get('number')}<br/>Date: {placed}", right_st),
    ]], colWidths=[100 * mm, 75 * mm])
    header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(header)
    story.append(Spacer(1, 6 * mm))

    if cust.get("name"):
        bill_to = f"<b>Bill To</b><br/>{cust['name']}"
        if cust.get("address"):
            bill_to += f"<br/>{cust['address']}"
        if cust.get("postcode"):
            bill_to += f" {cust['postcode']}"
        story.append(Paragraph(bill_to, label_st))
        story.append(Spacer(1, 5 * mm))

    rows = [["Item", "Qty", "Rate", "Tax %", "Tax Amt", "Amount"]]
    for it in order.get("items", []):
        qty = float(it.get("qty", 0))
        price = float(it.get("price", 0))
        tax_rate = float(it.get("tax_rate") or 0)
        tax_amt = float(it.get("tax_amount") or 0)
        rows.append([
            it.get("name", ""), f"{qty:g}", f"₹{price:.2f}", f"{tax_rate:g}%", f"₹{tax_amt:.2f}", f"₹{qty * price:.2f}",
        ])
    tbl = Table(rows, repeatRows=1, colWidths=[65 * mm, 18 * mm, 25 * mm, 20 * mm, 25 * mm, 22 * mm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111111")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
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
    story.append(Spacer(1, 6 * mm))

    subtotal = order.get("subtotal")
    if subtotal is None:
        subtotal = sum(float(it.get("qty", 0)) * float(it.get("price", 0)) for it in order.get("items", []))
    summary_rows = [["Subtotal", f"₹{subtotal:.2f}"]]
    if order.get("taxTotal"):
        tax_label = "GST (incl.)" if order.get("taxInclusive") else "GST"
        summary_rows.append([tax_label, f"₹{order['taxTotal']:.2f}"])
        summary_rows.append(["  CGST", f"₹{order.get('cgst', 0):.2f}"])
        summary_rows.append(["  SGST", f"₹{order.get('sgst', 0):.2f}"])
    if order.get("deliveryFee"):
        summary_rows.append(["Delivery", f"₹{order['deliveryFee']:.2f}"])
    if order.get("discount"):
        summary_rows.append(["Discount", f"-₹{order['discount']:.2f}"])
    summary_rows.append(["TOTAL", f"₹{order.get('total', 0):.2f}"])
    summary = Table(summary_rows, colWidths=[130 * mm, 40 * mm])
    summary.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, -1), (-1, -1), 12),
        ("LINEABOVE", (0, -1), (-1, -1), 1, colors.HexColor("#111111")),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(summary)
    story.append(Spacer(1, 8 * mm))

    story.append(Paragraph(f"Paid by: <b>{str(order.get('payment', '?')).upper()}</b>" + (f" · Ref: {order['razorpayPaymentId']}" if order.get("razorpayPaymentId") else ""), label_st))
    if cashier:
        story.append(Paragraph(f"Served by: {cashier}", label_st))
    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph(store.get("footer") or "Thank you for your business.", sub_st))
    story.append(Paragraph("This is a computer-generated tax invoice.", sub_st))

    doc.build(story)
    return buf.getvalue()


@receipts_router.get("/orders/{order_id}/invoice.pdf")
async def order_invoice_pdf(order_id: str, user: dict = Depends(get_current_user)):
    """Downloadable PDF tax invoice for a single order — same authoritative
    GST/total figures already stamped on the order at checkout."""
    order, store = await _load_order_and_store(order_id, user)
    pdf_bytes = _render_invoice_pdf(order, store, user.get("name", ""))
    filename = f"invoice_{order.get('number', order_id)}.pdf"
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
