"""WhatsApp two-way chat via Twilio.

Setup:
  - `TWILIO_WHATSAPP_FROM` env — sender in "whatsapp:+..." form. Defaults to
    Twilio's sandbox number so this works out of the box; production tenants
    should replace it with their approved WhatsApp Business number.
  - Twilio Sandbox → Sandbox Settings → paste our webhook URL:
        POST  <PUBLIC_BACKEND_URL>/api/whatsapp/incoming

Data model:
  - `wa_conversations` — one row per (tenant_id, phone) pair. Tracks last
    message preview, unread count, customer name if we could match it.
  - `wa_messages`     — every message (in and out), linked by conversation_id.

WebSocket broadcast:
  - `wa.message.new` — payload includes the whole message row so the chat UI
    can render it live.
"""
from __future__ import annotations

import asyncio
import logging
import re
import os
import uuid
from datetime import datetime, timezone
from tz import now_ist
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from twilio.request_validator import RequestValidator
from twilio.rest import Client as TwilioClient

from db import get_db
from auth import get_current_user, require_role, forbid_demo_tenant
from tenants import tenant_filter
from sms_service import normalize_phone
from receipts import bill_link_url
from ws import schedule_broadcast

logger = logging.getLogger("kanda.whatsapp")
router = APIRouter()


# ===================================================================
# Helpers
# ===================================================================
def _wa_from() -> str:
    return os.environ.get("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886").strip()


def _twilio_client() -> Optional[TwilioClient]:
    sid = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
    tok = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
    if not sid or not tok:
        return None
    return TwilioClient(sid, tok)


def _to_wa_address(phone: str) -> str:
    """Turn '+919876...' → 'whatsapp:+919876...'. If already prefixed, leave it."""
    p = phone or ""
    if p.startswith("whatsapp:"):
        return p
    n = normalize_phone(p)
    return f"whatsapp:{n}" if n else ""


def _strip_wa(addr: str) -> str:
    """'whatsapp:+919876...' → '+919876...'"""
    return (addr or "").replace("whatsapp:", "").strip()


async def _upsert_conversation(db, tenant_id: str, phone: str,
                               last_body: str, direction: str,
                               inc_unread: int = 0) -> dict:
    """Insert or update the conversation row. Returns the current doc
    (without Mongo's internal `_id`)."""
    now = now_ist().isoformat()
    existing = await db.wa_conversations.find_one(
        {"tenant_id": tenant_id, "phone": phone}, {"_id": 0}
    )
    if existing:
        upd = {
            "last_at": now,
            "last_body": last_body[:200],
            "last_direction": direction,
        }
        if inc_unread:
            new_unread = int(existing.get("unread_count", 0)) + inc_unread
            upd["unread_count"] = new_unread
        await db.wa_conversations.update_one(
            {"id": existing["id"]}, {"$set": upd}
        )
        return {**existing, **upd}
    # Try to enrich with a customer name if the phone matches one we know.
    tail = phone[-10:] if len(phone) >= 10 else phone
    customer = await db.customers.find_one(
        {"tenant_id": tenant_id, "phone": {"$in": [phone, tail]}, "deleted": {"$ne": True}},
        {"_id": 0, "id": 1, "name": 1},
    )
    conv = {
        "id": f"wac_{uuid.uuid4().hex[:10]}",
        "tenant_id": tenant_id,
        "phone": phone,
        "customer_id": (customer or {}).get("id"),
        "customer_name": (customer or {}).get("name"),
        "created_at": now,
        "last_at": now,
        "last_body": last_body[:200],
        "last_direction": direction,
        "unread_count": inc_unread,
    }
    # insert_one mutates conv and adds an ObjectId `_id`; copy before insert so
    # what we return is JSON-serialisable.
    await db.wa_conversations.insert_one({**conv})
    return conv


async def _insert_message(db, *, tenant_id: str, conversation_id: str, phone: str,
                          direction: str, body: str, sent_by: Optional[str] = None,
                          twilio_sid: Optional[str] = None,
                          error: Optional[str] = None,
                          media_url: Optional[str] = None) -> dict:
    doc = {
        "id": f"wam_{uuid.uuid4().hex[:10]}",
        "tenant_id": tenant_id,
        "conversation_id": conversation_id,
        "phone": phone,
        "direction": direction,  # "in" (customer→us) | "out" (us→customer)
        "body": body,
        "sent_by": sent_by,
        "media_url": media_url,
        "twilio_sid": twilio_sid,
        "status": "delivered" if direction == "in" else ("sent" if not error and twilio_sid else "failed"),
        "error": error,
        "at": now_ist().isoformat(),
        "read": direction == "out",
    }
    # Copy before insert so the returned dict stays JSON-clean.
    await db.wa_messages.insert_one({**doc})
    schedule_broadcast("wa.message.new", {k: v for k, v in doc.items() if k != "tenant_id"}, tenant_id)
    return doc


