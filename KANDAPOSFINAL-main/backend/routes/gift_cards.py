"""Digital gift cards — a prepaid balance identified by a code rather than
a customer record, so it can be bought for and redeemed by anyone (unlike
store credit, which lives on a specific customer's account).

Issuing a card is a Dashboard/Manager action (denomination + optional
recipient contact, texted/emailed the code). Redemption at checkout is
server-authoritative — `redeem_gift_card_for_order` re-reads the real
balance rather than trusting the client, mirroring `routes/loyalty.py`'s
`burn_for_order` and `routes/store_credit.py`'s `burn_credit_for_order`.

Endpoints:
  POST  /gift-cards               — issue a new card (Manager)
  GET   /gift-cards                — list all cards for the tenant (Manager)
  GET   /gift-cards/lookup?code=   — balance check for checkout (any staff)
  PATCH /gift-cards/{id}/cancel    — deactivate a card (Manager)
"""
import secrets
import string
import uuid
from tz import now_ist
from typing import List

from fastapi import APIRouter, HTTPException, Depends, Query

from db import get_db
from auth import get_current_user, require_role
from tenants import tenant_filter, get_tenant
from models import GiftCard, GiftCardCreate
from email_service import send_email, gift_card_email
from sms_service import send_sms

router = APIRouter()

# Excludes visually-ambiguous chars (0/O, 1/I/L) so codes are easy to read back and retype.
_CODE_ALPHABET = "".join(c for c in string.ascii_uppercase + string.digits if c not in "O0I1L")


def _now() -> str:
    return now_ist().isoformat()


def _generate_code() -> str:
    chunk = lambda: "".join(secrets.choice(_CODE_ALPHABET) for _ in range(4))
    return f"GIFT-{chunk()}-{chunk()}"


async def _log_txn(db, tenant_id: str, card: dict, kind: str, amount: float,
                    order_id: str | None, by_user_id: str | None, by_user_name: str | None) -> None:
    await db.gift_card_txns.insert_one({
        "id": f"gt_{uuid.uuid4().hex[:10]}",
        "tenant_id": tenant_id,
        "gift_card_id": card["id"],
        "code": card["code"],
        "kind": kind,
        "amount": amount,
        "order_id": order_id,
        "by_user_id": by_user_id,
        "by_user_name": by_user_name,
        "at": _now(),
    })


async def redeem_gift_card_for_order(db, user_doc: dict, order_doc: dict, code: str, amount: float) -> float:
    """Redeem `amount` against the gift card `code`. Returns the amount
    actually redeemed (capped by balance and the order's gross item
    subtotal). Raises on invalid/inactive/not-found card."""
    if amount <= 0 or not code:
        return 0.0
    gross_items = sum(float(it.get("price", 0)) * float(it.get("qty", 0)) for it in order_doc.get("items", []))
    # The debit is one conditional update that only matches while the card
    # is still active and still holds at least what we're taking, so two
    # terminals redeeming the same card at once can't both spend the same
    # balance. If another terminal got there first, re-read and try again
    # with whatever is left.
    for _ in range(5):
        card = await db.gift_cards.find_one(tenant_filter(user_doc, {"code": code.strip().upper()}), {"_id": 0})
        if not card:
            raise HTTPException(status_code=404, detail="Gift card not found")
        if card["status"] != "active":
            raise HTTPException(status_code=400, detail=f"Gift card is {card['status']}")
        redeemed = round(min(amount, float(card["balance"]), gross_items), 2)
        if redeemed <= 0:
            return 0.0
        now = _now()
        after = {"$max": [0, {"$round": [{"$subtract": ["$balance", redeemed]}, 2]}]}
        updated = await db.gift_cards.find_one_and_update(
            {"id": card["id"], "tenant_id": user_doc["tenant_id"],
             "status": "active", "balance": {"$gte": redeemed - 0.005}},
            [{"$set": {"balance": after}},
             {"$set": {
                 "status": {"$cond": [{"$lte": ["$balance", 0]}, "redeemed", "$status"]},
                 "redeemed_at": {"$cond": [{"$lte": ["$balance", 0]}, now, "$redeemed_at"]},
             }}],
            projection={"_id": 0},
        )
        if updated:
            await _log_txn(db, user_doc["tenant_id"], card, "redeem", -redeemed, order_doc["id"], user_doc["id"], user_doc["name"])
            return redeemed
    raise HTTPException(status_code=409, detail="Gift card is being used on another terminal, try again")


