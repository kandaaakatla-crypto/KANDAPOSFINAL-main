"""Receipt + KOT (kitchen order ticket) generation.

Two formats:
  - JSON payload used by the React `ReceiptView` for HTML browser printing.
  - Raw ESC/POS byte stream (scaffolded — transport to physical thermal printer
    is left for a future networking layer; the bytes themselves are correct and
    can be piped to /dev/usb/lp0, a TCP socket, or printed via cups).

Store info is sourced from the tenant document (per-tenant branding).
"""
from fastapi import APIRouter, HTTPException, Depends, Response
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
        subtotal = sum(it["qty"] * it["price"] for it in order.get("items", []))
        out += _row("Subtotal", _money(subtotal))
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
    subtotal = round(sum(it["qty"] * it["price"] for it in order.get("items", [])), 2)
    return {
        "store": store,
        "order": order,
        "subtotal": subtotal,
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