# ===================================================================
# Twilio webhook — incoming customer messages
# ===================================================================
def _validate_signature(request: Request, form: dict) -> bool:
    if os.environ.get("TWILIO_SIGNATURE_VALIDATION", "true").lower() in ("0", "false", "no"):
        return True
    tok = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
    if not tok:
        return False
    sig = request.headers.get("X-Twilio-Signature", "")
    if not sig:
        return False
    url = str(request.url)
    public = os.environ.get("PUBLIC_BACKEND_URL", "").rstrip("/")
    if public and url.startswith("http://"):
        path_q = url.split("://", 1)[1].split("/", 1)[-1]
        url = f"{public}/{path_q}" if not path_q.startswith("/") else f"{public}{path_q}"
    return RequestValidator(tok).validate(url, dict(form), sig)


@router.get("/whatsapp/templates")
async def list_templates(user: dict = Depends(get_current_user)):
    """Fetch approved WhatsApp Content Templates from Twilio so the UI can
    let owners send outside the 24-hour customer-service window.

    Twilio Content Templates carry the approval status per channel. We return
    only those approved for the `whatsapp` channel."""
    client = _twilio_client()
    if client is None:
        raise HTTPException(status_code=500, detail="Twilio credentials missing on server")
    out: list[dict] = []
    try:
        # Use the content_and_approvals resource so we can filter by
        # approved WhatsApp templates in a single call.
        rows = await asyncio.to_thread(lambda: list(client.content.v1.content_and_approvals.list(limit=100)))
        for r in rows:
            approvals = getattr(r, "approval_requests", None) or {}
            wa = approvals.get("whatsapp") if isinstance(approvals, dict) else None
            status = (wa or {}).get("status") if wa else None
            if status and status.lower() != "approved":
                continue
            variables = getattr(r, "variables", None) or {}
            types = getattr(r, "types", None) or {}
            # Pick a preview body from whichever type is present (text/twilio/list/etc.).
            preview = ""
            for key in ("twilio/text", "twilio/list-picker", "twilio/card", "twilio/quick-reply"):
                if key in types and isinstance(types[key], dict):
                    preview = types[key].get("body") or types[key].get("title") or ""
                    if preview:
                        break
            out.append({
                "sid": r.sid,
                "friendly_name": getattr(r, "friendly_name", "") or r.sid,
                "language": getattr(r, "language", "en"),
                "preview": preview,
                "variables": variables,
            })
    except Exception as exc:  # noqa: BLE001
        logger.warning("Fetching Twilio content templates failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Twilio templates fetch failed: {exc}")
    return out


class SendTemplatePayload(BaseModel):
    to: str
    content_sid: str
    variables: dict[str, str] = Field(default_factory=dict)


