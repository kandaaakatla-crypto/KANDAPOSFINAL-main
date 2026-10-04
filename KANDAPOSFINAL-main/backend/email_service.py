"""Resend email integration for Kanda POS.

Used by the Contact Support flow to notify the Platform Owner whenever a
tenant submits a support ticket. Failures are caught + logged so the ticket
row is still persisted even if email delivery breaks.
"""
import os
import asyncio
import logging

import resend

logger = logging.getLogger("kanda.email")


def _configured() -> bool:
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    if not api_key:
        return False
    resend.api_key = api_key
    return True


async def send_email(to: str, subject: str, html: str) -> dict:
    """Send a single transactional email. Returns Resend's response dict or
    {"skipped": True} when no API key is configured. Never raises — caller
    decides whether to surface the failure to the user."""
    if not _configured():
        logger.warning("RESEND_API_KEY not set — skipping email to %s", to)
        return {"skipped": True}

    sender = os.environ.get("SUPPORT_FROM_EMAIL", "onboarding@resend.dev")
    params = {"from": sender, "to": [to], "subject": subject, "html": html}
    try:
        return await asyncio.to_thread(resend.Emails.send, params)
    except Exception as exc:  # noqa: BLE001 — never block the request on email
        logger.exception("Resend email to %s failed: %s", to, exc)
        return {"error": str(exc)}


def support_ticket_email(ticket: dict, tenant: dict) -> tuple[str, str]:
    """Render the subject + HTML body for a new support ticket notification."""
    subject = f"[Kanda Support] {ticket['subject']} — {tenant.get('name', tenant.get('id', '?'))}"
    rows = [
        ("Tenant", f"{tenant.get('name', '?')} ({tenant.get('slug', tenant.get('id', '?'))})"),
        ("Opened by", f"{ticket.get('opened_by_name', '—')} ({ticket.get('opened_by_role', '—')})"),
        ("Severity", ticket.get("severity", "normal")),
        ("At", ticket.get("at", "")),
        ("Ticket id", ticket.get("id", "")),
    ]
    meta_html = "".join(
        f'<tr><td style="padding:4px 12px 4px 0;color:#888;font-size:12px">{k}</td>'
        f'<td style="padding:4px 0;color:#111;font-size:13px"><b>{v}</b></td></tr>'
        for k, v in rows
    )
    body = (ticket.get("body") or "").replace("\n", "<br>")
    return subject, (
        f'<div style="font-family:Inter,Arial,sans-serif;background:#fafafa;padding:24px">'
        f'<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:12px;padding:24px">'
        f'<h2 style="margin:0 0 4px;color:#111">New support ticket</h2>'
        f'<div style="color:#666;font-size:13px;margin-bottom:16px">{ticket["subject"]}</div>'
        f'<table style="border-collapse:collapse;width:100%;margin-bottom:16px">{meta_html}</table>'
        f'<div style="background:#f5f5f7;border-radius:8px;padding:12px;color:#111;font-size:14px;line-height:1.5;white-space:pre-wrap">{body}</div>'
        f'<p style="color:#999;font-size:11px;margin-top:24px">Reply via the Owner Portal → Ops → Support.</p>'
        f'</div></div>'
    )


