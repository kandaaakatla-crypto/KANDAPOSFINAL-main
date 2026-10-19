"""Ops & Support module for Kanda POS — P3c.

Three things live here:
  1. Error log middleware: captures every unhandled exception with context.
  2. Audit log middleware: records every mutating (POST/PUT/PATCH/DELETE) API hit.
  3. Support ticket routes:
       - POS staff post a ticket (POST /api/support/tickets)
       - Platform Owner browses + replies (GET/PATCH /api/owner/ops/...)
"""
import os
import json
import logging
import traceback
import uuid
from datetime import datetime, timezone
from tz import now_ist
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from auth import get_current_user, decode_token as decode_staff_token
from db import get_db
from owners import decode_token as decode_owner_token, ISSUER as OWNER_ISSUER, get_current_owner
from tenants import tenant_filter, get_tenant
from email_service import send_email, support_ticket_email

logger = logging.getLogger("kanda.ops")

support_router = APIRouter(prefix="/support")
ops_router = APIRouter(prefix="/ops")  # mounted under owner_router


# -------------------- Models --------------------
class TicketCreate(BaseModel):
    subject: str = Field(..., min_length=3, max_length=140)
    body: str = Field(..., min_length=3, max_length=4000)
    severity: str = Field("normal", pattern="^(low|normal|high)$")


class TicketReply(BaseModel):
    body: str = Field(..., min_length=1, max_length=4000)


class TicketStatusUpdate(BaseModel):
    status: str = Field(..., pattern="^(open|in_progress|resolved|closed)$")


# -------------------- POS-facing support routes --------------------
@support_router.post("/tickets")
async def create_ticket(payload: TicketCreate, request: Request, user: dict = Depends(get_current_user)):
    db = get_db()
    tenant = await get_tenant(user, db)
    now = now_ist().isoformat()
    ticket = {
        "id": f"tk_{uuid.uuid4().hex[:10]}",
        "tenant_id": user["tenant_id"],
        "tenant_slug": tenant.get("slug"),
        "tenant_name": tenant.get("name"),
        "subject": payload.subject.strip(),
        "body": payload.body.strip(),
        "severity": payload.severity,
        "status": "open",
        "opened_by": user["id"],
        "opened_by_name": user.get("name", "—"),
        "opened_by_role": user.get("role", "—"),
        "at": now,
        "replies": [],
    }
    await db.support_tickets.insert_one(ticket)
    # Fire-and-forget email — never block the user's ticket on email delivery.
    to = os.environ.get("SUPPORT_TO_EMAIL", "").strip()
    if to:
        subject, html = support_ticket_email(ticket, tenant)
        await send_email(to, subject, html)
    ticket.pop("_id", None)
    return ticket


@support_router.get("/tickets")
async def list_my_tickets(user: dict = Depends(get_current_user)):
    """Tenant-side: list this tenant's own tickets so staff can see status/replies."""
    db = get_db()
    docs = await db.support_tickets.find(tenant_filter(user), {"_id": 0}).sort("at", -1).to_list(200)
    return docs


# -------------------- Owner-facing ops routes (mounted under /api/owner/ops) --------------------
@ops_router.get("/errors")
async def list_errors(owner: dict = Depends(get_current_owner), limit: int = 200, tenant_id: Optional[str] = None):
    db = get_db()
    q: dict = {}
    if tenant_id:
        q["tenant_id"] = tenant_id
    docs = await db.error_logs.find(q, {"_id": 0}).sort("at", -1).limit(min(limit, 500)).to_list(500)
    return docs


@ops_router.get("/audit")
async def list_audit(owner: dict = Depends(get_current_owner), limit: int = 200, tenant_id: Optional[str] = None):
    db = get_db()
    q: dict = {}
    if tenant_id:
        q["tenant_id"] = tenant_id
    docs = await db.audit_logs.find(q, {"_id": 0}).sort("at", -1).limit(min(limit, 500)).to_list(500)
    return docs


@ops_router.get("/leads")
async def list_leads(owner: dict = Depends(get_current_owner), type: Optional[str] = None, limit: int = 200):
    """Landing-page "Book a demo" / "Sign up for updates" submissions —
    see routes/leads.py for where these are written."""
    db = get_db()
    q: dict = {}
    if type:
        q["type"] = type
    docs = await db.landing_leads.find(q, {"_id": 0}).sort("at", -1).limit(min(limit, 500)).to_list(500)
    return docs


@ops_router.get("/support")
async def list_all_tickets(owner: dict = Depends(get_current_owner), status: Optional[str] = None, tenant_id: Optional[str] = None):
    db = get_db()
    q: dict = {}
    if status:
        q["status"] = status
    if tenant_id:
        q["tenant_id"] = tenant_id
    docs = await db.support_tickets.find(q, {"_id": 0}).sort("at", -1).to_list(500)
    return docs


