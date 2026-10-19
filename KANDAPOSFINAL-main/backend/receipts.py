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
import os
import re
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


_TENDER_LABELS = {"cash": "CASH", "card": "CARD", "card_machine": "CARD", "upi": "UPI", "other": "OTHER", "unpaid": "UNPAID"}


def paid_by_label(order: dict) -> str:
    pay = order.get("payment") or "?"
    if pay == "split" and order.get("splits"):
        return " + ".join(f"{_TENDER_LABELS.get(p.get('method'), str(p.get('method')).upper())} {float(p.get('amount') or 0):.2f}"
                          for p in order["splits"])
    return _TENDER_LABELS.get(pay, str(pay).upper())


def _line(s: str) -> bytes:
    return s.encode("cp437", errors="replace") + LF


def _row(left: str, right: str, width: int = 32) -> bytes:
    pad = max(1, width - len(left) - len(right))
    return _line(left + " " * pad + right)


def _money(v: float) -> str:
    return f"Rs.{v:.2f}"


def _gstin_line(tax_id: str | None) -> str:
    """Store's GST registration line — tenants often enter just the bare
    number, so label it (India uses GST, not VAT)."""
    v = (tax_id or "").strip()
    if not v:
        return ""
    return v if v.upper().startswith("GST") else f"GSTIN {v}"


def _bill_to_lines(order: dict) -> list[str]:
    """Customer details worth printing on a receipt/invoice, one per line.

    Dine-in orders carry a placeholder customer named after the table
    ("Table 2") when staff didn't take the guest's details — that's not a
    customer, so it's left off rather than printed as "Bill To: Table 2"
    (the table number is shown separately)."""
    cust = order.get("customer") or {}
    lines: list[str] = []
    name = (cust.get("name") or "").strip()
    placeholder = re.fullmatch(r"(Table \d+|Walk-in)", name)
    if name and not placeholder:
        lines.append(name)
    addr = " ".join(p for p in ((cust.get("address") or "").strip(), (cust.get("postcode") or "").strip()) if p)
    if addr:
        lines.append(addr)
    if (cust.get("phone") or "").strip():
        lines.append(f"Ph: {cust['phone'].strip()}")
    email = (cust.get("email") or order.get("customer_email") or "").strip()
    if email:
        lines.append(email)
    if (cust.get("gstin") or "").strip():
        lines.append(f"GSTIN: {cust['gstin'].strip().upper()}")
    return lines


def _summary_rows(order: dict) -> list[tuple[str, float]]:
    """The totals block shared by every receipt format, as (label, amount)
    pairs. Negative amounts are deductions. Refund rows only appear once a
    refund has actually been issued, so an untouched bill prints exactly as
    before."""
    subtotal = order.get("subtotal")
    if subtotal is None:
        subtotal = sum(float(it.get("qty", 0)) * float(it.get("price", 0)) for it in order.get("items", []))
    rows: list[tuple[str, float]] = [("Subtotal", float(subtotal))]
    if order.get("serviceCharge"):
        rows.append((f"Service charge ({float(order.get('serviceChargePct') or 0):g}%)", float(order["serviceCharge"])))
    if order.get("taxTotal"):
        rows.append(("GST (incl.)" if order.get("taxInclusive") else "GST", float(order["taxTotal"])))
        rows.append(("  CGST", float(order.get("cgst", 0))))
        rows.append(("  SGST", float(order.get("sgst", 0))))
    if order.get("deliveryFee"):
        rows.append(("Delivery", float(order["deliveryFee"])))
    if order.get("discount"):
        rows.append(("Discount", -float(order["discount"])))
    total = float(order.get("total", 0) or 0)
    rows.append(("TOTAL", total))
    refunded = float(order.get("refunded_amount") or 0)
    if refunded > 0:
        rows.append(("Refunded", -refunded))
        rows.append(("NET PAID", round(total - refunded, 2)))
    return rows


def _signed(v: float, fmt) -> str:
    return ("-" + fmt(-v)) if v < 0 else fmt(v)


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
        out += _line(_gstin_line(store.get("tax_id")))
    out += _line("-" * 32)

    out += ALIGN_LEFT
    out += _row("Order #" + str(order.get("number", "")), order.get("type", "").upper())
    out += _line("Time " + order.get("placedAt", "")[:19].replace("T", " "))
    if order.get("voided"):
        out += BOLD_ON + _line("*** VOID ***") + BOLD_OFF
    bill_to = _bill_to_lines(order)
    if bill_to:
        out += _line("For  " + bill_to[0][:27])
        for extra in bill_to[1:]:
            out += _line(extra[:32])
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
        for label, amount in _summary_rows(order):
            text = "Net paid" if label == "NET PAID" else label
            out += _row(text, _signed(amount, _money))
        out += _line("-" * 32)
        out += _row("Paid by", paid_by_label(order))
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
        "serviceCharge": order.get("serviceCharge", 0),
        "serviceChargePct": order.get("serviceChargePct", 0),
        "refundedAmount": float(order.get("refunded_amount") or 0),
        "netTotal": round(float(order.get("total", 0) or 0) - float(order.get("refunded_amount") or 0), 2),
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


_FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
_INVOICE_FONT = "DejaVuSans"
_INVOICE_FONT_BOLD = "DejaVuSans-Bold"


