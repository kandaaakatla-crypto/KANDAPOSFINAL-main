"""AI calling agent — Twilio Voice ↔ OpenAI Realtime API bridge.

Inbound flow:
1. Customer dials a tenant's Twilio number.
2. Twilio POSTs to `/api/voice/twilio-incoming` → we match `To` param to a
   tenant by `tenant.voice.twilio_number` and return TwiML that opens a
   bidirectional `<Stream>` to `/api/voice/twilio-stream`.
3. Twilio opens a WebSocket and streams μ-law 8 kHz audio (base64).
4. We concurrently open a WebSocket to OpenAI Realtime API and bridge audio
   frames in both directions, configuring the session with the tenant-scoped
   system prompt + tools (`place_order`, `book_reservation`, `lookup_*`).
5. When the AI calls a tool, we run it inside our DB and feed the result back
   into the Realtime session — the model then continues the conversation.

Outbound calls + Twilio number purchase are deferred to a follow-up phase.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

import websockets
import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect, status
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel
from twilio.rest import Client as TwilioClient
from twilio.request_validator import RequestValidator
from twilio.twiml.voice_response import VoiceResponse, Connect, Stream

from db import get_db
from auth import get_current_user, require_role
from tenants import tenant_filter, get_tenant
from ws import schedule_broadcast
from ._shared import next_order_number

logger = logging.getLogger("kanda.voice")
router = APIRouter()


# ===================================================================
# Live bridge registry — tracks every in-progress Twilio↔OpenAI bridge
# so an authorised manager can inject "whisper" instructions mid-call.
# ===================================================================
LIVE_BRIDGES: dict[str, dict] = {}


def register_bridge(call_doc_id: str, tenant_id: str, openai_ws) -> None:
    LIVE_BRIDGES[call_doc_id] = {
        "tenant_id": tenant_id,
        "openai_ws": openai_ws,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "whispers": [],
    }


def unregister_bridge(call_doc_id: str) -> None:
    LIVE_BRIDGES.pop(call_doc_id, None)


# ===================================================================
# Settings + helpers
# ===================================================================
OPENAI_REALTIME_URL = (
    "wss://api.openai.com/v1/realtime?model="
    + os.environ.get("OPENAI_REALTIME_MODEL", "gpt-realtime")
)

DEFAULT_VOICE = "marin"  # warmer than 'alloy', less robotic

DEFAULT_VOICE_CONFIG = {
    "enabled": False,
    "twilio_number": "",
    "default_language": "te",  # Telugu (Telangana) — default for our target market
    "voice": DEFAULT_VOICE,
    "greeting": "",
    "persona": "",
}


def _twilio_client() -> Optional[TwilioClient]:
    sid = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
    tok = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
    if not sid or not tok:
        return None
    return TwilioClient(sid, tok)


def _validate_twilio_signature(request: Request, form: dict) -> bool:
    """Verify the `X-Twilio-Signature` header on an incoming webhook.
    Twilio signs the full URL + sorted POST body params with the account's
    Auth Token. If the signature is missing or invalid, we reject the call —
    that's the ONLY thing stopping an attacker from spoofing calls to burn
    our OpenAI credit and inject cross-tenant orders."""
    if os.environ.get("TWILIO_SIGNATURE_VALIDATION", "true").lower() in ("0", "false", "no"):
        # Escape hatch for local unit tests only. NEVER set in prod.
        return True
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
    if not auth_token:
        return False
    signature = request.headers.get("X-Twilio-Signature", "")
    if not signature:
        return False
    # The URL Twilio signed is the public one Twilio POSTed to.
    url = str(request.url)
    # If we're behind a proxy that terminated https, request.url may show http
    # — patch it back to the canonical public URL for signature validation.
    public = os.environ.get("PUBLIC_BACKEND_URL", "").rstrip("/")
    if public and url.startswith("http://"):
        # rebuild with the public origin
        path_q = url.split("://", 1)[1].split("/", 1)[-1]
        url = f"{public}/{path_q}" if not path_q.startswith("/") else f"{public}{path_q}"
    validator = RequestValidator(auth_token)
    return validator.validate(url, dict(form), signature)


# HMAC-signed short-lived JWT that authorises a specific tenant to use the
# WebSocket bridge. Only our own inbound webhook / outbound-call endpoint can
# mint one, so a stranger opening the WS cannot spoof a tenant_id.
STREAM_TOKEN_TTL_SECONDS = 300  # 5 minutes is plenty; Twilio opens the WS immediately


def _mint_stream_token(*, tenant_id: str, direction: str, call_sid: str = "",
                       from_number: str = "", to_number: str = "",
                       purpose: str = "", message: str = "") -> str:
    payload = {
        "tid": tenant_id,
        "dir": direction,
        "sid": call_sid,
        "from": from_number,
        "to": to_number,
        "purpose": purpose[:64] if purpose else "",
        "message": message[:240] if message else "",
        "exp": datetime.now(timezone.utc) + timedelta(seconds=STREAM_TOKEN_TTL_SECONDS),
        "iss": "kanda-voice",
    }
    return jwt.encode(payload, os.environ["JWT_SECRET"], algorithm="HS256")


def _verify_stream_token(token: str) -> Optional[dict]:
    if not token:
        return None
    try:
        return jwt.decode(token, os.environ["JWT_SECRET"], algorithms=["HS256"], issuer="kanda-voice")
    except Exception:
        return None


def _public_backend_base(request: Request) -> str:
    """The public origin Twilio uses to reach us (https://...).
    Prefer the explicit PUBLIC_BACKEND_URL env var; fall back to deriving from
    forwarded headers; last-resort use request.base_url (works locally)."""
    env_url = os.environ.get("PUBLIC_BACKEND_URL", "").strip().rstrip("/")
    if env_url:
        return env_url
    proto = request.headers.get("x-forwarded-proto", "https")
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    if host:
        return f"{proto}://{host}"
    return str(request.base_url).rstrip("/")


def _normalize_number(n: str) -> str:
    n = (n or "").strip().replace(" ", "").replace("-", "")
    if n and not n.startswith("+"):
        n = "+" + n
    return n


async def _tenant_by_twilio_number(db, to_number: str) -> Optional[dict]:
    to = _normalize_number(to_number)
    if not to:
        return None
    return await db.tenants.find_one(
        {"voice.twilio_number": to, "voice.enabled": True},
        {"_id": 0},
    )


# ===================================================================
# Per-tenant Voice CONFIG endpoints (Dashboard users)
# ===================================================================
class VoiceConfigPayload(BaseModel):
    enabled: Optional[bool] = None
    twilio_number: Optional[str] = None
    default_language: Optional[str] = None
    voice: Optional[str] = None
    greeting: Optional[str] = None
    persona: Optional[str] = None


@router.get("/voice/config")
async def get_voice_config(user: dict = Depends(get_current_user)):
    db = get_db()
    tenant = await get_tenant(user, db)
    cfg = {**DEFAULT_VOICE_CONFIG, **(tenant.get("voice") or {})}
    return {
        **cfg,
        "twilio_from_number": os.environ.get("TWILIO_FROM_NUMBER", ""),
        "webhook_url": f"{os.environ.get('PUBLIC_BACKEND_URL', '')}".rstrip("/")
                       + "/api/voice/twilio-incoming",
    }


@router.put("/voice/config")
async def update_voice_config(payload: VoiceConfigPayload, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    updates: dict[str, Any] = {}
    src = payload.model_dump(exclude_none=True)
    for k, v in src.items():
        if k == "twilio_number":
            v = _normalize_number(v)
        updates[f"voice.{k}"] = v
    if not updates:
        return await get_voice_config(user)
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": updates})
    return await get_voice_config(user)


@router.post("/voice/configure-twilio")
async def configure_twilio_webhook(request: Request, user: dict = Depends(require_role("Manager"))):
    """Auto-configure the tenant's Twilio number to point its inbound voice
    webhook at our backend. Requires the number to have been pasted into the
    tenant's voice config first."""
    db = get_db()
    tenant = await get_tenant(user, db)
    cfg = (tenant.get("voice") or {})
    number = _normalize_number(cfg.get("twilio_number") or "")
    if not number:
        raise HTTPException(status_code=400, detail="Set a Twilio number in voice config first")
    client = _twilio_client()
    if not client:
        raise HTTPException(status_code=500, detail="Twilio credentials missing on server")

    base = _public_backend_base(request)
    voice_url = f"{base}/api/voice/twilio-incoming"
    try:
        nums = await asyncio.to_thread(client.incoming_phone_numbers.list, phone_number=number, limit=1)
        if not nums:
            raise HTTPException(status_code=404, detail=f"Number {number} not found in this Twilio account")
        n = nums[0]
        await asyncio.to_thread(n.update, voice_url=voice_url, voice_method="POST")
        return {"ok": True, "configured_url": voice_url, "sid": n.sid}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("configure-twilio failed")
        raise HTTPException(status_code=502, detail=f"Twilio update failed: {exc}")


class PurchaseNumberPayload(BaseModel):
    phone_number: str
    set_as_tenant_default: bool = True
    friendly_name: Optional[str] = None


@router.get("/voice/numbers/available")
async def search_available_numbers(
    country: str = "US",
    area_code: Optional[str] = None,
    contains: Optional[str] = None,
    voice: bool = True,
    sms: bool = False,
    limit: int = 20,
    user: dict = Depends(require_role("Manager")),
):
    """Search Twilio's available number inventory.
    - country: ISO-3166 alpha-2 (US, IN, GB, AU, CA, ...).
    - area_code: 3-digit US area code, or country-specific prefix.
    - contains: alphanumeric pattern the number should contain (letters map to
                keypad digits per Twilio's convention).
    """
    client = _twilio_client()
    if not client:
        raise HTTPException(status_code=500, detail="Twilio credentials missing on server")
    limit = max(1, min(50, limit))
    try:
        listing = client.available_phone_numbers(country.upper()).local
        kwargs: dict[str, Any] = {"limit": limit}
        if area_code:
            kwargs["area_code"] = area_code
        if contains:
            kwargs["contains"] = contains
        if voice:
            kwargs["voice_enabled"] = True
        if sms:
            kwargs["sms_enabled"] = True
        nums = await asyncio.to_thread(listing.list, **kwargs)
        out = []
        for n in nums:
            caps = getattr(n, "capabilities", {}) or {}
            out.append({
                "phone_number": n.phone_number,
                "friendly_name": n.friendly_name,
                "locality": getattr(n, "locality", None),
                "region": getattr(n, "region", None),
                "iso_country": getattr(n, "iso_country", country.upper()),
                "voice": bool(caps.get("voice")),
                "sms": bool(caps.get("SMS") or caps.get("sms")),
                "mms": bool(caps.get("MMS") or caps.get("mms")),
            })
        return {"country": country.upper(), "results": out, "count": len(out)}
    except Exception as exc:  # noqa: BLE001
        logger.exception("Number search failed")
        raise HTTPException(status_code=502, detail=f"Twilio search failed: {exc}")


@router.get("/voice/numbers/owned")
async def list_owned_numbers(user: dict = Depends(get_current_user)):
    """List phone numbers already provisioned on this Twilio account, along
    with which tenant (if any) has claimed each one for its voice agent."""
    client = _twilio_client()
    if not client:
        raise HTTPException(status_code=500, detail="Twilio credentials missing on server")
    db = get_db()
    try:
        nums = await asyncio.to_thread(client.incoming_phone_numbers.list, limit=100)
        # Look up which tenants claim these numbers.
        claimed = {}
        async for t in db.tenants.find({"voice.twilio_number": {"$exists": True, "$ne": ""}},
                                       {"_id": 0, "id": 1, "name": 1, "slug": 1, "voice.twilio_number": 1}):
            claimed[(t.get("voice") or {}).get("twilio_number", "")] = {
                "tenant_id": t["id"], "tenant_name": t.get("name"), "tenant_slug": t.get("slug"),
            }
        out = []
        for n in nums:
            caps = getattr(n, "capabilities", {}) or {}
            out.append({
                "sid": n.sid,
                "phone_number": n.phone_number,
                "friendly_name": n.friendly_name,
                "voice_url": n.voice_url or "",
                "sms_url": getattr(n, "sms_url", "") or "",
                "voice": bool(caps.get("voice")),
                "sms": bool(caps.get("SMS") or caps.get("sms")),
                "claimed_by": claimed.get(n.phone_number),
            })
        return {"results": out, "count": len(out)}
    except Exception as exc:  # noqa: BLE001
        logger.exception("owned-numbers fetch failed")
        raise HTTPException(status_code=502, detail=f"Twilio fetch failed: {exc}")


@router.post("/voice/numbers/purchase")
async def purchase_number(payload: PurchaseNumberPayload, request: Request,
                          user: dict = Depends(require_role("Manager"))):
    """Buy a number from Twilio and (optionally) claim it for this tenant.
    We pre-configure the voice webhook to point at our own inbound endpoint
    so the number is ready to answer calls immediately."""
    client = _twilio_client()
    if not client:
        raise HTTPException(status_code=500, detail="Twilio credentials missing on server")
    number = _normalize_number(payload.phone_number)
    if not number:
        raise HTTPException(status_code=400, detail="Invalid phone_number")

    base = _public_backend_base(request)
    voice_url = f"{base}/api/voice/twilio-incoming"

    try:
        purchased = await asyncio.to_thread(
            client.incoming_phone_numbers.create,
            phone_number=number,
            friendly_name=payload.friendly_name or f"Kanda POS {number}",
            voice_url=voice_url,
            voice_method="POST",
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Number purchase failed")
        msg = str(exc)
        # Common failure paths for Indian numbers — regulatory bundle required.
        if "regulatory" in msg.lower() or "bundle" in msg.lower():
            raise HTTPException(status_code=400, detail=(
                "Twilio requires a Regulatory Bundle (KYC docs) for numbers in this country. "
                "Complete it at https://console.twilio.com/us1/develop/phone-numbers/regulatory-compliance/bundles then retry."
            ))
        raise HTTPException(status_code=502, detail=f"Twilio purchase failed: {msg}")

    result = {
        "ok": True,
        "sid": purchased.sid,
        "phone_number": purchased.phone_number,
        "voice_url": voice_url,
        "claimed": False,
    }

    if payload.set_as_tenant_default:
        db = get_db()
        await db.tenants.update_one(
            {"id": user["tenant_id"]},
            {"$set": {"voice.twilio_number": purchased.phone_number, "voice.enabled": True}},
        )
        result["claimed"] = True

    logger.info("Purchased Twilio number %s (sid=%s) for tenant %s (claimed=%s)",
                purchased.phone_number, purchased.sid, user["tenant_id"], result["claimed"])
    return result


class OutboundCallPayload(BaseModel):
    to: str
    purpose: Optional[str] = "test_call"
    message: Optional[str] = None  # extra instructions appended to the prompt


@router.post("/voice/call")
async def place_outbound_call(payload: OutboundCallPayload, request: Request,
                              user: dict = Depends(require_role("Manager"))):
    """Initiate an outbound call from the tenant's Twilio number to `to`.
    The TwiML returned by Twilio opens a Media Stream back to our bridge so
    the AI agent can speak when the callee picks up."""
    db = get_db()
    tenant = await get_tenant(user, db)
    cfg = tenant.get("voice") or {}
    from_number = _normalize_number(cfg.get("twilio_number") or os.environ.get("TWILIO_FROM_NUMBER", ""))
    to = _normalize_number(payload.to)
    if not to:
        raise HTTPException(status_code=400, detail="Missing 'to' number")
    if not from_number:
        raise HTTPException(status_code=400, detail="No Twilio number configured for this tenant")
    client = _twilio_client()
    if not client:
        raise HTTPException(status_code=500, detail="Twilio credentials missing on server")

    base = _public_backend_base(request)
    wss_url = base.replace("http://", "wss://").replace("https://", "wss://") + "/api/voice/twilio-stream"
    stream_token = _mint_stream_token(
        tenant_id=tenant["id"], direction="outbound",
        from_number=from_number, to_number=to,
        purpose=payload.purpose or "", message=payload.message or "",
    )
    twiml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Response>'
        f'<Connect><Stream url="{wss_url}">'
        f'<Parameter name="token" value="{stream_token}" />'
        '</Stream></Connect>'
        '</Response>'
    )
    try:
        base_recording_cb = base + "/api/voice/recording-callback"
        call = await asyncio.to_thread(
            client.calls.create,
            to=to, from_=from_number, twiml=twiml,
            record=True,
            recording_channels="dual",
            recording_status_callback=base_recording_cb,
            recording_status_callback_event=["completed"],
            recording_status_callback_method="POST",
        )
        return {"ok": True, "call_sid": call.sid, "to": to, "from": from_number}
    except Exception as exc:  # noqa: BLE001
        logger.exception("Outbound call failed")
        raise HTTPException(status_code=502, detail=f"Twilio call failed: {exc}")


@router.post("/voice/recording-callback")
async def recording_callback(request: Request):
    """Twilio POSTs here when a call recording finishes. We stash the SID +
    duration on the matching voice_calls row so the dashboard can offer
    playback via our authenticated proxy endpoint."""
    form = await request.form()
    form_dict = {k: v for k, v in form.items()}
    if not _validate_twilio_signature(request, form_dict):
        logger.warning("Rejecting recording-callback with bad signature")
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")
    call_sid = form.get("CallSid") or ""
    recording_sid = form.get("RecordingSid") or ""
    duration = int(form.get("RecordingDuration", "0") or 0)
    if call_sid and recording_sid:
        db = get_db()
        await db.voice_calls.update_one(
            {"call_sid": call_sid},
            {"$set": {
                "recording_sid": recording_sid,
                "recording_duration": duration,
            }},
        )
        logger.info("Stored recording %s (%ss) for call %s", recording_sid, duration, call_sid)
    return Response(status_code=204)


@router.get("/voice/calls/{call_id}/recording.mp3")
async def get_call_recording(call_id: str, user: dict = Depends(get_current_user)):
    """Proxy the Twilio MP3 recording — keeps Twilio credentials off the wire.
    Tenant-scoped so a tenant cannot fetch another tenant's recording."""
    db = get_db()
    doc = await db.voice_calls.find_one(tenant_filter(user, {"id": call_id}), {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Call not found")
    rec_sid = doc.get("recording_sid") or ""
    if not rec_sid:
        raise HTTPException(status_code=404, detail="No recording captured for this call")
    sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
    tok = os.environ.get("TWILIO_AUTH_TOKEN", "")
    if not sid or not tok:
        raise HTTPException(status_code=500, detail="Twilio credentials missing on server")
    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Recordings/{rec_sid}.mp3"
    import httpx  # local import — httpx already in requirements via httpx dep
    async with httpx.AsyncClient(timeout=30.0, auth=(sid, tok)) as hc:
        r = await hc.get(url)
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Twilio returned {r.status_code}")
    return Response(
        content=r.content, media_type="audio/mpeg",
        headers={"Content-Disposition": f'inline; filename="call-{call_id}.mp3"'},
    )


@router.get("/voice/calls")
async def list_calls(user: dict = Depends(get_current_user), limit: int = Query(50, le=200)):
    db = get_db()
    docs = await (
        db.voice_calls.find(tenant_filter(user), {"_id": 0})
        .sort("started_at", -1)
        .to_list(limit)
    )
    return docs


@router.get("/voice/calls/active")
async def list_active_calls(user: dict = Depends(get_current_user)):
    """List currently-live bridges scoped to the caller's tenant. Used by the
    live panel to know which calls accept manager whispers."""
    tid = user["tenant_id"]
    out = [{"call_id": cid, "started_at": b.get("started_at"), "whisper_count": len(b.get("whispers") or [])}
           for cid, b in LIVE_BRIDGES.items() if b.get("tenant_id") == tid]
    return {"active": out, "count": len(out)}


@router.get("/voice/calls/{call_id}")
async def get_call(call_id: str, user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.voice_calls.find_one(tenant_filter(user, {"id": call_id}), {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Call not found")
    return doc


class WhisperPayload(BaseModel):
    message: str


@router.post("/voice/calls/{call_id}/whisper")
async def whisper_into_call(call_id: str, payload: WhisperPayload,
                            user: dict = Depends(require_role("Manager"))):
    """Inject a live "manager whisper" into an in-progress AI voice call.

    The whisper is delivered as a `system`-role turn to the OpenAI Realtime
    session so the AI folds it into its next spoken response WITHOUT
    repeating it verbatim to the caller. Only Managers/Owners on the same
    tenant may whisper. The whisper text is persisted on the call log so
    it can be audited post-call.
    """
    msg = (payload.message or "").strip()
    if not msg:
        raise HTTPException(status_code=400, detail="message required")
    if len(msg) > 500:
        raise HTTPException(status_code=400, detail="whisper too long (max 500 chars)")

    bridge = LIVE_BRIDGES.get(call_id)
    if not bridge:
        raise HTTPException(status_code=404, detail="Call is not currently active")
    if bridge.get("tenant_id") != user["tenant_id"]:
        raise HTTPException(status_code=403, detail="Forbidden — different tenant")
    openai_ws = bridge.get("openai_ws")
    if openai_ws is None:
        raise HTTPException(status_code=409, detail="Bridge exists but session not ready")

    # Inject as a system-role message so the model treats it as an operator
    # instruction rather than caller speech. Then force a response so the
    # AI immediately reflects the whisper in its next turn.
    manager_name = user.get("name") or "Manager"
    prefixed = (
        f"[MANAGER WHISPER from {manager_name} — invisible to the caller. "
        f"Fold this into your next reply naturally; do NOT read it out verbatim.]\n"
        f"{msg}"
    )
    try:
        await openai_ws.send(json.dumps({
            "type": "conversation.item.create",
            "item": {
                "type": "message",
                "role": "system",
                "content": [{"type": "input_text", "text": prefixed}],
            },
        }))
        await openai_ws.send(json.dumps({"type": "response.create"}))
    except Exception as exc:  # noqa: BLE001
        logger.exception("whisper send failed")
        raise HTTPException(status_code=502, detail=f"Whisper delivery failed: {exc}")

    now = datetime.now(timezone.utc).isoformat()
    entry = {"at": now, "by": manager_name, "text": msg}
    bridge.setdefault("whispers", []).append(entry)

    # Persist on the call log for audit + post-call review.
    db = get_db()
    await db.voice_calls.update_one(
        {"id": call_id, "tenant_id": user["tenant_id"]},
        {"$push": {"whispers": entry}},
    )

    # Broadcast to every dashboard listener on this tenant so all managers
    # see the whisper appear on the live panel.
    schedule_broadcast("voice.whisper.sent", {
        "id": call_id, "at": now, "by": manager_name, "text": msg,
    }, user["tenant_id"])

    return {"ok": True, "at": now}


# ===================================================================
# Twilio inbound webhook  →  TwiML <Connect><Stream>
# ===================================================================
@router.post("/voice/twilio-incoming")
async def twilio_incoming(request: Request):
    """Twilio calls this when a customer dials the tenant's number.
    We MUST verify the X-Twilio-Signature header before doing anything —
    otherwise anyone on the internet could spoof `To`/`From` and trigger
    paid OpenAI Realtime sessions on our account.
    On success we respond with TwiML that opens a bidirectional Media Stream
    to our WebSocket bridge, passing a *signed* stream token (not the raw
    tenant_id) so the bridge can trust who's on the other end.
    """
    form = await request.form()
    form_dict = {k: v for k, v in form.items()}
    if not _validate_twilio_signature(request, form_dict):
        logger.warning("Rejecting webhook with bad/missing X-Twilio-Signature (from IP %s)", request.client.host if request.client else "?")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid Twilio signature")

    to_number = form.get("To") or ""
    from_number = form.get("From") or ""
    call_sid = form.get("CallSid") or ""
    db = get_db()
    tenant = await _tenant_by_twilio_number(db, to_number)
    response = VoiceResponse()
    if not tenant:
        logger.warning("Inbound call to unknown/disabled number %s (from %s)", to_number, from_number)
        response.say(
            "Sorry, this number is not configured for an AI assistant. Please call again later.",
            voice="alice",
        )
        response.hangup()
        return Response(content=str(response), media_type="application/xml")

    base = _public_backend_base(request)
    wss_url = base.replace("http://", "wss://").replace("https://", "wss://") + "/api/voice/twilio-stream"

    stream_token = _mint_stream_token(
        tenant_id=tenant["id"], direction="inbound", call_sid=call_sid,
        from_number=from_number, to_number=to_number,
    )
    connect = Connect()
    stream = Stream(url=wss_url)
    # The token is the ONLY source of truth on the WS side. We still pass the
    # numbers for logging/UI convenience, but the bridge will not trust them.
    stream.parameter(name="token", value=stream_token)
    connect.append(stream)
    response.append(connect)
    return Response(content=str(response), media_type="application/xml")


# ===================================================================
# Per-tenant context loader (menu / hours / address) for the system prompt
# ===================================================================
async def _build_tenant_context(db, tenant: dict) -> str:
    """Compose a concise menu + store summary that fits in the system prompt
    without bloating the realtime session. Keep it under ~2 KB."""
    store = tenant.get("store") or {}
    name = store.get("name") or tenant.get("name") or "Kanda Restaurant"
    address = store.get("address") or ""
    phone = store.get("phone") or ""

    items = await db.menu_items.find(
        {"tenant_id": tenant["id"], "available": {"$ne": False}},
        {"_id": 0, "name": 1, "price": 1, "sizes": 1, "is_pizza": 1, "cat_id": 1, "desc": 1},
    ).to_list(200)
    categories = await db.categories.find(
        {"tenant_id": tenant["id"]}, {"_id": 0, "id": 1, "name": 1, "sort_order": 1}
    ).to_list(50)
    cat_by_id = {c["id"]: c["name"] for c in categories}

    lines: list[str] = []
    by_cat: dict[str, list[str]] = {}
    for it in items:
        cat = cat_by_id.get(it.get("cat_id"), "Other")
        sizes = it.get("sizes") or {}
        if isinstance(sizes, dict) and sizes:
            price_str = ", ".join(f"{k} ₹{v}" for k, v in list(sizes.items())[:3])
        else:
            price = it.get("price") or 0
            price_str = f"₹{price}"
        by_cat.setdefault(cat, []).append(f"{it['name']} ({price_str})")

    for cat, names in by_cat.items():
        if names:
            lines.append(f"  {cat}: " + "; ".join(names[:12]))

    menu_block = "\n".join(lines) if lines else "  (menu not yet configured)"
    return (
        f"Restaurant: {name}\n"
        f"Address: {address}\n"
        f"Phone: {phone}\n"
        f"Menu (item — price):\n{menu_block}"
    )


def _system_instructions(tenant: dict, menu_context: str, outbound_ctx: Optional[dict] = None,
                         customer: Optional[dict] = None) -> str:
    """Build the system prompt for the OpenAI Realtime session.
    Key goals: Telugu-first (Telangana dialect), natural conversational style,
    NEVER announce as an AI, greet in ONE language only (Telugu unless
    caller switches). Human warmth over robotic scripting."""
    cfg = tenant.get("voice") or {}
    lang_pref = cfg.get("default_language") or "te"  # Telugu default now
    lang_clause = {
        "en": (
            "Speak natural, everyday Indian English. Warm, friendly, unhurried. "
            "Casual — like a familiar shop owner, not a call-centre agent."
        ),
        "hi": (
            "पूरी बातचीत हिंदी में करें, सामान्य बोलचाल की भाषा में। दोस्ताना और गर्मजोशी से। "
            "जरूरत हो तो मेन्यू आइटम्स के नाम अंग्रेज़ी में बोल सकते हैं (जैसे 'pizza', 'margherita')।"
        ),
        "te": (
            "మొత్తం సంభాషణ తెలుగులో చేయండి — తెలంగాణా యాస (Telangana dialect), స్నేహపూర్వకమైన మాట తీరు. "
            "\"ఏం చేద్దాం?\", \"ఎట్లున్నారు?\", \"సరే మరి\", \"అలాగే\" లాంటి మాటలు వాడండి. "
            "మెనూ ఐటమ్స్ పేర్లు ఇంగ్లీష్‌లో చెప్పొచ్చు (ఉదా: 'margherita pizza', 'coke'). "
            "పూర్తిగా సంభాషణ శైలిలో, రోబోటిక్‌గా కాదు."
        ),
        "auto": (
            "Start speaking in TELUGU (Telangana dialect). If the caller replies in Hindi or "
            "English, switch to their language and stay in it. Never mix scripts mid-sentence."
        ),
    }.get(lang_pref, "")

    persona_extra = (cfg.get("persona") or "").strip()
    greeting = (cfg.get("greeting") or "").strip()
    store_name = (tenant.get("store") or {}).get("name") or tenant.get("name", "మా రెస్టారెంట్")
    if not greeting:
        # Simple, warm Telugu greeting — one language, no AI mention.
        greeting = f"హలో! {store_name}కి కాల్ చేసినందుకు ధన్యవాదాలు. చెప్పండి, ఏం కావాలి?"

    # Known-caller context — inject customer name + last address if we found them.
    caller_block = ""
    if customer:
        lines = [f"KNOWN CALLER: {customer.get('name', '')}"]
        if customer.get("address"):
            lines.append(f"Last delivery address on file: {customer['address']}")
        if customer.get("order_count"):
            lines.append(f"Repeat customer (past orders: {customer['order_count']})")
        if customer.get("last_order_summary"):
            lines.append(f"Usual order: {customer['last_order_summary']}")
        caller_block = (
            "\n--- CALLER RECOGNITION ---\n" + "\n".join(lines) + "\n"
            "→ Greet them BY NAME at the start (\"" + customer.get('name', '') + " గారు, హలో!\") "
            "and if they have a usual order, offer to place it again as their default. "
            "Skip asking for their name / phone / address unless they say something different.\n"
            "--- END CALLER RECOGNITION ---\n"
        )

    # Outbound calls — different intro: WE are calling THEM.
    if outbound_ctx:
        purpose = (outbound_ctx.get("purpose") or "").strip()
        message = (outbound_ctx.get("message") or "").strip()
        outbound_block = (
            "\n--- OUTBOUND CALL CONTEXT ---\n"
            f"YOU are calling the customer from {store_name}. Speak first — wait ~0.5s after "
            "the callee says 'hello', then start.\n"
            "Opening: brief, natural, in Telugu (Telangana). Do NOT mention that you are an AI. "
            f"Say who you are calling FROM ({store_name}), and get to the point.\n"
            f"Purpose: {purpose or 'follow-up call'}\n"
            + (f"Specific message to deliver: {message}\n" if message else "")
            + "--- END OUTBOUND CONTEXT ---\n"
        )
        greeting_block = ""
    else:
        outbound_block = ""
        greeting_block = f"When the call connects, greet the caller with something LIKE: \"{greeting}\" (paraphrase naturally — don't recite word-for-word).\n\n"

    return (
        f"You are a warm, friendly staff member answering the phone at {store_name}, "
        "a restaurant in Telangana, India. You take takeaway/delivery orders, book table "
        "reservations, and answer questions about menu, hours, and location.\n\n"
        "TONE — CRITICAL:\n"
        "- You are a HUMAN team member, not an AI. NEVER mention you are an AI, virtual, "
        "assistant, bot, or automated. If asked, say you're the staff on duty and move on.\n"
        "- Speak like a real person — pauses, filler words (\"సరే\", \"acha\", \"ok ok\"), "
        "  natural intonation. Not a robotic reader.\n"
        "- Keep every reply SHORT — 1 sentence, occasionally 2. This is a phone call.\n"
        "- LISTEN carefully. If you're not sure what the customer said, ask them to repeat "
        "  softly (\"కొంచెం మళ్ళీ చెప్తారా?\" / \"say that once more please?\").\n"
        "- Do NOT rush. Let the customer finish their sentence before responding.\n\n"
        "BACKGROUND NOISE — CRITICAL:\n"
        "- Callers often have a TV, radio, kids, or other conversations audible in the "
        "  background. IGNORE all of that. Only respond to speech that is CLEARLY addressed "
        "  to you (near-field, sustained, coherent request).\n"
        "- If the audio is muffled, distant, overlapping voices, or an unfinished fragment "
        "  that doesn't make sense as a request to a restaurant, STAY SILENT. Do NOT ask "
        "  them to repeat. Do NOT respond. Wait for the actual caller to speak directly.\n"
        "- Never react to background music, TV dialogue, or ambient chatter as if it were "
        "  a customer instruction. If in doubt, stay quiet.\n\n"
        f"LANGUAGE:\n{lang_clause}\n\n"
        + greeting_block
        + "RULES:\n"
        "1. Confirm every item + quantity + size before adding it. When they're done, "
        "   read back the FULL order and total once.\n"
        "2. Get the customer name + delivery address (for delivery orders only). If they're "
        "   a known caller (see CALLER RECOGNITION below), skip re-asking.\n"
        "3. NEVER invent menu items or prices — only what's in the menu below.\n"
        "4. Call `place_order` only after the customer has said something like 'yes, confirm', "
        "   'that's it', 'go ahead' — a clear final YES. Same for `book_reservation`.\n"
        "5. Call `end_call` ONLY when the customer clearly says goodbye / 'no thanks' / 'that's "
        "   all'. Do NOT end the call after a single silence — always ask 'ఇంకేమైనా కావాలా?' first.\n\n"
        f"--- RESTAURANT CONTEXT ---\n{menu_context}\n--- END CONTEXT ---\n"
        + caller_block
        + outbound_block
        + (f"\nADDITIONAL INSTRUCTIONS FROM THE OWNER:\n{persona_extra}\n" if persona_extra else "")
    )


# ===================================================================
# Tool schemas + handlers (called by OpenAI Realtime during the call)
# ===================================================================
TOOLS = [
    {
        "type": "function",
        "name": "place_order",
        "description": (
            "Place a takeaway or delivery order in the restaurant's POS system. Only call this "
            "when the customer has explicitly confirmed every item, size, and the total."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "type": {"type": "string", "enum": ["delivery", "collection"]},
                "customer_name": {"type": "string"},
                "customer_phone": {"type": "string"},
                "delivery_address": {"type": "string"},
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "qty": {"type": "integer"},
                            "size": {"type": "string"},
                            "notes": {"type": "string"},
                        },
                        "required": ["name", "qty"],
                    },
                },
                "notes": {"type": "string"},
            },
            "required": ["type", "customer_name", "items"],
        },
    },
    {
        "type": "function",
        "name": "book_reservation",
        "description": "Book a table reservation. Only call after explicit confirmation.",
        "parameters": {
            "type": "object",
            "properties": {
                "customer_name": {"type": "string"},
                "customer_phone": {"type": "string"},
                "party_size": {"type": "integer"},
                "at": {"type": "string", "description": "ISO 8601 datetime, e.g. 2026-03-04T19:30:00"},
                "notes": {"type": "string"},
            },
            "required": ["customer_name", "party_size", "at"],
        },
    },
    {
        "type": "function",
        "name": "end_call",
        "description": "Politely end the call after the customer has said goodbye.",
        "parameters": {"type": "object", "properties": {}},
    },
]


async def _lookup_caller(db, tenant_id: str, phone: str) -> Optional[dict]:
    """If the incoming/outgoing number matches an existing customer for this
    tenant, return a lightweight summary the system prompt can use to greet
    them by name and pre-load their last delivery address."""
    if not phone or not phone.strip():
        return None
    normalized = _normalize_number(phone)
    if not normalized:
        return None
    # Try exact match first, then last-10-digits (handles various number formats).
    tail = normalized[-10:]
    cust = await db.customers.find_one(
        {"tenant_id": tenant_id, "phone": {"$in": [normalized, tail, phone]}, "deleted": {"$ne": True}},
        {"_id": 0, "id": 1, "name": 1, "phone": 1, "address": 1},
    )
    if not cust and len(tail) >= 10:
        # Fallback: regex tail-match for numbers stored without country code.
        import re
        cust = await db.customers.find_one(
            {"tenant_id": tenant_id, "phone": {"$regex": f"{re.escape(tail)}$"}, "deleted": {"$ne": True}},
            {"_id": 0, "id": 1, "name": 1, "phone": 1, "address": 1},
        )
    if not cust:
        return None
    # Attach a lightweight order history hint (last order items only).
    orders = await (
        db.orders.find({"tenant_id": tenant_id, "customer.phone": {"$in": [normalized, tail, phone]}},
                       {"_id": 0, "items": 1, "placedAt": 1})
        .sort("placedAt", -1)
        .to_list(3)
    )
    summary = ""
    if orders:
        last = orders[0]
        items = last.get("items") or []
        if items:
            summary = ", ".join(f"{it.get('qty', 1)}x {it.get('name', '')}" for it in items[:3])
    return {
        "id": cust["id"],
        "name": cust.get("name") or "",
        "address": cust.get("address") or "",
        "order_count": len(orders),
        "last_order_summary": summary,
    }


async def _tool_place_order(db, tenant: dict, args: dict, ctx: dict) -> dict:
    """Resolve item names against the menu, build an Order doc, insert it,
    broadcast to KDS — mirrors the logic in routes.orders but minimal."""
    tenant_id = tenant["id"]
    menu = await db.menu_items.find(
        {"tenant_id": tenant_id}, {"_id": 0, "id": 1, "name": 1, "price": 1, "sizes": 1, "is_pizza": 1}
    ).to_list(2000)

    def _match(name: str) -> Optional[dict]:
        if not name:
            return None
        target = name.strip().lower()
        for m in menu:
            if m["name"].strip().lower() == target:
                return m
        # loose contains-match fallback
        for m in menu:
            if target in m["name"].strip().lower():
                return m
        return None

    items_out: list[dict] = []
    subtotal = 0.0
    unmatched: list[str] = []
    for it in (args.get("items") or []):
        m = _match(it.get("name", ""))
        qty = int(it.get("qty") or 1)
        size = it.get("size")
        if not m:
            unmatched.append(it.get("name", ""))
            continue
        if isinstance(m.get("sizes"), dict) and m["sizes"]:
            if size and size in m["sizes"]:
                price = float(m["sizes"][size])
            else:
                # default to first/cheapest size
                first_k = next(iter(m["sizes"]))
                size = size or first_k
                price = float(m["sizes"][first_k])
        else:
            price = float(m.get("price") or 0)
        items_out.append({"id": m["id"], "name": m["name"], "qty": qty, "size": size, "price": price})
        subtotal += price * qty

    if not items_out:
        return {"ok": False, "error": f"None of the requested items matched the menu: {unmatched}"}

    number = await next_order_number(db, tenant_id)
    placed_at = datetime.now(timezone.utc).isoformat()
    order_type = args.get("type") or "collection"
    from kds import annotate_order_items_for_kds
    order = {
        "id": f"o_{uuid.uuid4().hex[:10]}",
        "tenant_id": tenant_id,
        "number": number,
        "type": order_type,
        "status": "new",
        "customer": {
            "name": args.get("customer_name", "Phone caller"),
            "phone": (args.get("customer_phone") or ctx.get("from_number") or ""),
            "address": args.get("delivery_address") if order_type == "delivery" else None,
        },
        "table": None,
        "items": await annotate_order_items_for_kds(db, tenant_id, items_out),
        "deliveryFee": 0,
        "discount": 0,
        "total": round(subtotal, 2),
        "payment": "unpaid",
        "placedAt": placed_at,
        "driver": None,
        "source": "phone",
        "tip": 0,
        "coupon_code": None,
        "location_id": None,
        "customer_email": None,
        "refunded_amount": 0,
        "voided": False,
        "loyalty_earned": 0,
        "loyalty_redeemed": 0,
        "splits": None,
        "notes": args.get("notes"),
        "voice_call_id": ctx.get("call_id"),
    }
    await db.orders.insert_one(order)
    schedule_broadcast("kds.ticket", {"orderId": order["id"], "number": order["number"]}, tenant_id)
    logger.info("Voice order %s placed for tenant %s (₹%.2f, %d items)",
                order["number"], tenant_id, order["total"], len(items_out))

    # SMS confirmation — non-blocking, best-effort.
    customer_phone = order["customer"].get("phone") or ""
    if customer_phone:
        store_name = (tenant.get("store") or {}).get("name") or tenant.get("name", "మా రెస్టారెంట్")
        items_line = ", ".join(f"{it['qty']}x {it['name']}" for it in items_out[:6])
        sms_body = (
            f"{store_name}: order #{order['number']} confirmed. "
            f"{items_line}. Total ₹{order['total']:.0f}. "
            + ("Delivering to your address soon. " if order_type == "delivery" else "Ready for collection soon. ")
            + "Reply STOP to opt out."
        )
        try:
            from sms_service import send_sms
            asyncio.create_task(send_sms(customer_phone, sms_body))
        except Exception:
            logger.exception("Failed to schedule order SMS confirmation")

    return {
        "ok": True,
        "order_number": order["number"],
        "order_id": order["id"],
        "total": order["total"],
        "items": [{"name": it["name"], "qty": it["qty"], "size": it.get("size"), "price": it["price"]} for it in items_out],
        "unmatched": unmatched,
    }


async def _tool_book_reservation(db, tenant: dict, args: dict, ctx: dict) -> dict:
    res = {
        "id": f"r_{uuid.uuid4().hex[:10]}",
        "tenant_id": tenant["id"],
        "customer_name": args.get("customer_name", "Phone caller"),
        "phone": args.get("customer_phone") or ctx.get("from_number") or "",
        "party_size": int(args.get("party_size") or 2),
        "at": args.get("at"),
        "notes": args.get("notes"),
        "status": "booked",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "reminded_at": None,
        "reminder_sent": False,
        "source": "phone",
        "voice_call_id": ctx.get("call_id"),
    }
    await db.reservations.insert_one(res)
    logger.info("Voice reservation booked for tenant %s (%s @ %s)",
                tenant["id"], res["customer_name"], res["at"])
    return {"ok": True, "reservation_id": res["id"], "at": res["at"], "party_size": res["party_size"]}


# ===================================================================
# WebSocket bridge — Twilio Media Streams ↔ OpenAI Realtime
# ===================================================================
@router.websocket("/voice/twilio-stream")
async def twilio_stream(ws: WebSocket):
    """Twilio opens a bidirectional WS here; we relay μ-law audio to OpenAI
    Realtime and stream its response back. Tenant context is loaded from the
    custom parameters Twilio sends in the initial `start` event."""
    await ws.accept()
    db = get_db()

    openai_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not openai_key:
        logger.error("OPENAI_API_KEY missing — cannot bridge call")
        await ws.close(code=1011)
        return

    stream_sid: Optional[str] = None
    tenant: Optional[dict] = None
    call_ctx: dict = {}
    call_doc_id: Optional[str] = None
    openai_ws: Optional[websockets.WebSocketClientProtocol] = None
    transcript: list[dict] = []  # [{role, text, at}]
    started_at = datetime.now(timezone.utc)

    async def _persist_transcript_chunk(role: str, text: str):
        text = (text or "").strip()
        if not text:
            return
        entry = {"role": role, "text": text, "at": datetime.now(timezone.utc).isoformat()}
        transcript.append(entry)
        # Push live transcript delta so the dashboard's active-call panel can
        # render it in real time (tenant-scoped fan-out).
        if tenant is not None and call_doc_id:
            schedule_broadcast("voice.transcript_delta", {
                "id": call_doc_id, "role": role, "text": text, "at": entry["at"],
            }, tenant["id"])

    async def _finalise_call(intent: Optional[str] = None, extra: Optional[dict] = None):
        if not call_doc_id:
            return
        ended = datetime.now(timezone.utc)
        update = {
            "ended_at": ended.isoformat(),
            "duration_seconds": int((ended - started_at).total_seconds()),
            "transcript": transcript,
        }
        if intent:
            update["intent"] = intent
        if extra:
            update.update(extra)
        try:
            await db.voice_calls.update_one({"id": call_doc_id}, {"$set": update})
        except Exception:
            logger.exception("Failed to finalise voice_call %s", call_doc_id)
        # Notify dashboard so live panel can move the call from Active → Log.
        if tenant is not None:
            schedule_broadcast("voice.call.ended", {
                "id": call_doc_id,
                "duration_seconds": update["duration_seconds"],
                "intent": intent,
                **(extra or {}),
            }, tenant["id"])

    async def _pump_openai_to_twilio():
        """Read events from OpenAI Realtime and push audio frames back to Twilio."""
        nonlocal call_doc_id
        assert openai_ws is not None
        try:
            async for raw in openai_ws:
                evt = json.loads(raw)
                t = evt.get("type", "")
                # GA schema event names (post May 2025).
                if t in ("response.output_audio.delta", "response.audio.delta"):
                    if stream_sid:
                        await ws.send_text(json.dumps({
                            "event": "media",
                            "streamSid": stream_sid,
                            "media": {"payload": evt.get("delta", "")},
                        }))
                elif t in ("response.output_audio_transcript.done", "response.audio_transcript.done"):
                    await _persist_transcript_chunk("assistant", evt.get("transcript", ""))
                elif t == "conversation.item.input_audio_transcription.completed":
                    await _persist_transcript_chunk("user", evt.get("transcript", ""))
                elif t == "response.function_call_arguments.done":
                    name = evt.get("name", "")
                    call_id = evt.get("call_id", "")
                    try:
                        args = json.loads(evt.get("arguments") or "{}")
                    except Exception:
                        args = {}
                    logger.info("Realtime tool call: %s args=%s", name, args)
                    result: dict = {"ok": False, "error": "Unknown tool"}
                    if tenant is not None:
                        if name == "place_order":
                            result = await _tool_place_order(db, tenant, args, {**call_ctx, "call_id": call_doc_id})
                            if result.get("ok"):
                                await _finalise_call("order_placed", {"order_id": result.get("order_id")})
                        elif name == "book_reservation":
                            result = await _tool_book_reservation(db, tenant, args, {**call_ctx, "call_id": call_doc_id})
                            if result.get("ok"):
                                await _finalise_call("reservation_booked", {"reservation_id": result.get("reservation_id")})
                        elif name == "end_call":
                            result = {"ok": True}
                    # Feed result back to OpenAI so the model can wrap up.
                    await openai_ws.send(json.dumps({
                        "type": "conversation.item.create",
                        "item": {
                            "type": "function_call_output",
                            "call_id": call_id,
                            "output": json.dumps(result),
                        },
                    }))
                    await openai_ws.send(json.dumps({"type": "response.create"}))
                    if name == "end_call":
                        # Close after a short delay so the goodbye audio can play.
                        await asyncio.sleep(2.5)
                        try:
                            await ws.close()
                        except Exception:
                            pass
                        return
                elif t == "error":
                    logger.warning("OpenAI Realtime error: %s", evt)
        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception:
            logger.exception("openai->twilio pump failed")

    async def _pump_twilio_to_openai():
        """Read events from Twilio and forward audio frames to OpenAI Realtime."""
        nonlocal stream_sid, tenant, call_doc_id, call_ctx, openai_ws
        try:
            while True:
                raw = await ws.receive_text()
                evt = json.loads(raw)
                ev = evt.get("event", "")
                if ev == "start":
                    stream_sid = evt["start"].get("streamSid")
                    # Twilio sends the parent call's SID directly on start —
                    # use this as authoritative (outbound tokens don't have it
                    # because we mint them before calls.create returns).
                    parent_call_sid = evt["start"].get("callSid") or ""
                    cp = evt["start"].get("customParameters") or {}
                    params: dict[str, str] = {}
                    if isinstance(cp, dict):
                        params = {str(k): str(v) for k, v in cp.items()}
                    elif isinstance(cp, list):
                        for p in cp:
                            if isinstance(p, dict) and p.get("name"):
                                params[str(p["name"])] = str(p.get("value", ""))
                    # SECURITY: the ONLY trusted source of tenant_id is the
                    # signed stream token minted by our /voice/twilio-incoming
                    # or /voice/call endpoint. Anything else the client sends
                    # in customParameters is IGNORED.
                    claims = _verify_stream_token(params.get("token", ""))
                    if not claims:
                        logger.warning("Twilio stream WITHOUT valid stream token — rejecting (params keys=%s)",
                                       list(params.keys()))
                        await ws.close(code=4401)
                        return
                    tenant_id = claims.get("tid")
                    call_ctx = {
                        "call_sid": parent_call_sid or claims.get("sid") or "",
                        "from_number": claims.get("from"),
                        "to_number": claims.get("to"),
                        "direction": claims.get("dir") or "inbound",
                        "purpose": claims.get("purpose") or "",
                        "message": claims.get("message") or "",
                    }
                    if not tenant_id:
                        logger.warning("Stream token missing tenant_id — rejecting")
                        await ws.close(code=4401)
                        return
                    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
                    if not tenant:
                        logger.warning("Unknown tenant_id from Twilio: %s", tenant_id)
                        await ws.close()
                        return

                    is_outbound = call_ctx["direction"] == "outbound"
                    # Open the call log row immediately so it appears in the dashboard
                    # even if the call drops mid-conversation.
                    call_doc_id = f"vc_{uuid.uuid4().hex[:10]}"
                    await db.voice_calls.insert_one({
                        "id": call_doc_id,
                        "tenant_id": tenant_id,
                        "direction": call_ctx["direction"],
                        "from": call_ctx.get("from_number", ""),
                        "to": call_ctx.get("to_number", ""),
                        "call_sid": call_ctx.get("call_sid", ""),
                        "purpose": call_ctx.get("purpose"),
                        "started_at": started_at.isoformat(),
                        "ended_at": None,
                        "duration_seconds": 0,
                        "transcript": [],
                        "intent": None,
                        "order_id": None,
                        "reservation_id": None,
                        "recording_sid": None,
                        "recording_duration": 0,
                    })
                    schedule_broadcast("voice.call.started", {
                        "id": call_doc_id,
                        "direction": call_ctx["direction"],
                        "from": call_ctx.get("from_number", ""),
                        "to": call_ctx.get("to_number", ""),
                        "caller_name": None,
                        "started_at": started_at.isoformat(),
                    }, tenant_id)

                    # Start dual-channel recording for INBOUND calls (outbound
                    # already had record=True set in calls.create). Twilio will
                    # POST to /voice/recording-callback when it's finished.
                    if not is_outbound and call_ctx.get("call_sid"):
                        try:
                            tw_client = _twilio_client()
                            if tw_client:
                                base_url = os.environ.get("PUBLIC_BACKEND_URL", "").rstrip("/")
                                rec_cb = f"{base_url}/api/voice/recording-callback"
                                await asyncio.to_thread(
                                    tw_client.calls(call_ctx["call_sid"]).recordings.create,
                                    recording_channels="dual",
                                    recording_status_callback=rec_cb,
                                    recording_status_callback_event=["completed"],
                                    recording_status_callback_method="POST",
                                )
                        except Exception:
                            logger.exception("Failed to start inbound recording (non-fatal)")

                    # Look up known-caller from customers collection so we can
                    # greet them by name and skip re-asking for their address.
                    caller_phone = ""
                    if call_ctx["direction"] == "outbound":
                        caller_phone = call_ctx.get("to_number") or ""
                    else:
                        caller_phone = call_ctx.get("from_number") or ""
                    customer_ctx = await _lookup_caller(db, tenant_id, caller_phone)
                    if customer_ctx:
                        logger.info("Voice call recognised customer %s (%s) for tenant %s",
                                    customer_ctx.get("name"), caller_phone, tenant_id)

                    # Connect to OpenAI Realtime and configure the session.
                    menu_ctx = await _build_tenant_context(db, tenant)
                    instructions = _system_instructions(
                        tenant, menu_ctx,
                        outbound_ctx=call_ctx if is_outbound else None,
                        customer=customer_ctx,
                    )
                    cfg = tenant.get("voice") or {}
                    voice_name = cfg.get("voice") or DEFAULT_VOICE
                    openai_ws = await websockets.connect(
                        OPENAI_REALTIME_URL,
                        additional_headers={"Authorization": f"Bearer {openai_key}"},
                        max_size=8 * 1024 * 1024,
                    )
                    # GA Realtime schema (May 2025+). Audio uses `audio/pcmu`
                    # for Twilio's G.711 μ-law. Tools/instructions live on the
                    # session; `type:"realtime"` selects speech-to-speech.
                    await openai_ws.send(json.dumps({
                        "type": "session.update",
                        "session": {
                            "type": "realtime",
                            "model": os.environ.get("OPENAI_REALTIME_MODEL", "gpt-realtime"),
                            "output_modalities": ["audio"],
                            "instructions": instructions,
                            "audio": {
                                "input": {
                                    "format": {"type": "audio/pcmu"},
                                    # OpenAI's built-in noise reduction —
                                    # "near_field" is tuned for phones held
                                    # to the ear (typical for our Indian
                                    # restaurant customers). Kills background
                                    # kitchen/traffic/TV noise before it
                                    # reaches VAD or the transcription model.
                                    "noise_reduction": {"type": "near_field"},
                                    "transcription": {"model": "whisper-1"},
                                    "turn_detection": {
                                        # Aggressive tuning to ignore TV /
                                        # background chatter that Twilio and
                                        # noise-reduction still let through.
                                        #  - threshold 0.85: only clearly-
                                        #    voiced speech triggers a turn.
                                        #  - prefix_padding 500ms: require a
                                        #    sustained utterance (not a beep).
                                        #  - silence_duration 1500ms: wait a
                                        #    full 1.5s of quiet before we
                                        #    decide the caller is done —
                                        #    prevents the AI from interrupting
                                        #    a pause and lets short TV bursts
                                        #    fade before we react.
                                        "type": "server_vad",
                                        "threshold": 0.85,
                                        "prefix_padding_ms": 500,
                                        "silence_duration_ms": 1500,
                                        # If a chunk exceeds this without a
                                        # silence break, cut the response so
                                        # continuous TV audio doesn't feed the
                                        # model an unbounded turn.
                                        "create_response": True,
                                        "interrupt_response": True,
                                    },
                                },
                                "output": {
                                    "format": {"type": "audio/pcmu"},
                                    "voice": voice_name,
                                },
                            },
                            "tools": TOOLS,
                            "tool_choice": "auto",
                        },
                    }))
                    # Trigger initial greeting from the assistant.
                    await openai_ws.send(json.dumps({"type": "response.create"}))
                    register_bridge(call_doc_id, tenant_id, openai_ws)
                    asyncio.create_task(_pump_openai_to_twilio())
                elif ev == "media":
                    if openai_ws is None:
                        continue
                    payload = evt.get("media", {}).get("payload", "")
                    if payload:
                        await openai_ws.send(json.dumps({
                            "type": "input_audio_buffer.append",
                            "audio": payload,
                        }))
                elif ev == "stop":
                    break
                elif ev == "mark":
                    pass  # ignored
        except WebSocketDisconnect:
            pass
        except Exception:
            logger.exception("twilio->openai pump failed")

    try:
        await _pump_twilio_to_openai()
    finally:
        try:
            if openai_ws is not None:
                await openai_ws.close()
        except Exception:
            pass
        if call_doc_id:
            unregister_bridge(call_doc_id)
        await _finalise_call()