@router.post("/whatsapp/send-template", dependencies=[Depends(forbid_demo_tenant)])
async def wa_send_template(payload: SendTemplatePayload,
                           user: dict = Depends(require_role("Manager"))):
    """Send an approved WhatsApp template. Works outside the 24-hour window."""
    import json as _json
    client = _twilio_client()
    if client is None:
        raise HTTPException(status_code=500, detail="Twilio credentials missing on server")
    to_addr = _to_wa_address(payload.to)
    if not to_addr:
        raise HTTPException(status_code=400, detail="Invalid recipient number")
    from_addr = _wa_from()
    phone = _strip_wa(to_addr)

    db = get_db()
    # Fetch the template server-side to (a) render a persisted preview and
    # (b) know exactly which variables it declares — so we can strip any
    # extras the caller passed. Twilio rejects the whole send if we include
    # keys that aren't in the template's declared variables dict.
    rendered = ""
    declared_vars: dict = {}
    try:
        content = await asyncio.to_thread(lambda: client.content.v1.contents(payload.content_sid).fetch())
        declared_vars = dict(getattr(content, "variables", None) or {})
        types = getattr(content, "types", None) or {}
        for key in ("twilio/text", "twilio/card", "twilio/quick-reply", "twilio/list-picker"):
            if key in types and isinstance(types[key], dict):
                rendered = types[key].get("body") or ""
                break
        for k, v in (payload.variables or {}).items():
            rendered = rendered.replace("{{" + k + "}}", str(v))
    except Exception:
        rendered = f"[template {payload.content_sid}]"

    # Only forward keys that Twilio actually declared for this template.
    allowed_vars = {
        k: str(v) for k, v in (payload.variables or {}).items()
        if k in declared_vars
    } if declared_vars else dict(payload.variables or {})

    conv = await _upsert_conversation(db, user["tenant_id"], phone, rendered or "[template]", direction="out")

    twilio_sid = None
    error = None
    try:
        base = os.environ.get("PUBLIC_BACKEND_URL", "").rstrip("/")
        create_kwargs = {
            "to": to_addr, "from_": from_addr,
            "content_sid": payload.content_sid,
        }
        if allowed_vars:
            create_kwargs["content_variables"] = _json.dumps(allowed_vars)
        if base:
            create_kwargs["status_callback"] = f"{base}/api/whatsapp/status-callback"
        msg = await asyncio.to_thread(client.messages.create, **create_kwargs)
        twilio_sid = msg.sid
    except Exception as exc:  # noqa: BLE001
        code = getattr(exc, "code", None)
        detail = getattr(exc, "msg", None) or str(exc)
        if code == 63051 or "invalid phone" in detail.lower():
            error = f"{phone} isn't a valid WhatsApp user — check the number is correct and the customer has WhatsApp installed."
        elif "content variables" in detail.lower():
            error = "Template variables don't match. Template declares: " + (", ".join(declared_vars.keys()) if declared_vars else "(unknown)") + ". Please re-open the template picker and fill only the declared variables."
        else:
            error = detail
        logger.warning("WA template send to %s failed (code=%s): %s", phone, code, detail)

    doc = await _insert_message(
        db, tenant_id=user["tenant_id"], conversation_id=conv["id"], phone=phone,
        direction="out", body=rendered or "[template message]",
        sent_by=user.get("name") or user["id"],
        twilio_sid=twilio_sid, error=error,
    )
    return {"ok": error is None, "message": {k: v for k, v in doc.items() if k != "tenant_id"},
            "error": error, "content_sid": payload.content_sid}


@router.post("/whatsapp/status-callback")
async def wa_status_callback(request: Request):
    """Twilio posts here when a message's status changes: queued → sent →
    delivered → read (or failed/undelivered). We update the matching wa_messages
    row and broadcast a `wa.message.status` event so the chat UI updates."""
    form = await request.form()
    form_dict = {k: v for k, v in form.items()}
    if not _validate_signature(request, form_dict):
        logger.warning("Rejecting WA status callback with bad signature")
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")
    sid = form.get("MessageSid") or ""
    status = form.get("MessageStatus") or ""
    error_code = form.get("ErrorCode") or None
    error_msg = form.get("ErrorMessage") or None
    if not sid:
        return Response(status_code=204)
    db = get_db()
    doc = await db.wa_messages.find_one({"twilio_sid": sid}, {"_id": 0})
    if not doc:
        return Response(status_code=204)

    friendly = error_msg
    if error_code == "63016" or (error_msg and "outside the allowed window" in error_msg.lower()):
        friendly = "24-hour customer-service window expired. Ask the customer to text you first (or send an approved template)."
    elif error_code == "63007" or (error_msg and "not currently reachable" in (error_msg or "").lower()):
        friendly = "Recipient hasn't opted in to your WhatsApp sandbox. Ask them to text 'join <phrase>' to +14155238886."
    elif error_code == "63024":
        friendly = "Recipient number isn't a valid WhatsApp user."
    elif error_code == "63051":
        friendly = "WhatsApp couldn't deliver — the recipient may not have WhatsApp installed, has blocked business messages, or their account is unreachable."

    updates = {"status": status}
    if error_code:
        updates["error"] = friendly or f"Twilio error {error_code}"
        updates["twilio_error_code"] = error_code

    await db.wa_messages.update_one({"twilio_sid": sid}, {"$set": updates})
    schedule_broadcast("wa.message.status", {
        "message_id": doc["id"],
        "conversation_id": doc["conversation_id"],
        "twilio_sid": sid,
        "status": status,
        "error": updates.get("error"),
    }, doc["tenant_id"])
    return Response(status_code=204)


