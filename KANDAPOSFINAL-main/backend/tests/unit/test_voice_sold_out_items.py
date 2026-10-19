"""Launch item: the AI phone agent offered and took orders for items the
restaurant had deleted or marked sold out. The menu in the agent's prompt
skipped sold-out items but not deleted ones, and `place_order` matched
against every row in menu_items, so a caller naming a deleted or sold-out
dish got it added to a real kitchen ticket.
"""
import asyncio
import os
import uuid

from motor.motor_asyncio import AsyncIOMotorClient


def _run(db_name, coro_fn):
    async def go():
        m = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            db = m[db_name]
            tid = f"vso{uuid.uuid4().hex[:8]}"
            tenant = {"id": tid, "slug": tid, "name": "Phone Biryani", "business_type": "restaurant",
                      "features": {}, "store": {"gst_scheme": "composition"}}
            await db.tenants.insert_one(dict(tenant))
            await db.categories.insert_one({"id": f"c{tid}", "tenant_id": tid, "name": "Mains",
                                            "color": "#f00", "sort_order": 1})
            base = {"tenant_id": tid, "cat_id": f"c{tid}", "price": 200}
            await db.menu_items.insert_many([
                {**base, "id": f"ok{tid}", "name": "Veg Biryani", "available": True, "deleted_at": None},
                {**base, "id": f"so{tid}", "name": "Mutton Biryani", "available": False, "deleted_at": None},
                {**base, "id": f"de{tid}", "name": "Prawn Fry", "available": True,
                 "deleted_at": "2026-10-01T10:00:00+05:30"},
                # Contains "Mutton Biryani": a sold-out exact match must not
                # silently fall through to this one.
                {**base, "id": f"fp{tid}", "name": "Mutton Biryani Family Pack", "available": True,
                 "deleted_at": None},
            ])
            return await coro_fn(db, tenant)
        finally:
            m.close()
    return asyncio.run(go())


def _place(items):
    async def fn(db, tenant):
        from routes.voice import _tool_place_order
        res = await _tool_place_order(db, tenant, {"items": items, "customer_name": "Ravi", "type": "collection"},
                                      {"call_id": None, "from_number": ""})
        count = await db.orders.count_documents({"tenant_id": tenant["id"]})
        return res, count
    return fn


def test_agent_menu_leaves_out_deleted_and_sold_out_items(client, db_name):
    async def fn(db, tenant):
        from routes.voice import _build_tenant_context
        return await _build_tenant_context(db, tenant)
    ctx = _run(db_name, fn)
    assert "Veg Biryani" in ctx
    assert "Prawn Fry" not in ctx            # deleted
    assert "Mutton Biryani (" not in ctx     # sold out (the family pack is still listed)


def test_sold_out_item_is_refused(client, db_name):
    res, orders = _run(db_name, _place([{"name": "Mutton Biryani", "qty": 1}]))
    assert res["ok"] is False
    assert "Mutton Biryani" in res["error"] and "sold out" in res["error"].lower()
    assert orders == 0


def test_deleted_item_is_refused(client, db_name):
    res, orders = _run(db_name, _place([{"name": "Prawn Fry", "qty": 1}]))
    assert res["ok"] is False
    assert orders == 0


def test_sold_out_item_in_a_mixed_order_refuses_the_order(client, db_name):
    """Taking the rest of the order without the sold-out dish would put a
    ticket on the KDS the caller never agreed to; the agent gets told which
    item is out so it can ask the caller for a replacement."""
    res, orders = _run(db_name, _place([{"name": "Veg Biryani", "qty": 1}, {"name": "Mutton Biryani", "qty": 1}]))
    assert res["ok"] is False
    assert res["unavailable"] == ["Mutton Biryani"]
    assert orders == 0


def test_available_item_still_orders(client, db_name):
    res, orders = _run(db_name, _place([{"name": "Veg Biryani", "qty": 2}]))
    assert res["ok"] is True, res
    assert res["total"] == 400
    assert orders == 1
