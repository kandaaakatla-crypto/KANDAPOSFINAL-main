"""Menu CSV import + export with recipes — Manager-only.

Column order (extended 2026-02-25 to include recipes):
    id, category, name, description, price, size_sm, size_md, size_lg,
    available, is_pizza,
    recipe_default, recipe_sm, recipe_md, recipe_lg

Recipe columns hold a human-readable `name:qty;name:qty;...` list, where
`name` is an inventory item's name (case-insensitive). Example:
    Dough Mix:1;Pepperoni:50g;Tomato Sauce:60g
For non-sized items, only `recipe_default` is used. For pizzas, the three
size-specific columns are used (size_sm → recipe_sm, etc.).
"""
import io
import csv
import uuid
import re
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import StreamingResponse

from db import get_db
from auth import require_role
from tenants import tenant_filter
from ._shared import PROJECTION

router = APIRouter()

HEADERS = ["id", "category", "name", "description", "price",
           "size_sm", "size_md", "size_lg", "available", "is_pizza",
           "recipe_default", "recipe_sm", "recipe_md", "recipe_lg"]

_TRUE = {"1", "true", "yes", "y", "t"}


def _truthy(v) -> bool:
    return str(v or "").strip().lower() in _TRUE


def _serialize_ingredients(ingredients: list[dict], inv_by_id: dict[str, dict]) -> str:
    """Render `[{inventory_id, qty}, ...]` as `Name:qty;Name:qty` for the CSV cell."""
    parts = []
    for ing in ingredients:
        inv = inv_by_id.get(ing.get("inventory_id"))
        if not inv:
            continue
        parts.append(f"{inv['name']}:{ing.get('qty', 0)}")
    return ";".join(parts)


def _parse_ingredients(raw: str, inv_by_name: dict[str, str]) -> tuple[list[dict], list[str]]:
    """Parse `Name:qty;Name:qty` back into `[{inventory_id, qty}]`. Returns
    (ingredients, warnings) — unknown names are listed as warnings."""
    out: list[dict] = []
    warns: list[str] = []
    if not raw or not raw.strip():
        return out, warns
    for chunk in raw.split(";"):
        chunk = chunk.strip()
        if not chunk:
            continue
        if ":" not in chunk:
            warns.append(f"bad fragment '{chunk}' (use Name:qty)")
            continue
        name, qty_s = chunk.rsplit(":", 1)
        name = name.strip()
        # Allow a unit suffix on the qty (e.g. "200g") — strip non-digit/dot suffix.
        m = re.match(r"^\s*([\d.]+)", qty_s)
        if not m:
            warns.append(f"bad qty in '{chunk}'")
            continue
        try:
            qty = float(m.group(1))
        except ValueError:
            warns.append(f"bad qty in '{chunk}'")
            continue
        inv_id = inv_by_name.get(name.lower())
        if not inv_id:
            warns.append(f"unknown ingredient '{name}'")
            continue
        out.append({"inventory_id": inv_id, "qty": qty})
    return out, warns