@router.get("/whatsapp/sandbox-info")
async def sandbox_info(user: dict = Depends(get_current_user)):
    """Return the sender status + inbound webhook URL so the dashboard
    can show step-by-step opt-in / troubleshooting instructions."""
    import requests as _rq
    base = os.environ.get("PUBLIC_BACKEND_URL", "").rstrip("/")
    wa_from = _wa_from()
    sender_status = None
    sender_props = {}
    is_sandbox = "14155238886" in wa_from
    sid_env = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
    tok_env = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
    if sid_env and tok_env and not is_sandbox:
        try:
            r = await asyncio.to_thread(
                lambda: _rq.get(
                    "https://messaging.twilio.com/v2/Channels/Senders",
                    auth=(sid_env, tok_env),
                    params={"Channel": "whatsapp"},
                    timeout=10,
                )
            )
            if r.ok:
                for s in r.json().get("senders", []):
                    if s.get("sender_id") == wa_from:
                        sender_status = s.get("status")
                        sender_props = s.get("properties", {}) or {}
                        break
        except Exception as exc:
            logger.warning("Could not fetch WA sender status: %s", exc)
    return {
        "from_number": wa_from,
        "from_display": wa_from.replace("whatsapp:", ""),
        "is_sandbox": is_sandbox,
        "sender_status": sender_status,  # ONLINE | OFFLINE | null
        "sender_quality": sender_props.get("quality_rating"),
        "sender_limit": sender_props.get("messaging_limit"),
        "join_phrase": os.environ.get("TWILIO_WHATSAPP_JOIN_PHRASE", "").strip(),
        "inbound_webhook_url": f"{base}/api/whatsapp/incoming" if base else "",
        "status_callback_url": f"{base}/api/whatsapp/status-callback" if base else "",
    }


@router.post("/whatsapp/incoming")
async def wa_incoming(request: Request):
    """Twilio POSTs here whenever a customer sends us a WhatsApp message.
    Body params (standard Twilio): From, To, Body, MessageSid, NumMedia,
    MediaUrl0, ProfileName, WaId.
    We MUST verify the signature to avoid spoofed messages."""
    form = await request.form()
    form_dict = {k: v for k, v in form.items()}
    if not _validate_signature(request, form_dict):
        logger.warning("Rejecting WA incoming with bad signature")
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")

    to_addr = form.get("To", "")     # our number  → find tenant
    from_addr = form.get("From", "") # customer
    body = (form.get("Body") or "").strip()
    twilio_sid = form.get("MessageSid") or None
    profile_name = form.get("ProfileName") or ""
    num_media = int(form.get("NumMedia", "0") or 0)
    media_url = form.get("MediaUrl0") if num_media > 0 else None

    # Match tenant by their configured WA number. For the shared sandbox this
    # is the sandbox itself; when multi-tenant WA business numbers are used,
    # each tenant can set its own in the future.
    db = get_db()
    tenant = await db.tenants.find_one(
        {"$or": [
            {"whatsapp.number": to_addr},
            {"whatsapp.number": _strip_wa(to_addr)},
        ]},
        {"_id": 0, "id": 1, "name": 1},
    )
    # No fallback: an unmatched message must not land in another store's
    # inbox (it used to go to the public demo store).
    if not tenant:
        logger.warning("Incoming WA with no matching tenant (to=%s)", to_addr)
        return Response(content="<Response/>", media_type="application/xml")

    phone = _strip_wa(from_addr)
    conv = await _upsert_conversation(
        db, tenant["id"], phone, body or ("[media]" if media_url else ""),
        direction="in", inc_unread=1,
    )
    if profile_name and not conv.get("customer_name"):
        await db.wa_conversations.update_one(
            {"id": conv["id"]}, {"$set": {"customer_name": profile_name[:80]}}
        )
        conv["customer_name"] = profile_name

    await _insert_message(
        db, tenant_id=tenant["id"], conversation_id=conv["id"], phone=phone,
        direction="in", body=body, twilio_sid=twilio_sid, media_url=media_url,
    )

    # Reply is optional — return empty TwiML so Twilio doesn't auto-forward.
    return Response(content="<Response/>", media_type="application/xml")