def _invoice_fonts() -> tuple[str, str]:
    """Register (once) and return the (regular, bold) font names for the PDF
    invoice. reportlab's built-in Helvetica has no ₹ glyph and renders it as a
    filled black square, so the invoice uses the bundled DejaVu Sans instead."""
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.lib.fonts import addMapping

    registered = pdfmetrics.getRegisteredFontNames()
    if _INVOICE_FONT not in registered:
        pdfmetrics.registerFont(TTFont(_INVOICE_FONT, os.path.join(_FONT_DIR, "DejaVuSans.ttf")))
    if _INVOICE_FONT_BOLD not in registered:
        pdfmetrics.registerFont(TTFont(_INVOICE_FONT_BOLD, os.path.join(_FONT_DIR, "DejaVuSans-Bold.ttf")))
    # Lets Paragraph markup like <b>…</b> resolve to the bold face.
    addMapping(_INVOICE_FONT, 0, 0, _INVOICE_FONT)
    addMapping(_INVOICE_FONT, 1, 0, _INVOICE_FONT_BOLD)
    addMapping(_INVOICE_FONT, 0, 1, _INVOICE_FONT)
    addMapping(_INVOICE_FONT, 1, 1, _INVOICE_FONT_BOLD)
    return _INVOICE_FONT, _INVOICE_FONT_BOLD


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
    from xml.sax.saxutils import escape

    font, font_bold = _invoice_fonts()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=15 * mm, rightMargin=15 * mm,
        topMargin=15 * mm, bottomMargin=15 * mm,
        title=f"Tax Invoice — Order #{order.get('number')}",
    )
    styles = getSampleStyleSheet()
    sub_st = ParagraphStyle("sub", parent=styles["Normal"], fontName=font, fontSize=9, leading=13, textColor=colors.HexColor("#666666"))
    right_st = ParagraphStyle("right", parent=styles["Normal"], fontName=font, fontSize=10, leading=14, alignment=TA_RIGHT, textColor=colors.HexColor("#111111"))
    label_st = ParagraphStyle("label", parent=styles["Normal"], fontName=font, fontSize=9, leading=13, textColor=colors.HexColor("#666666"))

    invoice_no = f"INV-{order.get('number', '')}"
    placed = (order.get("placedAt") or "")[:19].replace("T", " ")
    e = lambda v: escape(str(v or ""))  # noqa: E731 — store/customer text is user-entered

    story = []
    right_lines = [
        "<b>TAX INVOICE</b>" + ("  <font color='#dc2626'><b>VOID</b></font>" if order.get("voided") else ""),
        f"Invoice No: {invoice_no}", f"Order #{e(order.get('number'))}", f"Date: {placed}",
    ]
    if order.get("type") == "dine-in" and order.get("table") is not None:
        right_lines.append(f"Table {e(order.get('table'))}")
    header = Table([[
        Paragraph(f"<b>{e(store.get('name', 'Kanda POS'))}</b><br/>{e(store.get('address', ''))}<br/>Tel {e(store.get('phone', ''))}<br/>{e(_gstin_line(store.get('tax_id')))}", sub_st),
        Paragraph("<br/>".join(right_lines), right_st),
    ]], colWidths=[100 * mm, 75 * mm])
    header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(header)
    story.append(Spacer(1, 6 * mm))

    bill_to = _bill_to_lines(order)
    if bill_to:
        story.append(Paragraph("<b>Bill To</b><br/>" + "<br/>".join(e(line) for line in bill_to), label_st))
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
        ("FONTNAME", (0, 0), (-1, -1), font),
        ("FONTNAME", (0, 0), (-1, 0), font_bold),
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

    rupee = lambda v: f"₹{v:.2f}"  # noqa: E731
    rows = _summary_rows(order)
    summary_rows = [[label, _signed(amount, rupee)] for label, amount in rows]
    total_idx = next(i for i, (label, _) in enumerate(rows) if label == "TOTAL")
    summary_style = [
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ("FONTNAME", (0, 0), (-1, -1), font),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("FONTNAME", (0, total_idx), (-1, total_idx), font_bold),
        ("FONTSIZE", (0, total_idx), (-1, total_idx), 12),
        ("LINEABOVE", (0, total_idx), (-1, total_idx), 1, colors.HexColor("#111111")),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    if total_idx != len(rows) - 1:  # refund rows follow TOTAL — net paid is the figure that matters now
        summary_style += [
            ("TEXTCOLOR", (0, total_idx + 1), (-1, total_idx + 1), colors.HexColor("#dc2626")),
            ("FONTNAME", (0, -1), (-1, -1), font_bold),
            ("FONTSIZE", (0, -1), (-1, -1), 12),
        ]
    summary = Table(summary_rows, colWidths=[130 * mm, 40 * mm])
    summary.setStyle(TableStyle(summary_style))
    story.append(summary)
    story.append(Spacer(1, 8 * mm))

    story.append(Paragraph(f"Paid by: <b>{e(paid_by_label(order))}</b>" + (f" · Ref: {e(order['razorpayPaymentId'])}" if order.get("razorpayPaymentId") else ""), label_st))
    if cashier:
        story.append(Paragraph(f"Served by: {e(cashier)}", label_st))
    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph(e(store.get("footer") or "Thank you for your business."), sub_st))
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
