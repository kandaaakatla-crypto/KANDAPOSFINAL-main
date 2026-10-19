"""Twilio SMS — used by the reservation-reminder background task.

We intentionally keep this thin: a single `send_sms()` function that fails
gracefully (logs + returns False) so a Twilio outage never blocks a request.
The reminder loop calls this on a fixed cadence inside the FastAPI process.
"""
import os
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from tz import now_ist

from twilio.rest import Client

logger = logging.getLogger("kanda.sms")

_client: Client | None = None


DEFAULT_COUNTRY_CODE = os.environ.get("SMS_DEFAULT_COUNTRY_CODE", "+91").strip()


def normalize_phone(raw: str) -> str:
    """Best-effort E.164 normaliser for phone numbers our users type in.

    Common shapes we see (India-centric, since that's the target market):
        "9876543210"       → "+919876543210"   (bare 10-digit mobile)
        "09876543210"      → "+919876543210"   (0-prefixed as dialled locally)
        "919876543210"     → "+919876543210"   (country code without +)
        "0091 98765 43210" → "+919876543210"   (00-prefixed international)
        "+91 98765 43210"  → "+919876543210"   (already E.164, spaces stripped)
        "+1 908-649-8077"  → "+19086498077"    (US)

    Anything we can't confidently normalise is returned as best-effort with a
    leading '+', letting Twilio surface a validation error rather than us
    silently dropping the send.
    """
    if not raw:
        return ""
    # Strip everything except digits and the leading '+' marker.
    s = "".join(ch for ch in raw.strip() if ch.isdigit() or ch == "+")
    if not s:
        return ""

    if s.startswith("+"):
        # Already E.164-ish — keep as is.
        return s

    # "00CC..." → "+CC..."
    if s.startswith("00") and len(s) > 3:
        return "+" + s[2:]

    # Bare 10-digit → assume it's a local mobile number in the default country.
    if len(s) == 10:
        return DEFAULT_COUNTRY_CODE + s

    # "0" + 10-digit local trunk prefix (common in India/UK) → strip 0, add CC.
    if s.startswith("0") and len(s) == 11:
        return DEFAULT_COUNTRY_CODE + s[1:]

    # 11-12 digit starting with a plausible CC without a "+" (91XXXXXXXXXX for
    # India, 44XXXXXXXXXX for UK, etc.) — just add the "+".
    if len(s) in (11, 12, 13):
        return "+" + s

    # Last resort — prepend "+" and let Twilio validate.
    return "+" + s.lstrip("0")


def sms_enabled() -> bool:
    """SMS is off unless SMS_ENABLED=1 (off for launch: bills and reviews go
    by WhatsApp instead). Every send below is a no-op while it's off."""
    return os.environ.get("SMS_ENABLED", "").strip() == "1"


def _get_client() -> Client | None:
    global _client
    sid = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
    tok = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
    if not sid or not tok:
        return None
    if _client is None:
        _client = Client(sid, tok)
    return _client


def sms_configured() -> tuple[bool, str]:
    """(usable, reason-if-not) so the UI can show a "Not set up" state
    instead of letting managers send messages that are guaranteed to fail."""
    if not sms_enabled():
        return False, "SMS is turned off"
    if _get_client() is None:
        return False, "SMS isn't set up yet: the Twilio account hasn't been connected on the server."
    if not os.environ.get("TWILIO_FROM_NUMBER", "").strip():
        return False, "SMS isn't set up yet: no Twilio sender number is configured."
    return True, ""


async def send_sms(to: str, body: str) -> bool:
    """Send a single SMS. Returns True on success, False otherwise."""
    if not sms_enabled():
        return False
    to = normalize_phone(to)
    if not to:
        return False
    client = _get_client()
    if client is None:
        logger.warning("Twilio not configured — skipping SMS to %s", to)
        return False
    from_number = os.environ.get("TWILIO_FROM_NUMBER", "").strip()
    if not from_number:
        return False
    try:
        msg = await asyncio.to_thread(
            client.messages.create, to=to, from_=from_number, body=body,
        )
        logger.info("Sent SMS %s to %s", msg.sid, to)
        return True
    except Exception as exc:  # noqa: BLE001
        # Twilio wraps errors with .code + .msg — log both so operators know
        # WHY (invalid number, unverified recipient, geo restriction, etc.).
        code = getattr(exc, "code", None)
        msg = getattr(exc, "msg", None) or str(exc)
        logger.warning("Twilio SMS to %s failed (code=%s): %s", to, code, msg)
        return False