@router.post("/gift-cards", response_model=GiftCard)
async def issue_gift_card(payload: GiftCardCreate, user: dict = Depends(require_role("Manager"))):
    if payload.value <= 0:
        raise HTTPException(status_code=400, detail="Value must be positive")
    db = get_db()
    code = _generate_code()
    # Astronomically unlikely to collide, but re-roll once just in case.
    if await db.gift_cards.find_one(tenant_filter(user, {"code": code})):
        code = _generate_code()
    doc = {
        "id": f"gc_{uuid.uuid4().hex[:10]}",
        "tenant_id": user["tenant_id"],
        "code": code,
        "initial_value": float(payload.value),
        "balance": float(payload.value),
        "recipient_name": (payload.recipient_name or "").strip() or None,
        "recipient_phone": (payload.recipient_phone or "").strip() or None,
        "recipient_email": (payload.recipient_email or "").strip() or None,
        "purchaser_name": (payload.purchaser_name or "").strip() or None,
        "status": "active",
        "created_at": _now(),
        "created_by": user["name"],
        "expires_at": payload.expires_at,
        "redeemed_at": None,
    }
    await db.gift_cards.insert_one(doc)
    await _log_txn(db, user["tenant_id"], doc, "issue", float(payload.value), None, user["id"], user["name"])

    # Best-effort delivery to the recipient — never blocks issuing the card.
    if doc["recipient_email"] or doc["recipient_phone"]:
        tenant = await get_tenant(user, db)
        if doc["recipient_email"]:
            subject, html = gift_card_email(doc, tenant)
            await send_email(doc["recipient_email"], subject, html)
        if doc["recipient_phone"]:
            store_name = (tenant.get("store") or {}).get("name") or tenant.get("name") or "Kanda POS"
            await send_sms(doc["recipient_phone"], f"You've received a ₹{doc['initial_value']:.0f} gift card from {store_name}! Code: {doc['code']}")

    doc.pop("_id", None)
    return doc


@router.get("/gift-cards", response_model=List[GiftCard])
async def list_gift_cards(user: dict = Depends(require_role("Manager"))):
    db = get_db()
    return await db.gift_cards.find(tenant_filter(user), {"_id": 0}).sort("created_at", -1).to_list(500)


@router.get("/gift-cards/lookup")
async def lookup_gift_card(user: dict = Depends(get_current_user), code: str = Query(..., min_length=4)):
    """Cashier checkout: 'is this code valid, and what's the balance?'"""
    db = get_db()
    card = await db.gift_cards.find_one(tenant_filter(user, {"code": code.strip().upper()}), {"_id": 0})
    if not card:
        return {"found": False}
    return {
        "found": True, "id": card["id"], "code": card["code"],
        "balance": card["balance"], "status": card["status"],
    }


@router.patch("/gift-cards/{card_id}/cancel", response_model=GiftCard)
async def cancel_gift_card(card_id: str, user: dict = Depends(require_role("Manager"))):
    db = get_db()
    card = await db.gift_cards.find_one(tenant_filter(user, {"id": card_id}), {"_id": 0})
    if not card:
        raise HTTPException(status_code=404, detail="Gift card not found")
    if card["status"] != "active":
        raise HTTPException(status_code=400, detail=f"Card is already {card['status']}")
    await db.gift_cards.update_one({"id": card_id, "tenant_id": user["tenant_id"]}, {"$set": {"status": "cancelled"}})
    await _log_txn(db, user["tenant_id"], card, "cancel", 0, None, user["id"], user["name"])
    fresh = await db.gift_cards.find_one(tenant_filter(user, {"id": card_id}), {"_id": 0})
    return fresh