@router.get("/menu/export.csv")
async def export_menu_csv(user: dict = Depends(require_role("Manager"))):
    db = get_db()
    cats = await db.categories.find(tenant_filter(user), PROJECTION).to_list(200)
    cat_name = {c["id"]: c["name"] for c in cats}
    items = await db.menu_items.find(tenant_filter(user), PROJECTION).to_list(2000)
    inv = await db.inventory.find(tenant_filter(user), PROJECTION).to_list(2000)
    inv_by_id = {i["id"]: i for i in inv}
    recipes = await db.recipes.find(tenant_filter(user), PROJECTION).to_list(5000)
    # Group recipes by (menu_item_id, size)
    rec_lookup: dict[tuple[str, Optional[str]], list[dict]] = {}
    for r in recipes:
        key = (r["menu_item_id"], r.get("size"))
        rec_lookup[key] = r.get("ingredients", [])

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(HEADERS)
    for m in items:
        sizes = m.get("sizes") or {}
        rec_default = _serialize_ingredients(rec_lookup.get((m["id"], None), []), inv_by_id)
        rec_sm = _serialize_ingredients(rec_lookup.get((m["id"], "sm"), []), inv_by_id)
        rec_md = _serialize_ingredients(rec_lookup.get((m["id"], "md"), []), inv_by_id)
        rec_lg = _serialize_ingredients(rec_lookup.get((m["id"], "lg"), []), inv_by_id)
        w.writerow([
            m.get("id", ""),
            cat_name.get(m.get("cat_id", ""), ""),
            m.get("name", ""),
            m.get("desc") or "",
            "" if m.get("is_pizza") else (m.get("price") or ""),
            sizes.get("sm", "") if m.get("is_pizza") else "",
            sizes.get("md", "") if m.get("is_pizza") else "",
            sizes.get("lg", "") if m.get("is_pizza") else "",
            "true" if m.get("available", True) else "false",
            "true" if m.get("is_pizza") else "false",
            rec_default, rec_sm, rec_md, rec_lg,
        ])
    return StreamingResponse(
        iter([buf.getvalue().encode("utf-8")]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="kanda-menu.csv"'},
    )


@router.get("/menu/template.csv")
async def csv_template(user: dict = Depends(require_role("Manager"))):
    """Header + 2 illustrative rows showing the recipe column format."""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(HEADERS)
    w.writerow(["", "Pizzas", "Tandoori Paneer 12\"", "Spicy paneer with mint chutney", "",
                "9.49", "13.99", "16.99", "true", "true",
                "",
                "Dough Mix:1;Paneer:80;Tomato Sauce:60",
                "Dough Mix:1.5;Paneer:120;Tomato Sauce:90",
                "Dough Mix:2;Paneer:160;Tomato Sauce:120"])
    w.writerow(["", "Sides", "Garlic Knots", "Soft warm knots brushed with garlic butter",
                "3.49", "", "", "", "true", "false",
                "Dough Mix:0.5;Garlic Butter:15", "", "", ""])
    return StreamingResponse(
        iter([buf.getvalue().encode("utf-8")]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="kanda-menu-template.csv"'},
    )


@router.post("/menu/import")
async def import_menu_csv(file: UploadFile = File(...), dry_run: bool = False,
                          user: dict = Depends(require_role("Manager"))):
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload a .csv file")
    raw = (await file.read()).decode("utf-8", errors="ignore")
    reader = csv.DictReader(io.StringIO(raw))
    if reader.fieldnames is None or not all(h in reader.fieldnames for h in ["category", "name"]):
        raise HTTPException(status_code=400, detail=f"CSV must include the columns: {', '.join(HEADERS)}")

    db = get_db()
    cats = await db.categories.find(tenant_filter(user), PROJECTION).to_list(200)
    cat_by_name = {(c["name"] or "").strip().lower(): c["id"] for c in cats}
    existing_by_id = {m["id"]: m for m in await db.menu_items.find(tenant_filter(user), PROJECTION).to_list(2000)}
    inv = await db.inventory.find(tenant_filter(user), PROJECTION).to_list(2000)
    inv_by_name = {(i["name"] or "").strip().lower(): i["id"] for i in inv}

    created = updated = skipped = 0
    errors: list[dict] = []
    changes: list[dict] = []
    pending: list[tuple[str, dict, str, dict[str, list[dict]]]] = []  # (action, doc, id, recipes_by_size)

    for i, row in enumerate(reader, start=2):
        name = (row.get("name") or "").strip()
        category = (row.get("category") or "").strip().lower()
        if not name or not category:
            skipped += 1; errors.append({"row": i, "reason": "Missing name or category"}); continue
        cat_id = cat_by_name.get(category)
        if not cat_id:
            skipped += 1; errors.append({"row": i, "reason": f"Unknown category '{row.get('category')}'"}); continue
        is_pizza = _truthy(row.get("is_pizza"))
        doc = {
            "tenant_id": user["tenant_id"], "cat_id": cat_id, "name": name,
            "desc": (row.get("description") or "").strip() or None,
            "available": _truthy(row.get("available")) if row.get("available") else True,
            "is_pizza": is_pizza,
        }
        try:
            if is_pizza:
                doc["sizes"] = {"sm": float(row.get("size_sm") or 0), "md": float(row.get("size_md") or 0), "lg": float(row.get("size_lg") or 0)}
                doc["price"] = None
            else:
                doc["price"] = float(row.get("price") or 0)
                doc["sizes"] = None
        except ValueError:
            skipped += 1; errors.append({"row": i, "reason": "Bad price"}); continue

        # Parse the recipe columns into a {size: ingredients[]} dict.
        recipes_for_item: dict[Optional[str], list[dict]] = {}
        rcols = [(None, "recipe_default"), ("sm", "recipe_sm"), ("md", "recipe_md"), ("lg", "recipe_lg")]
        for size, col in rcols:
            raw_r = (row.get(col) or "").strip()
            if not raw_r:
                continue
            ings, warns = _parse_ingredients(raw_r, inv_by_name)
            for w in warns:
                errors.append({"row": i, "reason": f"{col}: {w}"})
            if ings:
                recipes_for_item[size] = ings

        item_id = (row.get("id") or "").strip()
        if item_id and item_id in existing_by_id:
            updated += 1
            changes.append({"row": i, "action": "update", "id": item_id, "name": name, "category": row.get("category"), "recipes": sum(len(v) for v in recipes_for_item.values())})
            pending.append(("update", doc, item_id, recipes_for_item))
        elif item_id:
            created += 1
            changes.append({"row": i, "action": "create_with_id", "id": item_id, "name": name, "category": row.get("category"), "recipes": sum(len(v) for v in recipes_for_item.values())})
            doc["id"] = item_id
            pending.append(("create", doc, item_id, recipes_for_item))
        else:
            created += 1
            new_id = f"m_{uuid.uuid4().hex[:8]}"
            doc["id"] = new_id
            changes.append({"row": i, "action": "create", "id": new_id, "name": name, "category": row.get("category"), "recipes": sum(len(v) for v in recipes_for_item.values())})
            pending.append(("create", doc, new_id, recipes_for_item))

    if dry_run:
        return {"dry_run": True, "created": created, "updated": updated, "skipped": skipped, "errors": errors[:50], "changes": changes[:200]}

    for action, doc, ident, recipes_for_item in pending:
        if action == "update":
            await db.menu_items.find_one_and_update(tenant_filter(user, {"id": ident}), {"$set": doc})
        else:
            await db.menu_items.insert_one(doc)
        # Replace recipes for this item.
        if recipes_for_item:
            await db.recipes.delete_many(tenant_filter(user, {"menu_item_id": ident}))
            for size, ingredients in recipes_for_item.items():
                await db.recipes.insert_one({
                    "tenant_id": user["tenant_id"],
                    "menu_item_id": ident,
                    "size": size,
                    "ingredients": ingredients,
                })

    return {"created": created, "updated": updated, "skipped": skipped, "errors": errors[:20]}
