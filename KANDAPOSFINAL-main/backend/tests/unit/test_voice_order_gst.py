"""Orders taken by the AI phone agent were saved at the menu price with no
GST at all, so a GST-registered restaurant under-billed (and under-reported
tax on) every phone order, and the caller was quoted the wrong total. Phone
orders now go through the same GST calculation as POS orders.
"""
import asyncio
import os
import uuid

from motor.motor_asyncio import AsyncIOMotorClient

SUFFIX = uuid.uuid4().hex[:6]


def _run(db_name, scheme):
    async def go():
        m = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            db = m[db_name]
            tid = f"vg{scheme[:3]}{SUFFIX}"
            tenant = {"id": tid, "slug": tid, "name": "Phone Biryani", "business_type": "restaurant",
                      "features": {}, "store": {"gst_scheme": scheme}}
            await db.tenants.insert_one(dict(tenant))
            await db.categories.insert_one({"id": f"c{tid}", "tenant_id": tid, "name": "Biryani", "color": "#f00", "sort_order": 1})
            await db.menu_items.insert_one({"id": f"m{tid}", "tenant_id": tid, "name": "Chicken Biryani",
                                            "cat_id": f"c{tid}", "price": 300, "available": True, "deleted_at": None})
            from routes.voice import _tool_place_order
            res = await _tool_place_order(db, tenant, {"items": [{"name": "Chicken Biryani", "qty": 2}],
                                                       "customer_name": "Ravi", "type": "collection"},
                                          {"call_id": None, "from_number": ""})
            order = await db.orders.find_one({"id": res["order_id"]}, {"_id": 0})
            return res, order
        finally:
            m.close()
    return asyncio.run(go())


def test_phone_order_for_gst_store_includes_gst(client, db_name):
    res, order = _run(db_name, "regular")
    assert order["subtotal"] == 600
    assert order["taxTotal"] == 30 and order["cgst"] == 15 and order["sgst"] == 15
    assert order["total"] == 630
    assert res["total"] == 630  # what the agent tells the caller


def test_phone_order_for_composition_store_has_no_gst(client, db_name):
    res, order = _run(db_name, "composition")
    assert order["taxTotal"] == 0 and order["total"] == 600 and res["total"] == 600
