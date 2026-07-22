"""First-run onboarding for new tenants.

Computes a status object the frontend uses to render a checklist banner:
  · Add at least one custom employee (beyond seeded demo accounts)
  · Take at least one paid order
  · Verify menu has items
  · Confirm location is set up

Once the manager dismisses the checklist (or all items are complete) the
banner stops appearing.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from db import get_db
from auth import require_role
from tenants import tenant_filter
from models import OnboardingStatus

router = APIRouter()

# These IDs are the seeded demo staff. Any user with a different ID counts as
# 'real' staff the manager added themselves.
SEEDED_STAFF_IDS = {"s1", "s2", "s3", "s4"}


@router.get("/onboarding/status", response_model=OnboardingStatus)
async def status(user: dict = Depends(require_role("Manager"))):
    db = get_db()

    # Pull the tenant doc to see if the manager has already dismissed.
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0}) or {}
    dismissed_at = tenant.get("onboarding_dismissed_at")

    users = await db.users.find(tenant_filter(user), {"_id": 0, "id": 1}).to_list(500)
    has_extra_staff = any(u["id"] not in SEEDED_STAFF_IDS for u in users)

    has_real_orders = await db.orders.count_documents(
        tenant_filter(user, {"payment": {"$in": ["cash", "card"]}})
    ) > 0

    has_menu = await db.menu_items.count_documents(tenant_filter(user)) > 0
    has_location = await db.locations.count_documents(tenant_filter(user)) > 0

    completed = bool(dismissed_at) or (has_extra_staff and has_real_orders and has_menu and has_location)
    return {
        "tenant_id": user["tenant_id"],
        "completed": completed,
        "has_extra_staff": has_extra_staff,
        "has_real_orders": has_real_orders,
        "has_menu": has_menu,
        "has_location": has_location,
        "dismissed_at": dismissed_at,
    }


@router.post("/onboarding/dismiss")
async def dismiss(user: dict = Depends(require_role("Manager"))):
    db = get_db()
    await db.tenants.update_one(
        {"id": user["tenant_id"]},
        {"$set": {"onboarding_dismissed_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"ok": True}