def landing_leads_digest_email(leads: list[dict], date_label: str) -> tuple[str, str]:
    """Render the end-of-day summary of kandapos.com "Book a demo" /
    "Sign up for updates" submissions — see background_tasks.py's
    leads_digest_loop, which fires this once daily at 23:55 IST."""
    demo_count = sum(1 for l in leads if l["type"] == "demo")
    updates_count = sum(1 for l in leads if l["type"] == "updates")
    subject = f"[Kanda POS website] Daily leads digest — {date_label} ({len(leads)} total)"

    if not leads:
        body_html = '<p style="color:#666;font-size:13px">No submissions today.</p>'
    else:
        rows_html = "".join(
            '<tr style="border-top:1px solid #eee">'
            f'<td style="padding:8px 12px 8px 0;color:#111;font-size:13px;vertical-align:top">'
            f'<b>{"Demo" if l["type"] == "demo" else "Waitlist"}</b></td>'
            f'<td style="padding:8px 12px 8px 0;color:#111;font-size:13px;vertical-align:top">{l.get("name") or "—"}</td>'
            f'<td style="padding:8px 12px 8px 0;color:#111;font-size:13px;vertical-align:top">{l["email"]}</td>'
            f'<td style="padding:8px 12px 8px 0;color:#111;font-size:13px;vertical-align:top">{l.get("phone") or "—"}</td>'
            f'<td style="padding:8px 12px 8px 0;color:#111;font-size:13px;vertical-align:top">{l.get("business") or "—"}</td>'
            f'<td style="padding:8px 0;color:#111;font-size:13px;vertical-align:top">{l.get("city") or "—"}</td>'
            "</tr>"
            for l in leads
        )
        body_html = (
            '<table style="border-collapse:collapse;width:100%">'
            '<tr><th style="text-align:left;padding:0 12px 6px 0;color:#888;font-size:11px;text-transform:uppercase">Type</th>'
            '<th style="text-align:left;padding:0 12px 6px 0;color:#888;font-size:11px;text-transform:uppercase">Name</th>'
            '<th style="text-align:left;padding:0 12px 6px 0;color:#888;font-size:11px;text-transform:uppercase">Email</th>'
            '<th style="text-align:left;padding:0 12px 6px 0;color:#888;font-size:11px;text-transform:uppercase">Phone</th>'
            '<th style="text-align:left;padding:0 12px 6px 0;color:#888;font-size:11px;text-transform:uppercase">Business</th>'
            '<th style="text-align:left;padding:0;color:#888;font-size:11px;text-transform:uppercase">City</th></tr>'
            f'{rows_html}</table>'
        )

    return subject, (
        '<div style="font-family:Inter,Arial,sans-serif;background:#fafafa;padding:24px">'
        '<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:12px;padding:24px">'
        f'<h2 style="margin:0 0 4px;color:#111">Daily leads digest</h2>'
        f'<div style="color:#666;font-size:13px;margin-bottom:16px">{date_label} · '
        f'{demo_count} demo request{"s" if demo_count != 1 else ""}, '
        f'{updates_count} waitlist sign-up{"s" if updates_count != 1 else ""}</div>'
        f'{body_html}'
        '<p style="color:#999;font-size:11px;margin-top:24px">Full list, filterable and always up to date, in the Owner Portal → Website leads.</p>'
        '</div></div>'
    )


def purchase_order_email(item: dict, tenant: dict, qty_ordered: float) -> tuple[str, str]:
    """Render a reorder notification email sent to a supplier's contact address."""
    store_name = tenant.get("store", {}).get("name") or tenant.get("name") or "Kanda POS"
    subject = f"Purchase order — {item['name']} × {qty_ordered:g} {item['unit']} — {store_name}"
    return subject, (
        f'<div style="font-family:Inter,Arial,sans-serif;background:#fafafa;padding:24px">'
        f'<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:12px;padding:24px">'
        f'<h2 style="margin:0 0 4px;color:#111">Purchase order from {store_name}</h2>'
        f'<p style="color:#666;font-size:13px;margin:0 0 16px">Hi {item.get("supplier","there")}, please arrange the following delivery:</p>'
        f'<table style="border-collapse:collapse;width:100%;margin-bottom:16px">'
        f'<tr><td style="padding:4px 12px 4px 0;color:#888;font-size:12px">Item</td>'
        f'<td style="padding:4px 0;color:#111;font-size:13px"><b>{item["name"]}</b></td></tr>'
        f'<tr><td style="padding:4px 12px 4px 0;color:#888;font-size:12px">Quantity</td>'
        f'<td style="padding:4px 0;color:#111;font-size:13px"><b>{qty_ordered:g} {item["unit"]}</b></td></tr>'
        f'</table>'
        f'<p style="color:#999;font-size:11px;margin-top:24px">Sent automatically by Kanda POS inventory management.</p>'
        f'</div></div>'
    )


def gift_card_email(card: dict, tenant: dict) -> tuple[str, str]:
    """Render a "you've got a gift card" email sent to the recipient."""
    store_name = tenant.get("store", {}).get("name") or tenant.get("name") or "Kanda POS"
    subject = f"You've received a ₹{card['initial_value']:.0f} gift card from {store_name}"
    return subject, (
        f'<div style="font-family:Inter,Arial,sans-serif;background:#fafafa;padding:24px">'
        f'<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:12px;padding:24px;text-align:center">'
        f'<h2 style="margin:0 0 4px;color:#111">Gift card from {store_name}</h2>'
        f'<p style="color:#666;font-size:13px;margin:8px 0 20px">Hi {card.get("recipient_name") or "there"}, someone sent you a gift card!</p>'
        f'<div style="background:#fdf0e3;border:1px dashed #d97706;border-radius:10px;padding:20px;margin-bottom:16px">'
        f'<div style="color:#92400e;font-size:12px;letter-spacing:1px">GIFT CARD CODE</div>'
        f'<div style="color:#111;font-size:26px;font-weight:700;letter-spacing:2px;margin-top:6px">{card["code"]}</div>'
        f'<div style="color:#92400e;font-size:14px;margin-top:8px">Value: ₹{card["initial_value"]:.2f}</div>'
        f'</div>'
        f'<p style="color:#666;font-size:12px">Show this code at checkout to redeem — in full or across multiple visits.</p>'
        f'<p style="color:#999;font-size:11px;margin-top:24px">Sent automatically by Kanda POS.</p>'
        f'</div></div>'
    )


