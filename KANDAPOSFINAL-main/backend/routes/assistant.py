"""In-app AI Help Assistant.

A single chat endpoint that any authenticated user can hit to ask questions.
The AI is grounded in three sources:
  1. A concise static knowledge base of "how do I..." answers (below).
  2. Live tenant data via callable tools (today's sales, top items, low stock,
     active orders, staff on duty, pending reservations).
  3. The current page/route the user is on (passed in `context`).

Model: Claude Sonnet 4.5 via emergentintegrations (Emergent LLM key).
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

from db import get_db
from auth import get_current_user
from tenants import tenant_filter

logger = logging.getLogger("kanda.assistant")
router = APIRouter()


# ===================================================================
# STATIC KNOWLEDGE BASE — concise "how do I..." answers
# ===================================================================
KNOWLEDGE_BASE = """
# Kanda POS — Quick How-To Reference

## POS Staff (`/`)
- **Take an order**: click NEW ORDER → pick order type (Dine-in / Takeaway / Delivery) → add items from the menu grid → adjust quantity/size → press CHARGE. For dine-in, pick a table first.
- **Split payment**: on the payment screen, tap "Split" → choose per-person or by-item split → collect each portion.
- **Refund an order**: open the order in Orders tab → three-dot menu → "Refund" → choose full or partial → provide reason.
- **Assign a driver**: for a delivery order, go to Dispatch tab → drag the order onto a driver, or use the "Assign" button on the order card.
- **Clock in/out**: from LOGIN screen, tap "Time Clock" → enter PIN → take webcam selfie → punch in/out. Managers see everyone's timesheet under Workforce → Timesheets.

## Restaurant Dashboard (`/biz`)
- **Add a menu item**: Menu → "New item" → fill name/category/price → save. Add sizes (small/medium/large) or is-pizza toggle for pizzas.
- **Import menu via CSV**: Menu → three-dot menu → Import CSV → download template first, fill in, upload.
- **Add staff member**: Staff → "Add staff" → set name, PIN (4 digits), role (Manager/Cashier/Cook/Delivery), hourly rate.
- **Publish a shift rota**: Workforce/Rota → drag shifts onto the week grid → click "Publish" to notify staff and lock it.
- **Configure the AI voice agent**: Voice Agent → paste your Twilio number → click "Auto-wire webhook" → toggle Enabled ON. Or click "Buy a new number" to get one instantly.
- **Change owner instructions for the agent**: Voice Agent → Owner Instructions field → type notes → Save.

## Platform Owner Portal (`/owner`)
- **Create a new tenant**: Tenants → "New tenant" → set slug (URL-safe), name, subscription plan.
- **Impersonate a tenant**: Tenants → row menu → "Impersonate" → opens the tenant's dashboard in a scoped session.

## Voice Agent
- **Play a call recording**: Voice Agent → click the green play icon on a call row (or open transcript, hit play there).
- **Download the transcript**: open transcript → "Download .txt".
- **Call a customer back**: click the yellow outgoing-phone icon on the row, OR use "Place a test call" panel with their number.
- **Language**: default is Telugu (Telangana). Set to Hindi/English or Auto in the Language dropdown.
- **Noise reduction is ON by default** (`near_field` for phones held to ear).

## Reports
- **Daily sales**: Reports → default view is today. Toggle date range to see last week/month.
- **Tip pool distribution**: Reports → Tip Pool → New pool → enter total → shares split pro-rata by clocked hours.
- **Cash drawer**: Reports → Cash drawer → Open drawer at start of shift, Close at end. Variance shown.

