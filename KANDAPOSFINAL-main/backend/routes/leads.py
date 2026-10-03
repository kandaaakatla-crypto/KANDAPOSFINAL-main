"""Public, unauthenticated landing-page lead capture — no staff PIN, no
tenant, no login at all. Reached by the "Book a demo" and "Sign up for
updates" forms on kandapos.com's marketing homepage.

Before this existed, both forms only updated local React state and showed a
success toast — nothing was ever sent anywhere, so every real submission was
silently discarded. This persists every submission to Mongo (so a lead is
never lost even if email delivery is broken or unconfigured) and best-effort
emails a notification to SUPPORT_TO_EMAIL, mirroring the support-ticket
pattern in ops.py.
"""
import os
import secrets
import uuid
from typing import Optional, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from db import get_db
from tz import now_ist
from ratelimit import peek as rate_limit_peek, hit as rate_limit_hit
from email_service import send_email

router = APIRouter(prefix="/leads")

# Generous but bot-proof — a real visitor never submits more than a couple
# of these; a script hammering the endpoint gets cut off fast.
MAX_SUBMISSIONS = 8
WINDOW_SECONDS = 3600

# Alpha waitlist ("updates" leads): each business that joins through
# someone's referral link moves the referrer this many places up the list.
REFERRAL_BOOST = 5
# No 0/O/1/I — referral codes get read out loud and typed from WhatsApp.
_REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _client_ip(request: Request) -> str:
    # Cloud Run puts the real client IP first in X-Forwarded-For, with its
    # own infra's hops appended after — same helper as routes/auth.py.
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class LeadCreate(BaseModel):
    type: Literal["demo", "updates"]
    email: EmailStr
    name: Optional[str] = Field(None, max_length=200)
    phone: Optional[str] = Field(None, max_length=40)
    business: Optional[str] = Field(None, max_length=200)
    city: Optional[str] = Field(None, max_length=100)
    message: Optional[str] = Field(None, max_length=2000)
    # Alpha waitlist extras — only meaningful for type "updates".
    business_type: Optional[Literal["restaurant", "cafe", "cloud_kitchen", "retail", "other"]] = None
    outlets: Optional[Literal["1", "2-5", "6-20", "20+"]] = None
    ref: Optional[str] = Field(None, max_length=16)


BUSINESS_TYPE_LABEL = {
    "restaurant": "Restaurant", "cafe": "Café / bakery", "cloud_kitchen": "Cloud kitchen",
    "retail": "Retail store", "other": "Other",
}


def _new_ref_code() -> str:
    return "".join(secrets.choice(_REF_ALPHABET) for _ in range(6))


async def _waitlist_status(db, lead: dict) -> dict:
    """Where a waitlist lead stands: their place in sign-up order, moved up
    REFERRAL_BOOST places per business that joined through their link."""
    ahead = await db.landing_leads.count_documents({"type": "updates", "at": {"$lt": lead["at"]}})
    referrals = 0
    if lead.get("ref_code"):
        referrals = await db.landing_leads.count_documents({"type": "updates", "referred_by": lead["ref_code"]})
    return {
        "position": max(1, ahead + 1 - REFERRAL_BOOST * referrals),
        "ref_code": lead.get("ref_code"),
        "referrals": referrals,
    }


def _lead_email(lead: dict) -> tuple[str, str]:
    kind = "Demo request" if lead["type"] == "demo" else "Alpha waitlist sign-up"
    subject = f"[Kanda POS website] {kind} — {lead.get('name') or lead['email']}"
    rows = [
        ("Type", kind),
        ("Name", lead.get("name") or "—"),
        ("Email", lead["email"]),
        ("Phone", lead.get("phone") or "—"),
        ("Business", lead.get("business") or "—"),
        ("City", lead.get("city") or "—"),
    ]
    if lead["type"] == "updates":
        rows += [
            ("Business type", BUSINESS_TYPE_LABEL.get(lead.get("business_type"), "—")),
            ("Outlets", lead.get("outlets") or "—"),
            ("Referred by", lead.get("referred_by") or "—"),
        ]
    meta_html = "".join(
        f'<tr><td style="padding:4px 12px 4px 0;color:#888;font-size:12px">{k}</td>'
        f'<td style="padding:4px 0;color:#111;font-size:13px"><b>{v}</b></td></tr>'
        for k, v in rows
    )
    msg_html = ""
    if lead.get("message"):
        msg_html = (
            '<div style="background:#f5f5f7;border-radius:8px;padding:12px;'
            'color:#111;font-size:14px;line-height:1.5;white-space:pre-wrap;margin-top:12px">'
            f'{lead["message"]}</div>'
        )
    return subject, (
        '<div style="font-family:Inter,Arial,sans-serif;background:#fafafa;padding:24px">'
        '<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:12px;padding:24px">'
        f'<h2 style="margin:0 0 4px;color:#111">{kind}</h2>'
        '<div style="color:#666;font-size:13px;margin-bottom:16px">From kandapos.com</div>'
        f'<table style="border-collapse:collapse;width:100%">{meta_html}</table>'
        f'{msg_html}'
        '</div></div>'
    )


@router.post("")
async def create_lead(payload: LeadCreate, request: Request):
    db = get_db()

    rl_key = f"leadrl:{_client_ip(request)}"
    if await rate_limit_peek(rl_key) >= MAX_SUBMISSIONS:
        raise HTTPException(status_code=429, detail="Too many submissions. Please try again later.")
    await rate_limit_hit(rl_key, WINDOW_SECONDS)

    email = payload.email.strip()
    email_lc = email.lower()

    # Waitlist sign-ups are one per email: a repeat (or someone checking
    # their place) gets their existing spot back instead of a duplicate row
    # and a second notification email.
    if payload.type == "updates":
        existing = await db.landing_leads.find_one({"type": "updates", "email_lc": email_lc}, {"_id": 0})
        if existing:
            return {"ok": True, "already": True, **(await _waitlist_status(db, existing))}

    lead = {
        "id": f"lead_{uuid.uuid4().hex[:10]}",
        "type": payload.type,
        "name": (payload.name or "").strip() or None,
        "email": email,
        "email_lc": email_lc,
        "phone": (payload.phone or "").strip() or None,
        "business": (payload.business or "").strip() or None,
        "city": (payload.city or "").strip() or None,
        "message": (payload.message or "").strip() or None,
        "at": now_ist().isoformat(),
        "source": "landing_page",
    }
    if payload.type == "updates":
        lead["business_type"] = payload.business_type
        lead["outlets"] = payload.outlets
        lead["ref_code"] = _new_ref_code()
        ref = (payload.ref or "").strip().upper()
        if ref and await db.landing_leads.find_one({"type": "updates", "ref_code": ref}, {"_id": 1}):
            lead["referred_by"] = ref
    await db.landing_leads.insert_one(lead)
    lead.pop("_id", None)

    # Fire-and-forget notification email — never block the visitor's
    # submission on email delivery, and the lead is already durably saved
    # above even if this fails or RESEND_API_KEY isn't configured.
    to = os.environ.get("SUPPORT_TO_EMAIL", "").strip()
    if to:
        subject, html = _lead_email(lead)
        await send_email(to, subject, html)

    if payload.type == "updates":
        return {"ok": True, "already": False, **(await _waitlist_status(db, lead))}
    return {"ok": True}