async def send_sms_detailed(to: str, body: str) -> dict:
    """Same as send_sms but returns {ok, to, error} so callers can surface
    the specific Twilio failure to the user."""
    if not sms_enabled():
        return {"ok": False, "to": to, "error": "SMS is turned off"}
    to = normalize_phone(to)
    if not to:
        return {"ok": False, "to": to, "error": "Empty or invalid phone number"}
    client = _get_client()
    if client is None:
        return {"ok": False, "to": to, "error": "Twilio not configured on server"}
    from_number = os.environ.get("TWILIO_FROM_NUMBER", "").strip()
    if not from_number:
        return {"ok": False, "to": to, "error": "No sender number configured"}
    try:
        msg = await asyncio.to_thread(
            client.messages.create, to=to, from_=from_number, body=body,
        )
        logger.info("Sent SMS %s to %s", msg.sid, to)
        return {"ok": True, "to": to, "error": None, "sid": msg.sid}
    except Exception as exc:  # noqa: BLE001
        code = getattr(exc, "code", None)
        detail = getattr(exc, "msg", None) or str(exc)
        # Common code cheatsheet for the UI:
        #   21211 → invalid To number
        #   21610 → recipient has opted out (STOP)
        #   21408 → geo permission not enabled
        #   21606 → From number not SMS-capable
        friendly = detail
        if code == 21211:
            friendly = f"Invalid phone number: {to}. Include the country code (e.g. +91...)."
        elif code == 21610:
            friendly = "This recipient has opted out of SMS (STOP). Cannot send."
        elif code == 21408:
            friendly = f"Your Twilio account isn't enabled for SMS to that country ({to[:3]}). Enable geo permissions in the Twilio console."
        elif code == 21606:
            friendly = "Your Twilio 'from' number is not SMS-capable — buy an SMS-enabled number."
        logger.warning("Twilio SMS to %s failed (code=%s): %s", to, code, detail)
        return {"ok": False, "to": to, "error": friendly, "twilio_code": code}


async def reservation_reminder_loop(get_db_fn, interval_sec: int = 300):
    """Background task — every 5 min, find reservations starting in 55-65 min
    that haven't been reminded yet, send SMS, mark reminded.

    Started from server.py on app startup."""
    logger.info("Reservation reminder loop started (interval=%ss)", interval_sec)
    while True:
        try:
            db = get_db_fn()
            now = now_ist()
            window_start = (now + timedelta(minutes=55)).isoformat()
            window_end = (now + timedelta(minutes=65)).isoformat()
            cursor = db.reservations.find(
                {
                    "status": "booked",
                    "phone": {"$ne": None},
                    "reminded_at": {"$in": [None]},
                    "at": {"$gte": window_start, "$lte": window_end},
                },
                {"_id": 0},
            )
            async for r in cursor:
                if not r.get("phone"):
                    continue
                tenant = await db.tenants.find_one({"id": r["tenant_id"]}, {"_id": 0, "name": 1})
                tname = (tenant or {}).get("name", "Kanda POS")
                body = (
                    f"Hi {r['customer_name'].split(' ')[0]}, this is a reminder of your "
                    f"reservation at {tname} in 1 hour ({r['party_size']} guests). "
                    f"See you soon!"
                )
                ok = await send_sms(r["phone"], body)
                await db.reservations.update_one(
                    {"id": r["id"]},
                    {"$set": {
                        "reminded_at": now_ist().isoformat(),
                        "reminder_sent": ok,
                    }},
                )
        except Exception:
            logger.exception("reservation_reminder_loop tick failed")
        await asyncio.sleep(interval_sec)
