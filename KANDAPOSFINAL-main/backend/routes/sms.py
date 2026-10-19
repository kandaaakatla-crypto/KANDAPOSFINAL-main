"""Outbound SMS — manual send to customers, plus a broadcast composer.

Backed by the existing `sms_service.send_sms()` which uses Twilio. Every send
is logged in `sms_log` so managers can audit outbound messages later.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from tz import now_ist
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from db import get_db
from auth import get_current_user, require_role
from tenants import tenant_filter
from sms_service import send_sms_detailed, normalize_phone, sms_configured

logger = logging.getLogger("kanda.sms_routes")
router = APIRouter()


# ===================================================================
# Models
# ===================================================================
class SendSmsPayload(BaseModel):
    to: str
    body: str = Field(min_length=1, max_length=1000)
    customer_id: Optional[str] = None  # optional link back to a customer row


class BroadcastPayload(BaseModel):
    body: str = Field(min_length=1, max_length=1000)
    customer_ids: Optional[List[str]] = None
    phones: Optional[List[str]] = None  # raw numbers if not tied to customers


# ===================================================================
# Helpers
# ===================================================================
def _normalize(n: str) -> str:
    return normalize_phone(n)


async def _log_and_send(db, *, tenant_id: str, sent_by: str, to: str, body: str,
                        customer_id: Optional[str] = None) -> dict:
    to = _normalize(to)
    entry_id = f"sms_{uuid.uuid4().hex[:10]}"
    entry = {
        "id": entry_id,
        "tenant_id": tenant_id,
        "customer_id": customer_id,
        "to": to,
        "body": body,
        "sent_by": sent_by,
        "sent_at": now_ist().isoformat(),
        "status": "queued",
        "error": None,
    }
    await db.sms_log.insert_one(entry)
    res = await send_sms_detailed(to, body)
    await db.sms_log.update_one({"id": entry_id},
                                {"$set": {
                                    "status": "sent" if res["ok"] else "failed",
                                    "error": res.get("error"),
                                    "twilio_sid": res.get("sid"),
                                    "twilio_code": res.get("twilio_code"),
                                }})
    return {"id": entry_id, "to": to, "ok": res["ok"], "error": res.get("error")}


# ===================================================================
# Endpoints
# ===================================================================
@router.get("/sms/status")
async def status(user: dict = Depends(get_current_user)):
    ok, reason = sms_configured()
    return {"configured": ok, "reason": reason}


@router.post("/sms/send")
async def send_one(payload: SendSmsPayload, user: dict = Depends(require_role("Manager"))):
    if not payload.to.strip():
        raise HTTPException(status_code=400, detail="Recipient phone required")
    db = get_db()
    res = await _log_and_send(
        db, tenant_id=user["tenant_id"], sent_by=user.get("name") or user["id"],
        to=payload.to, body=payload.body, customer_id=payload.customer_id,
    )
    return res


@router.post("/sms/broadcast")
async def broadcast(payload: BroadcastPayload, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    targets: list[dict] = []

    if payload.customer_ids:
        rows = await db.customers.find(
            tenant_filter(user, {"id": {"$in": payload.customer_ids}, "deleted": {"$ne": True}}),
            {"_id": 0, "id": 1, "phone": 1, "name": 1},
        ).to_list(500)
        for c in rows:
            if c.get("phone"):
                targets.append({"customer_id": c["id"], "phone": c["phone"], "name": c.get("name", "")})

    for p in (payload.phones or []):
        if p and p.strip():
            targets.append({"customer_id": None, "phone": p.strip(), "name": ""})

    if not targets:
        raise HTTPException(status_code=400, detail="No valid recipients")
    if len(targets) > 200:
        raise HTTPException(status_code=400, detail="Broadcast capped at 200 recipients per send")

    results = []
    sent = 0
    for t in targets:
        # Template variables: {name} → customer first name (falls back to empty).
        first = (t["name"] or "").split(" ")[0]
        personalised = payload.body.replace("{name}", first)
        r = await _log_and_send(
            db, tenant_id=user["tenant_id"], sent_by=user.get("name") or user["id"],
            to=t["phone"], body=personalised, customer_id=t["customer_id"],
        )
        results.append(r)
        if r["ok"]:
            sent += 1
    return {"count": len(results), "sent": sent, "failed": len(results) - sent, "results": results}


@router.get("/sms/history")
async def history(user: dict = Depends(get_current_user), limit: int = Query(100, le=500)):
    db = get_db()
    docs = await (
        db.sms_log.find(tenant_filter(user), {"_id": 0})
        .sort("sent_at", -1)
        .to_list(limit)
    )
    return docs
