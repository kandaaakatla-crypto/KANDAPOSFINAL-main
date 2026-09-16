"""Daily digest — Phase 2 of "AI Everywhere".

An AI-written natural-language summary of the tenant's day, delivered to
owners/managers via SMS and/or Email on a configurable schedule. Live-data
helpers live in report_tools.py, shared with (nothing else currently, but
kept separate so future surfaces can reuse them without pulling in this
file's SMS/email scheduling logic).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone, timedelta
from tz import now_ist
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from db import get_db
from routes.dash_auth import get_dash_user
from email_service import send_email
from sms_service import send_sms
from report_tools import (
    _tool_todays_sales,
    _tool_top_items,
    _tool_low_stock,
    _tool_expiring_stock,
    _tool_active_orders,
    _tool_staff_on_duty,
)

logger = logging.getLogger("kanda.digest")
router = APIRouter()


# ===================================================================
# Models
# ===================================================================
class DigestConfig(BaseModel):
    enabled: bool = False
    send_hour_ist: int = Field(default=7, ge=0, le=23)  # 07:00 IST
    send_minute: int = Field(default=0, ge=0, le=59)
    channels_sms: bool = False
    channels_email: bool = True
    sms_recipients: List[str] = []
    email_recipients: List[str] = []


class DigestPayload(BaseModel):
    """Optional overrides on the send-now action."""
    channels_sms: Optional[bool] = None
    channels_email: Optional[bool] = None
    sms_recipients: Optional[List[str]] = None
    email_recipients: Optional[List[str]] = None


# ===================================================================
# Data gathering — reuse assistant tools + a yesterday comparison
# ===================================================================
async def _yesterday_sales(db, tenant_id: str) -> dict:
    now = now_ist()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday = today - timedelta(days=1)
    pipe = [
        {"$match": {
            "tenant_id": tenant_id,
            "placedAt": {"$gte": yesterday.isoformat(), "$lt": today.isoformat()},
            "voided": {"$ne": True},
        }},
        {"$group": {"_id": None, "count": {"$sum": 1}, "revenue": {"$sum": "$total"}}},
    ]
    r = await db.orders.aggregate(pipe).to_list(1)
    if not r:
        return {"count": 0, "revenue": 0.0}
    return {"count": r[0]["count"], "revenue": round(r[0]["revenue"], 2)}


async def _gather_digest_data(db, tenant_id: str) -> dict:
    today_sales, yesterday_sales, top_items, low_stock, expiring_stock, active_orders, on_duty = await asyncio.gather(
        _tool_todays_sales(db, tenant_id),
        _yesterday_sales(db, tenant_id),
        _tool_top_items(db, tenant_id, days=1, limit=5),
        _tool_low_stock(db, tenant_id),
        _tool_expiring_stock(db, tenant_id, days=7),
        _tool_active_orders(db, tenant_id),
        _tool_staff_on_duty(db, tenant_id),
    )
    avg_ticket = (today_sales["revenue"] / today_sales["count"]) if today_sales["count"] else 0
    delta_rev = today_sales["revenue"] - yesterday_sales["revenue"]
    delta_pct = (delta_rev / yesterday_sales["revenue"] * 100) if yesterday_sales["revenue"] else None
    return {
        "today": today_sales,
        "yesterday": yesterday_sales,
        "avg_ticket": round(avg_ticket, 2),
        "delta_revenue": round(delta_rev, 2),
        "delta_pct": round(delta_pct, 1) if delta_pct is not None else None,
        "top_items": top_items,
        "low_stock": low_stock,
        "expiring_stock": expiring_stock,
        "active_orders": active_orders,
        "staff_on_duty": len(on_duty),
        "generated_at": now_ist().isoformat(),
    }


# ===================================================================
# AI-written summary via the Anthropic API (Claude Sonnet 4.5)
# Fallback to a deterministic template if the LLM fails / credits exhausted.
# ===================================================================
async def _ai_digest_text(tenant_name: str, data: dict) -> str:
    try:
        import anthropic
        system = (
            f"You are the daily-digest writer for the Kanda POS restaurant "
            f"'{tenant_name}'. Write a concise, warm, actionable daily summary "
            "the owner will read on their phone first thing in the morning. "
            "Use short paragraphs and 3-5 bullet points. Be specific with the "
            "numbers provided. Highlight one thing to celebrate and one thing "
            "to watch — call out any expiring_stock items by name and urgency "
            "(already expired vs. days left) since spoilage is a direct loss. "
            "End with a one-line action tip. Currency is ₹."
        )
        client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        prompt = "Here is today's data as JSON:\n" + json.dumps(data, default=str, indent=2)
        resp = await client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=1024,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        return "".join(block.text for block in resp.content if block.type == "text").strip()
    except Exception as exc:
        logger.warning("Digest AI generation failed, using template: %s", exc)
        return _template_digest_text(tenant_name, data)


def _template_digest_text(tenant_name: str, data: dict) -> str:
    t = data["today"]
    y = data["yesterday"]
    delta = data.get("delta_pct")
    delta_line = ""
    if delta is not None:
        arrow = "▲" if delta >= 0 else "▼"
        delta_line = f" ({arrow} {abs(delta):.1f}% vs yesterday)"
    lines = [
        f"Good morning from {tenant_name} 👋",
        "",
        f"Revenue today: ₹{t['revenue']:.2f} across {t['count']} orders{delta_line}",
        f"Average ticket: ₹{data['avg_ticket']:.2f}",
        f"Yesterday: ₹{y['revenue']:.2f} / {y['count']} orders",
        "",
    ]
    if data["top_items"]:
        lines.append("Top sellers today:")
        for it in data["top_items"][:5]:
            lines.append(f"  • {it['name']} ×{it['qty']} (₹{it['revenue']:.2f})")
        lines.append("")
    if data["low_stock"]:
        lines.append(f"⚠️ {len(data['low_stock'])} item(s) below reorder level:")
        for it in data["low_stock"][:5]:
            lines.append(f"  • {it.get('name','?')} — {it.get('stock','?')} {it.get('unit','')} left")
        lines.append("")
    if data.get("expiring_stock"):
        lines.append(f"⏳ {len(data['expiring_stock'])} item(s) expired or expiring soon:")
        for it in data["expiring_stock"][:5]:
            when = "expired" if it.get("expired") else f"expires {it.get('expiry_date','?')}"
            lines.append(f"  • {it.get('name','?')} — {it.get('stock','?')} {it.get('unit','')} · {when}")
        lines.append("")
    lines.append(f"Currently active: {len(data['active_orders'])} orders · {data['staff_on_duty']} staff on duty")
    return "\n".join(lines)


def _digest_html(tenant_name: str, ai_text: str, data: dict) -> str:
    body = ai_text.replace("\n", "<br>")
    t = data["today"]
    return (
        f'<div style="font-family:Inter,Arial,sans-serif;background:#0f0f14;padding:24px;color:#e6e6ea">'
        f'<div style="max-width:560px;margin:0 auto;background:#181820;border:1px solid #2a2a35;border-radius:14px;padding:24px">'
        f'<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:16px">'
        f'<h2 style="margin:0;color:#fff">Daily digest · {tenant_name}</h2>'
        f'<div style="color:#8a8aa0;font-size:11px">{now_ist().strftime("%d %b %Y")}</div></div>'
        f'<div style="background:#22222d;border-radius:10px;padding:12px;margin-bottom:16px">'
        f'<div style="color:#c9c9d5;font-size:12px;margin-bottom:4px">Revenue today</div>'
        f'<div style="color:#fff;font-size:28px;font-weight:700">₹{t["revenue"]:.2f}</div>'
        f'<div style="color:#8a8aa0;font-size:12px">{t["count"]} orders · avg ₹{data["avg_ticket"]:.2f}</div>'
        f'</div>'
        f'<div style="color:#d0d0dc;font-size:14px;line-height:1.65">{body}</div>'
        f'<p style="color:#666680;font-size:11px;margin-top:24px">Sent by Kanda POS AI · Reply STOP in Voice Agent settings to unsubscribe.</p>'
        f'</div></div>'
    )


def _sms_body(tenant_name: str, data: dict) -> str:
    t = data["today"]
    y = data["yesterday"]
    delta = data.get("delta_pct")
    delta_txt = f" ({'+' if (delta or 0) >= 0 else ''}{delta:.1f}% vs yesterday)" if delta is not None else ""
    top = data["top_items"][0]["name"] if data["top_items"] else "—"
    return (
        f"Kanda · {tenant_name}\n"
        f"Today: ₹{t['revenue']:.0f} / {t['count']} orders{delta_txt}\n"
        f"Top: {top} · Low stock: {len(data['low_stock'])} · Expiring: {len(data.get('expiring_stock') or [])}\n"
        f"Yesterday: ₹{y['revenue']:.0f} / {y['count']} orders"
    )


# ===================================================================
# Persistence
# ===================================================================
async def _get_config(db, tenant_id: str) -> dict:
    doc = await db.digest_configs.find_one({"tenant_id": tenant_id}, {"_id": 0})
    if not doc:
        return DigestConfig().model_dump()
    doc.pop("tenant_id", None)
    doc.pop("last_sent_at", None)
    # backfill defaults for old rows
    d = DigestConfig().model_dump()
    d.update({k: v for k, v in doc.items() if k in d})
    return d


async def _save_config(db, tenant_id: str, cfg: DigestConfig) -> None:
    # Dedupe recipient lists on save so repeated Add clicks / imports don't
    # spam the same person.
    cfg.email_recipients = list(dict.fromkeys([e.strip() for e in cfg.email_recipients if e and e.strip()]))
    cfg.sms_recipients = list(dict.fromkeys([s.strip() for s in cfg.sms_recipients if s and s.strip()]))
    await db.digest_configs.update_one(
        {"tenant_id": tenant_id},
        {"$set": {**cfg.model_dump(), "tenant_id": tenant_id,
                  "updated_at": now_ist().isoformat()}},
        upsert=True,
    )


# ===================================================================
# Send action — shared by /send-now and background scheduler
# ===================================================================
async def _do_send(db, tenant_id: str, override: Optional[DigestPayload] = None) -> dict:
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "id": 1, "name": 1})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    cfg_dict = await _get_config(db, tenant_id)
    cfg = DigestConfig(**cfg_dict)
    if override:
        for f in ("channels_sms", "channels_email", "sms_recipients", "email_recipients"):
            v = getattr(override, f)
            if v is not None:
                setattr(cfg, f, v)

    data = await _gather_digest_data(db, tenant_id)
    text = await _ai_digest_text(tenant["name"], data)

    sent_sms: List[dict] = []
    sent_email: List[dict] = []

    if cfg.channels_sms:
        body = _sms_body(tenant["name"], data)
        for phone in cfg.sms_recipients:
            ok = await send_sms(phone, body)
            sent_sms.append({"to": phone, "ok": ok})

    if cfg.channels_email:
        subject = f"Kanda daily digest · {tenant['name']} · {now_ist().strftime('%d %b')}"
        html = _digest_html(tenant["name"], text, data)
        for email in cfg.email_recipients:
            res = await send_email(email, subject, html)
            sent_email.append({"to": email, "ok": not res.get("error") and not res.get("skipped"), "info": res})

    await db.digest_configs.update_one(
        {"tenant_id": tenant_id},
        {"$set": {"last_sent_at": now_ist().isoformat()}},
        upsert=True,
    )
    return {
        "tenant_name": tenant["name"],
        "ai_text": text,
        "data": data,
        "sent_sms": sent_sms,
        "sent_email": sent_email,
    }


# ===================================================================
# Endpoints
# ===================================================================
def _require_owner_or_manager(u: dict):
    if u.get("dash_role") not in ("owner", "manager", "area_manager"):
        raise HTTPException(status_code=403, detail="Owner or manager only")


@router.get("/digest/config")
async def get_config(u: dict = Depends(get_dash_user)):
    _require_owner_or_manager(u)
    return await _get_config(get_db(), u["tenant_id"])


@router.put("/digest/config")
async def put_config(cfg: DigestConfig, u: dict = Depends(get_dash_user)):
    _require_owner_or_manager(u)
    await _save_config(get_db(), u["tenant_id"], cfg)
    return {"ok": True}


@router.get("/digest/preview")
async def preview(u: dict = Depends(get_dash_user)):
    _require_owner_or_manager(u)
    db = get_db()
    tenant = await db.tenants.find_one({"id": u["tenant_id"]}, {"_id": 0, "name": 1})
    data = await _gather_digest_data(db, u["tenant_id"])
    text = await _ai_digest_text((tenant or {}).get("name") or "your restaurant", data)
    return {"tenant_name": (tenant or {}).get("name"), "data": data, "ai_text": text}


@router.post("/digest/send-now")
async def send_now(payload: DigestPayload, u: dict = Depends(get_dash_user)):
    _require_owner_or_manager(u)
    return await _do_send(get_db(), u["tenant_id"], payload)


# ===================================================================
# Background scheduler — polls every 60s, sends when hour+minute matches.
# One send per tenant per IST day, tracked via `last_sent_at`.
# ===================================================================
async def digest_scheduler_loop(get_db_fn, interval_sec: int = 60):
    logger.info("Digest scheduler loop started (interval=%ss)", interval_sec)
    while True:
        try:
            db = get_db_fn()
            now = now_ist()
            today_ist = now.strftime("%Y-%m-%d")
            cursor = db.digest_configs.find(
                {"enabled": True},
                {"_id": 0, "tenant_id": 1, "send_hour_ist": 1, "send_minute": 1, "last_sent_at": 1},
            )
            async for cfg in cursor:
                hh = int(cfg.get("send_hour_ist", 7))
                mm = int(cfg.get("send_minute", 0))
                # Fire when the wall-clock is at or just past the target and we
                # haven't already sent today.
                target = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
                if now < target:
                    continue
                last = cfg.get("last_sent_at") or ""
                if last.startswith(today_ist):
                    continue
                try:
                    await _do_send(db, cfg["tenant_id"], None)
                    logger.info("Digest sent for tenant %s", cfg["tenant_id"])
                except Exception:
                    logger.exception("Digest send failed for tenant %s", cfg["tenant_id"])
        except Exception:
            logger.exception("digest_scheduler_loop tick failed")
        await asyncio.sleep(interval_sec)