@ops_router.post("/support/{ticket_id}/reply")
async def reply_to_ticket(ticket_id: str, payload: TicketReply, owner: dict = Depends(get_current_owner)):
    db = get_db()
    now = now_ist().isoformat()
    reply = {
        "id": f"r_{uuid.uuid4().hex[:8]}",
        "by": owner["id"],
        "by_name": owner.get("name", "Platform Owner"),
        "body": payload.body.strip(),
        "at": now,
    }
    res = await db.support_tickets.find_one_and_update(
        {"id": ticket_id},
        {"$push": {"replies": reply}, "$set": {"status": "in_progress", "updated_at": now}},
        return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Ticket not found")
    res.pop("_id", None)
    return res


@ops_router.patch("/support/{ticket_id}/status")
async def update_ticket_status(ticket_id: str, payload: TicketStatusUpdate, owner: dict = Depends(get_current_owner)):
    db = get_db()
    res = await db.support_tickets.find_one_and_update(
        {"id": ticket_id},
        {"$set": {"status": payload.status, "updated_at": now_ist().isoformat()}},
        return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Ticket not found")
    res.pop("_id", None)
    return res


# -------------------- Middleware: audit + error capture --------------------
_AUDIT_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# Skip these paths from audit (high-volume, low-signal, or auth-shaped):
_AUDIT_SKIP_PREFIXES = (
    "/api/owner/ops/",          # internal owner ops calls
    "/api/payments/razorpay/webhook",
)


def _identify_actor(request: Request) -> dict:
    """Extract a best-effort actor description from the request's Authorization header,
    without raising. Supports both staff (tenant) JWTs and PlatformOwner JWTs."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return {"actor_type": "anon", "actor_id": None, "actor_role": None, "tenant_id": None, "imp_owner": None, "auditor": False}
    token = auth[7:]
    try:
        payload = decode_owner_token(token)  # works for both — same JWT secret + alg
    except Exception:
        return {"actor_type": "anon", "actor_id": None, "actor_role": None, "tenant_id": None, "imp_owner": None, "auditor": False}

    if payload.get("iss") == OWNER_ISSUER and payload.get("imp"):
        return {
            "actor_type": "impersonator",
            "actor_id": payload.get("sub"),
            "actor_role": payload.get("role"),
            "tenant_id": payload.get("tenant_id"),
            "imp_owner": payload.get("imp_owner"),
            "auditor": bool(payload.get("auditor")),
        }
    if payload.get("iss") == OWNER_ISSUER:
        return {
            "actor_type": "owner",
            "actor_id": payload.get("sub"),
            "actor_role": payload.get("role"),
            "tenant_id": None,
            "imp_owner": None,
            "auditor": False,
        }
    return {
        "actor_type": "staff",
        "actor_id": payload.get("sub"),
        "actor_role": payload.get("role"),
        "tenant_id": payload.get("tenant_id"),
        "imp_owner": None,
        "auditor": False,
    }


def install_ops_middleware(app):
    """Attach the error-capture + audit-log middleware to the FastAPI app.
    Must be called BEFORE the auditor_readonly_guard middleware in server.py
    so that audit/error capture wraps the read-only guard."""

    @app.middleware("http")
    async def audit_and_error_middleware(request: Request, call_next):
        path = request.url.path
        method = request.method
        actor = _identify_actor(request)
        now_iso = now_ist().isoformat()

        try:
            response = await call_next(request)
        except Exception as exc:  # noqa: BLE001 — last-resort capture
            tb = traceback.format_exc()
            try:
                db = get_db()
                await db.error_logs.insert_one({
                    "id": f"err_{uuid.uuid4().hex[:10]}",
                    "tenant_id": actor.get("tenant_id"),
                    "actor_id": actor.get("actor_id"),
                    "actor_type": actor.get("actor_type"),
                    "route": path,
                    "method": method,
                    "status": 500,
                    "message": str(exc),
                    "traceback": tb[-4000:],
                    "at": now_iso,
                })
            except Exception:
                logger.exception("Failed to persist error_log")
            logger.exception("Unhandled %s %s: %s", method, path, exc)
            return JSONResponse(status_code=500, content={"detail": "Internal server error"})

        # Audit logging — only for mutating /api calls, only when the request was authenticated.
        if (
            method in _AUDIT_METHODS
            and path.startswith("/api/")
            and not any(path.startswith(p) for p in _AUDIT_SKIP_PREFIXES)
            and actor.get("actor_id")
        ):
            try:
                db = get_db()
                await db.audit_logs.insert_one({
                    "id": f"au_{uuid.uuid4().hex[:10]}",
                    "tenant_id": actor.get("tenant_id"),
                    "actor_id": actor.get("actor_id"),
                    "actor_type": actor.get("actor_type"),
                    "actor_role": actor.get("actor_role"),
                    "imp_owner": actor.get("imp_owner"),
                    "auditor_session": actor.get("auditor", False),
                    "route": path,
                    "method": method,
                    "status": response.status_code,
                    "at": now_iso,
                })
            except Exception:
                logger.exception("Failed to persist audit_log")

        # Persist 4xx/5xx responses to error_logs too (without traceback).
        # 5xx is recorded whoever the caller is, like the raised-exception
        # branch above; 4xx only for authenticated callers, and 401 never.
        if response.status_code == 401:
            # 401 noise — skip
            pass
        elif path.startswith("/api/") and (
            response.status_code >= 500
            or (response.status_code >= 400 and actor.get("actor_id"))
        ):
            try:
                db = get_db()
                await db.error_logs.insert_one({
                    "id": f"err_{uuid.uuid4().hex[:10]}",
                    "tenant_id": actor.get("tenant_id"),
                    "actor_id": actor.get("actor_id"),
                    "actor_type": actor.get("actor_type"),
                    "route": path,
                    "method": method,
                    "status": response.status_code,
                    "message": f"HTTP {response.status_code}",
                    "traceback": None,
                    "at": now_iso,
                })
            except Exception:
                pass

        return response