def order_receipt_email(order: dict, tenant: dict) -> tuple[str, str]:
    """Render a customer-facing receipt email for a paid POS order."""
    store_name = tenant.get("store", {}).get("name") or tenant.get("name") or "Kanda POS"
    subject = f"Receipt — Order #{order['number']} from {store_name}"
    items_html = "".join(
        f'<tr>'
        f'<td style="padding:6px 0;color:#111;font-size:13px">{it.get("name", "")}'
        f'{(" (" + it.get("size") + ")") if it.get("size") else ""}</td>'
        f'<td style="padding:6px 0;color:#666;font-size:13px;text-align:center">×{it.get("qty", 1)}</td>'
        f'<td style="padding:6px 0;color:#111;font-size:13px;text-align:right">₹{(it.get("price", 0) * it.get("qty", 1)):.2f}</td>'
        f'</tr>'
        for it in order.get("items", [])
    )
    delivery = order.get("deliveryFee", 0) or 0
    discount = order.get("discount", 0) or 0
    tip = order.get("tip", 0) or 0
    rows = [
        f'<tr><td style="padding:4px 0;color:#666;font-size:12px">Subtotal</td>'
        f'<td style="padding:4px 0;text-align:right;color:#111;font-size:13px">'
        f'₹{(order["total"] - delivery + discount - tip):.2f}</td></tr>'
    ]
    if delivery:
        rows.append(f'<tr><td style="padding:4px 0;color:#666;font-size:12px">Delivery</td><td style="padding:4px 0;text-align:right;color:#111;font-size:13px">₹{delivery:.2f}</td></tr>')
    if discount:
        rows.append(f'<tr><td style="padding:4px 0;color:#666;font-size:12px">Discount</td><td style="padding:4px 0;text-align:right;color:#0a7c3a;font-size:13px">−₹{discount:.2f}</td></tr>')
    if tip:
        rows.append(f'<tr><td style="padding:4px 0;color:#666;font-size:12px">Tip</td><td style="padding:4px 0;text-align:right;color:#111;font-size:13px">₹{tip:.2f}</td></tr>')
    loy_html = ""
    if order.get("loyalty_earned"):
        loy_html = (f'<p style="margin:12px 0 0;font-size:12px;color:#0a7c3a">'
                    f'You earned <b>{order["loyalty_earned"]} loyalty points</b> on this order. Thanks for visiting!</p>')
    return subject, (
        f'<div style="font-family:Inter,Arial,sans-serif;background:#fafafa;padding:24px">'
        f'<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:12px;padding:24px">'
        f'<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">'
        f'<div><h2 style="margin:0;color:#111">{store_name}</h2>'
        f'<div style="color:#888;font-size:12px;margin-top:4px">{tenant.get("store",{}).get("address","")}</div></div>'
        f'<div style="text-align:right"><div style="color:#888;font-size:11px">RECEIPT</div>'
        f'<div style="color:#111;font-weight:700">#{order["number"]}</div></div></div>'
        f'<table style="width:100%;border-collapse:collapse;border-top:1px dashed #e0e0e0;margin-top:8px">{items_html}</table>'
        f'<table style="width:100%;border-collapse:collapse;border-top:1px dashed #e0e0e0;margin-top:8px">{"".join(rows)}</table>'
        f'<div style="border-top:1px solid #111;margin-top:12px;padding-top:12px;display:flex;justify-content:space-between">'
        f'<span style="font-weight:700;color:#111">TOTAL</span>'
        f'<span style="font-weight:700;color:#111;font-size:18px">₹{order["total"]:.2f}</span></div>'
        f'<p style="margin:12px 0 0;font-size:12px;color:#888">Paid via {order.get("payment","cash")}</p>'
        f'{loy_html}'
        f'<p style="margin:16px 0 0;font-size:11px;color:#bbb">Sent by Kanda POS · {order.get("placedAt","")}</p>'
        f'</div></div>'
    )
