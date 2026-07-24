"""Tenant scoping helpers for Kanda POS multi-tenancy.

Every business-critical collection (users, menu_items, categories, customers,
tables, inventory, orders) carries a `tenant_id`. JWT tokens encode the
authenticated user's `tenant_id`; every resource query in `server.py` filters
by it via `tenant_filter()` so XYZ Pizza can never see ABC's data.

Tenant resolution at login time is via the `X-Tenant-Slug` request header.
Frontend derives the slug from the subdomain (e.g. `xyzpizza.kanda.app` →
`xyzpizza`) and falls back to `demo` in non-subdomain environments.
"""
from datetime import datetime, timezone
from tz import now_ist
from fastapi import Request, HTTPException
from typing import Optional


TENANT_HEADER = "X-Tenant-Slug"
DEFAULT_TENANT_SLUG = "demo"

DEMO_TENANT = {
    "id": "demo",
    "slug": "demo",
    "name": "Demo Restaurant",
    "store": {
        "name": "Demo Restaurant",
        "address": "Plot 22, HiTech City Main Rd, Madhapur, Hyderabad 500081",
        "phone": "+91 40 4500 1234",
        "tax_id": "GSTIN 36ABCDE1234F1Z5",
        "footer": "Thank you for ordering!",
    },
    "contact_email": "owner@demorestaurant.in",
    "plan": "trial",
    "status": "active",
}


def tenant_filter(user: dict, extra: Optional[dict] = None) -> dict:
    """Return a Mongo filter scoped to the authenticated user's tenant."""
    base = {"tenant_id": user["tenant_id"]}
    if extra:
        base.update(extra)
    return base


async def resolve_tenant_from_request(request: Request, db) -> dict:
    slug = request.headers.get(TENANT_HEADER, DEFAULT_TENANT_SLUG).strip().lower()
    tenant = await db.tenants.find_one({"slug": slug, "status": "active"}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail=f"Tenant '{slug}' not found")
    return tenant


async def get_tenant(user: dict, db) -> dict:
    """Look up the tenant document for an authenticated user."""
    t = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return t


async def seed_default_tenant(db) -> None:
    """Idempotently insert the demo tenant and backfill legacy single-tenant rows."""
    if await db.tenants.count_documents({"id": DEMO_TENANT["id"]}) == 0:
        doc = dict(DEMO_TENANT)
        doc["created_at"] = now_ist().isoformat()
        await db.tenants.insert_one(doc)

    # Backfill any rows that pre-date multi-tenancy.
    for coll in ["users", "categories", "menu_items", "customers", "tables", "inventory", "orders"]:
        await db[coll].update_many(
            {"tenant_id": {"$exists": False}},
            {"$set": {"tenant_id": DEMO_TENANT["id"]}},
        )