# ===================================================================
# Send from the dashboard
# ===================================================================
class SendWaPayload(BaseModel):
    to: str
    body: str = Field(min_length=1, max_length=1500)


@router.post("/whatsapp/send", dependencies=[Depends(forbid_demo_tenant)])
async def wa_send(payload: SendWaPayload, user: dict = Depends(require_role("Manager"))):
    client = _twilio_client()
    if client is None:
        raise HTTPException(status_code=500, detail="Twilio credentials missing on server")
    to_addr = _to_wa_address(payload.to)
    if not to_addr:
        raise HTTPException(status_code=400, detail="Invalid recipient number")
    from_addr = _wa_from()
    phone = _strip_wa(to_addr)

    db = get_db()
    conv = await _upsert_conversation(
        db, user["tenant_id"], phone, payload.body, direction="out",
    )

    twilio_sid = None
    error = None
    try:
        # Twilio will POST delivery updates (sent/delivered/read/failed/undelivered)
        # to /api/whatsapp/status-callback so we can surface them in the UI.
        base = os.environ.get("PUBLIC_BACKEND_URL", "").rstrip("/")
        status_cb = f"{base}/api/whatsapp/status-callback" if base else None
        create_kwargs = {"to": to_addr, "from_": from_addr, "body": payload.body}
        if status_cb:
            create_kwargs["status_callback"] = status_cb
        msg = await asyncio.to_thread(client.messages.create, **create_kwargs)
        twilio_sid = msg.sid
    except Exception as exc:  # noqa: BLE001
        code = getattr(exc, "code", None)
        detail = getattr(exc, "msg", None) or str(exc)
        if code == 63007 or "not currently reachable" in detail.lower() or "sandbox" in detail.lower():
            error = "Recipient hasn't joined WhatsApp yet. Ask them to text 'join <phrase>' to your sandbox number first."
        elif code == 21211:
            error = f"Invalid number: {phone}. Include country code (+91…)."
        elif code == 63016:
            error = "24-hour window closed — this customer hasn't messaged you in 24 h. Use an approved template instead."
        elif code == 63051 or "unable to send" in detail.lower():
            error = f"WhatsApp couldn't deliver to {phone}. Common causes: (1) the number isn't a WhatsApp user, (2) the recipient blocked business messages, (3) their app is out of date. Try a different test number."
        else:
            error = detail
        logger.warning("WA send to %s failed (code=%s): %s", phone, code, detail)

    doc = await _insert_message(
        db, tenant_id=user["tenant_id"], conversation_id=conv["id"], phone=phone,
        direction="out", body=payload.body, sent_by=user.get("name") or user["id"],
        twilio_sid=twilio_sid, error=error,
    )
    return {"ok": error is None, "message": {k: v for k, v in doc.items() if k != "tenant_id"},
            "error": error}


# ===================================================================
# Reads
# ===================================================================
@router.get("/whatsapp/conversations")
async def list_conversations(user: dict = Depends(get_current_user)):
    db = get_db()
    rows = await (
        db.wa_conversations.find(tenant_filter(user), {"_id": 0})
        .sort("last_at", -1).to_list(200)
    )
    # Attach the timestamp of the most recent INBOUND (customer→us) message
    # so the UI can warn the manager when the 24-hour customer-service
    # window has expired and free-form sends will fail.
    for row in rows:
        latest_in = await db.wa_messages.find_one(
            {"tenant_id": user["tenant_id"], "conversation_id": row["id"], "direction": "in"},
            {"_id": 0, "at": 1}, sort=[("at", -1)],
        )
        row["last_inbound_at"] = (latest_in or {}).get("at")
    return rows


