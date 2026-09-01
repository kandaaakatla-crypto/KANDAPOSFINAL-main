"""One-off CLI to populate the Urban Mart retail demo tenant's catalog.

The landing page (frontend/src/components/LandingPage.jsx) advertises a
"Demo Retail POS: Urban Mart" tenant (slug `urbanmart`) that showcases
barcode scanning and product variants — but nothing ever seeded its menu,
categories, or inventory. This fills that gap. Idempotent: safe to re-run,
skips any category/item that already exists by name.

Usage:
    python -m seed_urbanmart_catalog                 # tenant slug "urbanmart"
    python -m seed_urbanmart_catalog --slug otherslug
"""
import argparse
import asyncio
import sys
import uuid

from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent / ".env")

from db import get_db
from tz import now_ist

CATEGORIES = [
    {"name": "Audio", "color": "#3b82f6", "sort_order": 0},
    {"name": "Power & Charging", "color": "#f59e0b", "sort_order": 1},
    {"name": "Mobile Accessories", "color": "#84cc16", "sort_order": 2},
]

# (category name, product name, price, barcode, variants, stock, reorder, cost_per_unit)
PRODUCTS = [
    ("Audio", "Wireless Earbuds", 1999, "8901030912345", None, 24, 8, 1250),
    ("Audio", "Bluetooth Speaker", 2499, "8901030912352", None, 14, 5, 1600),
    ("Audio", "Wired Earphones", 399, "8901030912369", None, 40, 15, 210),
    ("Power & Charging", "20000mAh Power Bank", 1499, "8901030912376", None, 18, 6, 980),
    ("Power & Charging", "USB-C Cable 1m", 299, "8901030912383", None, 3, 20, 120),
    ("Power & Charging", "20W Fast Charger", 899, "8901030912390", None, 22, 8, 540),
    ("Power & Charging", "Wireless Charging Pad", 1299, "8901030912406", None, 11, 5, 780),
    (
        "Mobile Accessories", "Phone Case", 499, None,
        [
            {"label": "iPhone 15", "price": 499, "sku": "CASE-IP15", "available": True},
            {"label": "Galaxy S24", "price": 499, "sku": "CASE-GS24", "available": True},
            {"label": "Universal (5.5\"-6.5\")", "price": 399, "sku": "CASE-UNIV", "available": True},
        ],
        30, 10, 180,
    ),
    ("Mobile Accessories", "Tempered Glass Screen Protector", 199, "8901030912413", None, 45, 15, 60),
    ("Mobile Accessories", "Phone Stand", 349, "8901030912420", None, 16, 6, 140),
]


async def main(slug: str) -> None:
    db = get_db()
    tenant = await db.tenants.find_one({"slug": slug}, {"_id": 0, "id": 1, "name": 1})
    if not tenant:
        print(f"No tenant with slug {slug!r} — create it first (Owner Portal → Tenants → New tenant).", file=sys.stderr)
        sys.exit(1)
    tid = tenant["id"]
    now_iso = now_ist().isoformat()

    cat_id_by_name = {}
    for c in CATEGORIES:
        existing = await db.categories.find_one({"tenant_id": tid, "name": c["name"]}, {"_id": 0, "id": 1})
        if existing:
            cat_id_by_name[c["name"]] = existing["id"]
            continue
        cat_id = f"cat_{uuid.uuid4().hex[:8]}"
        await db.categories.insert_one({
            "id": cat_id, "tenant_id": tid, "name": c["name"], "color": c["color"],
            "sort_order": c["sort_order"], "station": None, "tax_rate": None,
            "updated_at": now_iso, "deleted_at": None,
        })
        cat_id_by_name[c["name"]] = cat_id
        print(f"  + category: {c['name']}")

    created_items = 0
    created_inv = 0
    for cat_name, name, price, barcode, variants, stock, reorder, cost in PRODUCTS:
        existing_item = await db.menu_items.find_one({"tenant_id": tid, "name": name}, {"_id": 0, "id": 1})
        if existing_item:
            continue
        item_id = f"m_{uuid.uuid4().hex[:8]}"
        await db.menu_items.insert_one({
            "id": item_id, "tenant_id": tid, "cat_id": cat_id_by_name[cat_name],
            "name": name, "desc": None, "price": price, "sizes": None,
            "available": True, "is_pizza": False, "deal_groups": None,
            "image_url": None, "barcode": barcode, "variants": variants,
            "tax_rate": None, "updated_at": now_iso, "deleted_at": None,
        })
        created_items += 1
        print(f"  + product: {name} (Rs.{price})")

        existing_inv = await db.inventory.find_one({"tenant_id": tid, "name": name}, {"_id": 0, "id": 1})
        if not existing_inv:
            await db.inventory.insert_one({
                "id": f"i_{uuid.uuid4().hex[:8]}", "tenant_id": tid,
                "name": name, "unit": "pcs", "stock": stock, "reorder": reorder,
                "supplier": "Urban Distributors", "cost_per_unit": cost,
                "expiry_date": None, "location_id": None,
                "updated_at": now_iso, "deleted_at": None,
            })
            created_inv += 1

    print()
    print(f"Done — {created_items} products, {created_inv} inventory rows added to {tenant['name']!r} ({slug}).")
    if created_items == 0:
        print("(Everything already existed — nothing new to add. Safe re-run.)")


def cli() -> None:
    p = argparse.ArgumentParser(description="Seed the Urban Mart retail demo catalog")
    p.add_argument("--slug", default="urbanmart", help="Tenant slug (default: urbanmart)")
    args = p.parse_args()
    asyncio.run(main(args.slug))


if __name__ == "__main__":
    cli()