## Inventory
- **Log waste**: Inventory → Waste tab → "Log waste" → pick item, qty, reason. Managers only.
- **Reorder low stock**: Inventory → items below reorder point are highlighted → click Reorder → creates a PO placeholder.
"""


# ===================================================================
# Tool implementations — return live data for the AI to fold into answers
# ===================================================================
async def _tool_todays_sales(db, tenant_id: str) -> dict:
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    pipe = [
        {"$match": {"tenant_id": tenant_id, "placedAt": {"$gte": start}, "voided": {"$ne": True}}},
        {"$group": {"_id": None, "count": {"$sum": 1}, "revenue": {"$sum": "$total"}}},
    ]
    r = await db.orders.aggregate(pipe).to_list(1)
    if not r:
        return {"count": 0, "revenue": 0.0, "since": start}
    return {"count": r[0]["count"], "revenue": round(r[0]["revenue"], 2), "since": start}


async def _tool_top_items(db, tenant_id: str, days: int = 7, limit: int = 5) -> list:
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    pipe = [
        {"$match": {"tenant_id": tenant_id, "placedAt": {"$gte": since}, "voided": {"$ne": True}}},
        {"$unwind": "$items"},
        {"$group": {"_id": "$items.name", "qty": {"$sum": "$items.qty"},
                    "revenue": {"$sum": {"$multiply": ["$items.qty", "$items.price"]}}}},
        {"$sort": {"qty": -1}},
        {"$limit": limit},
    ]
    rows = await db.orders.aggregate(pipe).to_list(limit)
    return [{"name": r["_id"], "qty": r["qty"], "revenue": round(r["revenue"], 2)} for r in rows]


async def _tool_low_stock(db, tenant_id: str) -> list:
    rows = await db.inventory.find(
        {"tenant_id": tenant_id, "$expr": {"$lte": ["$stock", "$reorder_at"]}},
        {"_id": 0, "name": 1, "stock": 1, "unit": 1, "reorder_at": 1},
    ).to_list(50)
    return rows


async def _tool_active_orders(db, tenant_id: str) -> list:
    rows = await db.orders.find(
        {"tenant_id": tenant_id, "status": {"$in": ["new", "preparing", "ready"]}, "voided": {"$ne": True}},
        {"_id": 0, "number": 1, "type": 1, "status": 1, "total": 1, "placedAt": 1,
         "customer.name": 1, "table": 1},
    ).sort("placedAt", 1).to_list(30)
    return rows


async def _tool_staff_on_duty(db, tenant_id: str) -> list:
    # People clocked in with no matching clock-out yet.
    rows = await db.time_punches.aggregate([
        {"$match": {"tenant_id": tenant_id}},
        {"$sort": {"timestamp": -1}},
        {"$group": {"_id": "$user_id", "last": {"$first": "$$ROOT"}}},
        {"$match": {"last.type": "in"}},
        {"$replaceRoot": {"newRoot": "$last"}},
    ]).to_list(50)
    return [{"user_id": r["user_id"], "user_name": r.get("user_name"), "since": r["timestamp"]} for r in rows]


async def _tool_pending_reservations(db, tenant_id: str) -> list:
    now = datetime.now(timezone.utc).isoformat()
    rows = await db.reservations.find(
        {"tenant_id": tenant_id, "status": "booked", "at": {"$gte": now}},
        {"_id": 0, "customer_name": 1, "party_size": 1, "at": 1, "phone": 1},
    ).sort("at", 1).to_list(30)
    return rows


TOOLS = [
    {"name": "get_todays_sales", "description": "Total orders + revenue since midnight today (in local timezone approx)."},
    {"name": "get_top_items", "description": "Best-selling menu items in the last 7 days (top 5 by qty)."},
    {"name": "get_low_stock", "description": "Inventory items at or below their reorder threshold — needs restocking."},
    {"name": "get_active_orders", "description": "Currently pending orders (new / preparing / ready)."},
    {"name": "get_staff_on_duty", "description": "Employees currently clocked in (with no matching clock-out)."},
    {"name": "get_pending_reservations", "description": "Upcoming table reservations that haven't happened yet."},
]

TOOL_RUNNERS = {
    "get_todays_sales": _tool_todays_sales,
    "get_top_items": _tool_top_items,
    "get_low_stock": _tool_low_stock,
    "get_active_orders": _tool_active_orders,
    "get_staff_on_duty": _tool_staff_on_duty,
    "get_pending_reservations": _tool_pending_reservations,
}


async def _run_tools_bundle(db, tenant_id: str, tool_names: list[str]) -> dict:
    """Run each requested tool once and return a name → result dict.
    We keep this small on purpose — the model asks for the specific tools it
    needs (returned as JSON) rather than always fetching everything."""
    out: dict[str, Any] = {}
    for name in tool_names:
        runner = TOOL_RUNNERS.get(name)
        if not runner:
            continue
        try:
            out[name] = await runner(db, tenant_id)
        except Exception:
            logger.exception("Assistant tool %s failed", name)
            out[name] = {"error": "tool failed"}
    return out


# ===================================================================
# Chat endpoint
# ===================================================================
class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatPayload(BaseModel):
    messages: list[ChatMessage]
    route: Optional[str] = None      # current URL path, e.g. "/biz/voice"
    role_hint: Optional[str] = None  # "owner" | "manager" | "staff"


def _system_prompt(tenant: dict, role_hint: Optional[str], route: Optional[str]) -> str:
    tenant_name = tenant.get("name") or "your restaurant"
    tool_list = "\n".join(f"- `{t['name']}`: {t['description']}" for t in TOOLS)
    return (
        f"You are the in-app AI helper for **Kanda POS**, embedded in the "
        f"{tenant_name} tenant. Your job is to help staff/managers/owners use "
        "the POS quickly. Keep answers TIGHT: 1–3 sentences unless the user asks "
        "for a walkthrough. Format with short bullet points when helpful.\n\n"
        f"Current user role: {role_hint or 'unknown'}. "
        f"Current page: {route or 'unknown'}.\n\n"
        "You can request LIVE tenant data by ending your reply with a JSON tool "
        "request on a NEW LINE like:\n"
        "  <tools>[\"get_todays_sales\", \"get_top_items\"]</tools>\n"
        "When you emit that tag, the system will fetch the data and give you a "
        "follow-up turn to include the numbers in a fresh reply. If you don't "
        "need live data, DO NOT emit the tag — just answer directly.\n\n"
        f"Available tools:\n{tool_list}\n\n"
        f"--- STATIC KNOWLEDGE BASE ---\n{KNOWLEDGE_BASE}\n--- END KNOWLEDGE ---"
    )


async def _llm_reply(system: str, messages: list[dict]) -> str:
    """Single LLM turn using emergentintegrations."""
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    chat = (
        LlmChat(
            api_key=os.environ["EMERGENT_LLM_KEY"],
            session_id=f"assistant-{datetime.now(timezone.utc).timestamp()}",
            system_message=system,
        )
        .with_model("anthropic", "claude-sonnet-4-5")
    )
    # Replay prior turns as separate UserMessage / AssistantMessage entries so
    # the model has full context. emergentintegrations' send_message takes ONE
    # user message; earlier turns get baked into the system prompt for a
    # single-shot call. Keep it simple: concatenate the transcript.
    transcript = "\n".join(f"{m['role'].upper()}: {m['content']}" for m in messages[:-1])
    last_user = messages[-1]["content"] if messages else ""
    if transcript:
        prompt = f"Prior conversation:\n{transcript}\n\nLatest user message:\n{last_user}"
    else:
        prompt = last_user
    reply = await chat.send_message(UserMessage(text=prompt))
    return str(reply)


def _extract_tool_request(reply: str) -> tuple[str, list[str]]:
    """Split a model reply into (visible_text, list_of_tool_names).
    Model emits `<tools>[...]</tools>` at the end when it wants live data."""
    import re
    m = re.search(r"<tools>\s*(\[.*?\])\s*</tools>", reply, re.S)
    if not m:
        return reply.strip(), []
    try:
        tools = json.loads(m.group(1))
    except Exception:
        return reply.strip(), []
    visible = (reply[:m.start()] + reply[m.end():]).strip()
    return visible, [str(t) for t in tools if isinstance(t, str)]


@router.post("/assistant/chat")
async def chat(payload: ChatPayload, user: dict = Depends(get_current_user)):
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages required")
    db = get_db()
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "id": 1, "name": 1, "slug": 1})
    if not tenant:
        raise HTTPException(status_code=403, detail="Tenant not found")

    system = _system_prompt(tenant, payload.role_hint or user.get("role"), payload.route)
    turns = [m.model_dump() for m in payload.messages]

    # First LLM turn — model either answers directly or requests tools.
    try:
        reply = await _llm_reply(system, turns)
    except Exception as e:
        msg = str(e)
        if "Budget" in msg or "budget" in msg:
            raise HTTPException(status_code=402, detail="AI credits exhausted — please top up the Emergent Universal Key in your Profile.")
        logger.exception("Assistant LLM call failed")
        raise HTTPException(status_code=502, detail=f"AI upstream error: {msg[:200]}")
    visible, tool_names = _extract_tool_request(reply)
    tool_data = {}
    if tool_names:
        tool_data = await _run_tools_bundle(db, tenant["id"], tool_names)
        # Give the model a second turn to incorporate the data.
        followup_user = (
            "System has fetched the tool results you asked for. Answer the user "
            "now using this data (do NOT emit another <tools> tag):\n\n"
            + json.dumps(tool_data, default=str, indent=2)
        )
        turns.append({"role": "assistant", "content": visible or "(fetching data…)"})
        turns.append({"role": "user", "content": followup_user})
        try:
            reply2 = await _llm_reply(system, turns)
        except Exception as e:
            msg = str(e)
            if "Budget" in msg or "budget" in msg:
                raise HTTPException(status_code=402, detail="AI credits exhausted — please top up the Emergent Universal Key in your Profile.")
            logger.exception("Assistant LLM follow-up failed")
            raise HTTPException(status_code=502, detail=f"AI upstream error: {msg[:200]}")
        visible2, _ = _extract_tool_request(reply2)
        return {"reply": visible2, "tools_used": tool_names, "tool_data": tool_data}

    return {"reply": visible, "tools_used": [], "tool_data": {}}



# ===================================================================
# Voice input — server-side transcription via OpenAI Whisper.
# Frontend records audio with MediaRecorder (works on every modern browser)
# and posts the blob here; we return the transcribed text.
# ===================================================================
@router.post("/assistant/transcribe")
async def transcribe(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """Transcribe a short audio clip (< 25 MB) via OpenAI whisper-1.
    Runs on the same Emergent LLM key as the chat endpoint."""
    from emergentintegrations.llm.openai import OpenAISpeechToText
    import io

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty audio")
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio too large (max 25 MB)")

    buf = io.BytesIO(data)
    # emergentintegrations expects a filename attribute so it can infer format.
    buf.name = file.filename or "voice.webm"

    stt = OpenAISpeechToText(api_key=os.environ["EMERGENT_LLM_KEY"])
    try:
        resp = await stt.transcribe(file=buf, model="whisper-1", response_format="json")
    except Exception as exc:
        msg = str(exc)
        if "Budget" in msg or "budget" in msg:
            raise HTTPException(status_code=402, detail="AI credits exhausted — please top up the Emergent Universal Key.")
        logger.exception("Whisper transcription failed")
        raise HTTPException(status_code=502, detail=f"Transcription failed: {msg[:200]}")
    text = getattr(resp, "text", "") or ""
    return {"text": text.strip()}