@router.get("/whatsapp/conversations/{conv_id}/messages")
async def list_messages(conv_id: str, user: dict = Depends(get_current_user),
                        limit: int = Query(200, le=500)):
    db = get_db()
    conv = await db.wa_conversations.find_one(
        tenant_filter(user, {"id": conv_id}), {"_id": 0}
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    msgs = await (
        db.wa_messages.find(
            tenant_filter(user, {"conversation_id": conv_id}), {"_id": 0}
        )
        .sort("at", 1).to_list(limit)
    )
    return {"conversation": conv, "messages": msgs}


@router.post("/whatsapp/conversations/{conv_id}/read")
async def mark_read(conv_id: str, user: dict = Depends(get_current_user)):
    db = get_db()
    r = await db.wa_conversations.update_one(
        tenant_filter(user, {"id": conv_id}), {"$set": {"unread_count": 0}}
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await db.wa_messages.update_many(
        tenant_filter(user, {"conversation_id": conv_id, "direction": "in", "read": {"$ne": True}}),
        {"$set": {"read": True}},
    )
    return {"ok": True}


@router.post("/whatsapp/conversations/start", dependencies=[Depends(forbid_demo_tenant)])
async def start_conversation(payload: SendWaPayload, user: dict = Depends(require_role("Manager"))):
    """Create a conversation shell for a phone number (without necessarily
    sending yet). Useful when a manager wants to open a thread to a new
    customer before typing the first message."""
    to_addr = _to_wa_address(payload.to)
    if not to_addr:
        raise HTTPException(status_code=400, detail="Invalid phone number")
    phone = _strip_wa(to_addr)
    db = get_db()
    conv = await _upsert_conversation(db, user["tenant_id"], phone, "", direction="out")
    return conv


# ===================================================================
# Outbound bills and review requests (launch scope)
# ===================================================================
# Sent from Kanda's main WhatsApp number with Meta-approved templates, so
# they work without the customer messaging first. Template SIDs come from
# the environment; until they're set the endpoint says so and sends nothing.
#   WA_BILL_CONTENT_SID    vars: 1 store name, 2 bill total, 3 bill link
#   WA_REVIEW_CONTENT_SID  vars: 1 store name, 2 review link
class OrderWhatsAppPayload(BaseModel):
    phone: str = Field(..., max_length=20)
    review: bool = False


async def _send_wa_template(client, to_addr: str, content_sid: str, variables: dict) -> str:
    import json as _json
    msg = await asyncio.to_thread(
        client.messages.create, to=to_addr, from_=_wa_from(),
        content_sid=content_sid, content_variables=_json.dumps(variables),
    )
    return msg.sid


@router.post("/orders/{order_id}/whatsapp", dependencies=[Depends(forbid_demo_tenant)])
async def whatsapp_order_bill(order_id: str, payload: OrderWhatsAppPayload, user: dict = Depends(get_current_user)):
    bill_sid = os.environ.get("WA_BILL_CONTENT_SID", "").strip()
    review_sid = os.environ.get("WA_REVIEW_CONTENT_SID", "").strip()
    client = _twilio_client()
    if not bill_sid or client is None:
        raise HTTPException(status_code=503, detail="WhatsApp bills aren't switched on yet")

    phone = normalize_phone(payload.phone)
    if not re.fullmatch(r"\+91[6-9]\d{9}", phone or ""):
        raise HTTPException(status_code=400, detail="Enter the customer's WhatsApp number")
    to_addr = f"whatsapp:{phone}"

    db = get_db()
    order = await db.orders.find_one(tenant_filter(user, {"id": order_id}), {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0}) or {}
    store = tenant.get("store") or {}
    store_name = (store.get("name") or tenant.get("name") or "").strip() or "our restaurant"
    review_url = (store.get("google_review_url") or "").strip()
    if payload.review and not (review_sid and review_url):
        raise HTTPException(status_code=400, detail="Add your Google review link in Business Details first")

    sent = []
    try:
        total = float(order.get("total") or 0) - float(order.get("refunded_amount") or 0)
        sent.append({"kind": "bill", "sid": await _send_wa_template(client, to_addr, bill_sid, {
            "1": store_name, "2": f"\u20b9{total:.2f}", "3": bill_link_url(user["tenant_id"], order_id),
        })})
        if payload.review:
            sent.append({"kind": "review", "sid": await _send_wa_template(client, to_addr, review_sid, {
                "1": store_name, "2": review_url,
            })})
    except Exception as exc:  # noqa: BLE001
        detail = getattr(exc, "msg", None) or str(exc)
        logger.warning("WA bill send for order %s failed: %s", order_id, detail)
        raise HTTPException(status_code=502, detail="WhatsApp couldn't deliver that. Check the number and try again.")

    at = now_ist().isoformat()
    await db.orders.update_one(
        tenant_filter(user, {"id": order_id}),
        {"$push": {"whatsapp_sent": {"$each": [{**s, "at": at, "by": user.get("name")} for s in sent]}}},
    )
    return {"ok": True, "sent": [s["kind"] for s in sent]}
