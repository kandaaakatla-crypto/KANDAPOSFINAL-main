"""Seed Kanda POS Mongo with mock data on first boot. Idempotent."""
from datetime import datetime, timezone, timedelta
from auth import hash_pin


STAFF = [
    {"id": "s1", "name": "Aarav Reddy",     "pin": "1234", "role": "Manager", "initials": "AR"},
    {"id": "s2", "name": "Priya Iyer",      "pin": "2345", "role": "Cashier", "initials": "PI"},
    {"id": "s3", "name": "Rohan Sharma",    "pin": "3456", "role": "Cashier", "initials": "RS"},
    {"id": "s4", "name": "Karthik Rao",     "pin": "4567", "role": "Driver",  "initials": "KR"},
]

CATEGORIES = [
    {"id": "deals",    "name": "Meal Deals",       "color": "#f59e0b", "sort_order": 0},
    {"id": "pizzas",   "name": "Pizzas",            "color": "#ef4444", "sort_order": 1},
    {"id": "sides",    "name": "Sides",             "color": "#f97316", "sort_order": 2},
    {"id": "chicken",  "name": "Chicken",           "color": "#d97706", "sort_order": 3},
    {"id": "burgers",  "name": "Burgers & Wraps",   "color": "#84cc16", "sort_order": 4},
    {"id": "drinks",   "name": "Drinks",            "color": "#3b82f6", "sort_order": 5},
    {"id": "desserts", "name": "Desserts",          "color": "#ec4899", "sort_order": 6},
]

MENU_ITEMS = [
    {"id": "d1", "cat_id": "deals", "name": "Family Feast", "desc": "2 Large Pizzas + 2 Sides + 1.5L Drink", "price": 29.99, "available": True, "is_pizza": False},
    {"id": "d2", "cat_id": "deals", "name": "Duo Deal", "desc": "2 Medium Pizzas + Garlic Bread", "price": 21.99, "available": True, "is_pizza": False},
    {"id": "d3", "cat_id": "deals", "name": "Lunch Special", "desc": "Any Small Pizza + Can", "price": 7.99, "available": True, "is_pizza": False},
    {"id": "d4", "cat_id": "deals", "name": "Big Night In", "desc": "1 Large Pizza + Wings + Wedges + Drink", "price": 24.99, "available": True, "is_pizza": False},

    {"id": "p1", "cat_id": "pizzas", "name": "Margherita", "desc": "Tomato base, mozzarella", "sizes": {"sm": 7.49, "md": 9.99, "lg": 12.99}, "available": True, "is_pizza": True},
    {"id": "p2", "cat_id": "pizzas", "name": "Pepperoni Passion", "desc": "Double pepperoni, extra cheese", "sizes": {"sm": 8.99, "md": 11.49, "lg": 14.49}, "available": True, "is_pizza": True},
    {"id": "p3", "cat_id": "pizzas", "name": "Meat Feast", "desc": "Pepperoni, ham, beef, bacon", "sizes": {"sm": 9.49, "md": 12.49, "lg": 15.49}, "available": True, "is_pizza": True},
    {"id": "p4", "cat_id": "pizzas", "name": "BBQ Chicken Classic", "desc": "BBQ base, chicken, onions, peppers", "sizes": {"sm": 9.49, "md": 12.49, "lg": 15.49}, "available": True, "is_pizza": True},
    {"id": "p5", "cat_id": "pizzas", "name": "Veggie Supreme", "desc": "Mushrooms, onions, peppers, sweetcorn, tomatoes", "sizes": {"sm": 8.49, "md": 10.99, "lg": 13.99}, "available": True, "is_pizza": True},
    {"id": "p6", "cat_id": "pizzas", "name": "Hawaiian", "desc": "Ham & pineapple", "sizes": {"sm": 8.49, "md": 10.99, "lg": 13.99}, "available": True, "is_pizza": True},
    {"id": "p7", "cat_id": "pizzas", "name": "Hot & Spicy", "desc": "Spicy beef, jalapenos, onions", "sizes": {"sm": 8.99, "md": 11.49, "lg": 14.49}, "available": True, "is_pizza": True},
    {"id": "p8", "cat_id": "pizzas", "name": "Tandoori Sizzler", "desc": "Tandoori chicken, peppers, red onions", "sizes": {"sm": 9.49, "md": 12.49, "lg": 15.49}, "available": True, "is_pizza": True},
    {"id": "p9", "cat_id": "pizzas", "name": "Four Cheese", "desc": "Mozzarella, cheddar, blue cheese, parmesan", "sizes": {"sm": 8.99, "md": 11.49, "lg": 14.49}, "available": False, "is_pizza": True},

    {"id": "si1", "cat_id": "sides", "name": "Garlic Bread (4pc)", "price": 3.99, "available": True, "is_pizza": False},
    {"id": "si2", "cat_id": "sides", "name": "Cheesy Garlic Bread", "price": 4.99, "available": True, "is_pizza": False},
    {"id": "si3", "cat_id": "sides", "name": "Potato Wedges", "price": 3.49, "available": True, "is_pizza": False},
    {"id": "si4", "cat_id": "sides", "name": "Onion Rings (8pc)", "price": 3.49, "available": True, "is_pizza": False},
    {"id": "si5", "cat_id": "sides", "name": "Coleslaw", "price": 2.49, "available": True, "is_pizza": False},
    {"id": "si6", "cat_id": "sides", "name": "Fries", "price": 2.99, "available": True, "is_pizza": False},

    {"id": "c1", "cat_id": "chicken", "name": "BBQ Wings (6pc)", "price": 5.49, "available": True, "is_pizza": False},
    {"id": "c2", "cat_id": "chicken", "name": "Hot Wings (6pc)", "price": 5.49, "available": True, "is_pizza": False},
    {"id": "c3", "cat_id": "chicken", "name": "Chicken Strips (5pc)", "price": 5.99, "available": True, "is_pizza": False},
    {"id": "c4", "cat_id": "chicken", "name": "Popcorn Chicken", "price": 4.99, "available": True, "is_pizza": False},

    {"id": "b1", "cat_id": "burgers", "name": "Classic Beef Burger", "price": 6.49, "available": True, "is_pizza": False},
    {"id": "b2", "cat_id": "burgers", "name": "Chicken Fillet Burger", "price": 6.49, "available": True, "is_pizza": False},
    {"id": "b3", "cat_id": "burgers", "name": "Peri Peri Wrap", "price": 5.99, "available": True, "is_pizza": False},
    {"id": "b4", "cat_id": "burgers", "name": "Veggie Burger", "price": 5.99, "available": True, "is_pizza": False},

    {"id": "dr1", "cat_id": "drinks", "name": "Coca-Cola 330ml", "price": 1.29, "available": True, "is_pizza": False},
    {"id": "dr2", "cat_id": "drinks", "name": "Diet Coke 330ml", "price": 1.29, "available": True, "is_pizza": False},
    {"id": "dr3", "cat_id": "drinks", "name": "Fanta 330ml", "price": 1.29, "available": True, "is_pizza": False},
    {"id": "dr4", "cat_id": "drinks", "name": "Coca-Cola 1.5L", "price": 2.99, "available": True, "is_pizza": False},
    {"id": "dr5", "cat_id": "drinks", "name": "Water 500ml", "price": 0.99, "available": True, "is_pizza": False},

    {"id": "de1", "cat_id": "desserts", "name": "Chocolate Fudge Cake", "price": 3.99, "available": True, "is_pizza": False},
    {"id": "de2", "cat_id": "desserts", "name": "Ben & Jerry's 465ml", "price": 5.99, "available": True, "is_pizza": False},
    {"id": "de3", "cat_id": "desserts", "name": "Cookie Dough", "price": 4.49, "available": True, "is_pizza": False},
    {"id": "de4", "cat_id": "desserts", "name": "Cinnamon Bites", "price": 3.99, "available": True, "is_pizza": False},
]

CUSTOMERS = [
    {"id": "cu1", "phone": "+919000111122", "name": "Anika Reddy",     "address": "Road No. 36, Jubilee Hills",       "postcode": "500033", "notes": "Ring doorbell twice", "orders": 23},
    {"id": "cu2", "phone": "+919000222233", "name": "Vivaan Mehta",    "address": "Plot 14, Cyber Towers, Madhapur",  "postcode": "500081", "notes": "",                    "orders": 11},
    {"id": "cu3", "phone": "+919000333344", "name": "Aisha Khan",      "address": "8-2-293/82, Road No. 12, Banjara Hills", "postcode": "500034", "notes": "No contact delivery", "orders": 31},
    {"id": "cu4", "phone": "+919000444455", "name": "Arjun Pillai",    "address": "H.No. 1-7-21, Sardar Patel Road, Begumpet", "postcode": "500016", "notes": "",                    "orders": 5},
    {"id": "cu5", "phone": "+919000555566", "name": "Saanvi Choudhary","address": "Flat 302, Aparna Sarovar, Gachibowli",     "postcode": "500032", "notes": "Allergic to nuts",    "orders": 17},
    {"id": "cu6", "phone": "+919000666677", "name": "Ishaan Kapoor",   "address": "Road No. 12, Banjara Hills",       "postcode": "500034", "notes": "",                    "orders": 9},
]


def _table_seed():
    out = []
    for i in range(12):
        seats = 2 if i < 4 else (4 if i < 9 else 6)
        status = "occupied" if i in (2, 5) else ("reserved" if i == 8 else "available")
        order_id = "o3" if i == 2 else ("o5" if i == 5 else None)
        out.append({
            "id": f"t{i+1}", "number": i + 1, "seats": seats,
            "status": status, "order_id": order_id,
        })
    return out


INVENTORY = [
    {"id": "i1",  "name": "Pizza Dough Balls",  "unit": "pcs",  "stock": 84,   "reorder": 40,  "supplier": "FreshBake Ltd"},
    {"id": "i2",  "name": "Mozzarella Cheese",  "unit": "kg",   "stock": 12.5, "reorder": 8,   "supplier": "DairyDirect"},
    {"id": "i3",  "name": "Tomato Sauce",       "unit": "ltr",  "stock": 18,   "reorder": 10,  "supplier": "ItalFoods"},
    {"id": "i4",  "name": "Pepperoni",          "unit": "kg",   "stock": 4.2,  "reorder": 5,   "supplier": "MeatCo"},
    {"id": "i5",  "name": "Chicken Breast",     "unit": "kg",   "stock": 9,    "reorder": 6,   "supplier": "MeatCo"},
    {"id": "i6",  "name": "Mushrooms",          "unit": "kg",   "stock": 3.1,  "reorder": 3,   "supplier": "GreenGrocer"},
    {"id": "i7",  "name": "Pizza Boxes 12\"",  "unit": "pcs",  "stock": 220,  "reorder": 100, "supplier": "PackRight"},
    {"id": "i8",  "name": "Pizza Boxes 15\"",  "unit": "pcs",  "stock": 64,   "reorder": 80,  "supplier": "PackRight"},
    {"id": "i9",  "name": "Coca-Cola 330ml",    "unit": "cans", "stock": 96,   "reorder": 48,  "supplier": "DrinksWholesale"},
    {"id": "i10", "name": "Burger Buns",        "unit": "pcs",  "stock": 38,   "reorder": 30,  "supplier": "FreshBake Ltd"},
    {"id": "i11", "name": "Potato Wedges",      "unit": "kg",   "stock": 14,   "reorder": 8,   "supplier": "FrozenFoods"},
    {"id": "i12", "name": "Jalapenos",          "unit": "kg",   "stock": 1.4,  "reorder": 2,   "supplier": "ItalFoods"},
]


def _orders_seed():
    now = datetime.now(timezone.utc)
    def mins_ago(m): return (now - timedelta(minutes=m)).isoformat()
    def days_ago(d, h=12, m=0): return (now - timedelta(days=d, hours=now.hour - h, minutes=now.minute - m)).isoformat()
    cust = {c["id"]: c for c in CUSTOMERS}
    def oc(c):
        return {"id": c["id"], "name": c["name"], "phone": c["phone"], "address": c.get("address"), "postcode": c.get("postcode")}

    historic = []
    # 6 days of historic completed orders to populate weekly chart
    day_specs = [
        (6, [(28.5, "card", "delivery"), (15.99, "cash", "collection"), (42.0, "card", "delivery")]),
        (5, [(19.49, "cash", "collection"), (22.99, "card", "delivery")]),
        (4, [(31.99, "card", "delivery"), (12.49, "cash", "collection"), (17.99, "card", "dine-in"), (24.5, "card", "delivery")]),
        (3, [(14.99, "cash", "collection"), (27.49, "card", "delivery")]),
        (2, [(33.99, "card", "delivery"), (18.49, "cash", "collection"), (21.99, "card", "delivery"), (29.99, "card", "delivery"), (16.49, "cash", "collection")]),
        (1, [(38.49, "card", "delivery"), (22.99, "card", "delivery"), (19.99, "cash", "collection"), (44.5, "card", "delivery"), (15.49, "cash", "collection"), (28.99, "card", "delivery")]),
    ]
    base_num = 1000
    seed_items_pool = [
        [{"name": 'Pepperoni Passion 12"', "qty": 1, "price": 11.49, "mods": []}, {"name": "Fries", "qty": 1, "price": 2.99, "mods": []}],
        [{"name": "Meat Feast 15\"", "qty": 1, "price": 15.49, "mods": ["+ Jalapenos"]}, {"name": "BBQ Wings (6pc)", "qty": 1, "price": 5.49, "mods": []}],
        [{"name": "Family Feast", "qty": 1, "price": 29.99, "mods": []}],
        [{"name": "Margherita 12\"", "qty": 1, "price": 9.99, "mods": []}, {"name": "Coca-Cola 1.5L", "qty": 1, "price": 2.99, "mods": []}],
        [{"name": "Duo Deal", "qty": 1, "price": 21.99, "mods": []}],
        [{"name": "BBQ Chicken Classic 15\"", "qty": 1, "price": 15.49, "mods": []}, {"name": "Garlic Bread (4pc)", "qty": 1, "price": 3.99, "mods": []}],
        [{"name": "Hawaiian 12\"", "qty": 1, "price": 10.99, "mods": []}, {"name": "Chocolate Fudge Cake", "qty": 1, "price": 3.99, "mods": []}],
    ]
    for days, rows in day_specs:
        for idx, (total, pay, otype) in enumerate(rows):
            base_num += 1
            ts = (now - timedelta(days=days, hours=2 + idx)).isoformat()
            historic.append({
                "id": f"oh_{days}_{idx}", "number": base_num, "type": otype, "status": "completed",
                "customer": {"name": f"Walk-in — Hist {days}d", "phone": ""}, "table": None,
                "placedAt": ts, "payment": pay, "driver": None,
                "items": seed_items_pool[(days + idx) % len(seed_items_pool)],
                "deliveryFee": 2.5 if otype == "delivery" else 0, "discount": 0, "total": total,
            })

    today = [
        {"id": "o1", "number": 1042, "type": "delivery", "status": "out-for-delivery", "customer": oc(cust["cu3"]), "table": None,
         "placedAt": mins_ago(38), "payment": "card", "driver": "Karthik Rao",
         "items": [{"name": 'Meat Feast 15"', "qty": 1, "price": 15.49, "mods": ["+ Jalapenos"]},
                   {"name": "BBQ Wings (6pc)", "qty": 1, "price": 5.49, "mods": []},
                   {"name": "Coca-Cola 1.5L", "qty": 1, "price": 2.99, "mods": []}],
         "deliveryFee": 2.5, "discount": 0, "total": 26.47},
        {"id": "o2", "number": 1043, "type": "collection", "status": "ready",
         "customer": {"name": "Walk-in — Vikram", "phone": "+919000711122"}, "table": None,
         "placedAt": mins_ago(22), "payment": "cash",
         "items": [{"name": 'Pepperoni Passion 12"', "qty": 1, "price": 11.49, "mods": []},
                   {"name": "Fries", "qty": 1, "price": 2.99, "mods": []}],
         "deliveryFee": 0, "discount": 0, "total": 14.48},
        {"id": "o3", "number": 1044, "type": "dine-in", "status": "in-kitchen",
         "customer": {"name": "Table 3"}, "table": 3,
         "placedAt": mins_ago(15), "payment": "unpaid",
         "items": [{"name": 'Hawaiian 12"', "qty": 1, "price": 10.99, "mods": []},
                   {"name": "Veggie Burger", "qty": 1, "price": 5.99, "mods": []},
                   {"name": "Diet Coke 330ml", "qty": 2, "price": 1.29, "mods": []}],
         "deliveryFee": 0, "discount": 0, "total": 19.56},
        {"id": "o4", "number": 1045, "type": "delivery", "status": "in-kitchen", "customer": oc(cust["cu1"]), "table": None,
         "placedAt": mins_ago(9), "payment": "card",
         "items": [{"name": "Family Feast", "qty": 1, "price": 29.99, "mods": ["Large: BBQ Chicken Classic", "Large: Veggie Supreme"]}],
         "deliveryFee": 2.5, "discount": 0, "total": 32.49},
        {"id": "o5", "number": 1046, "type": "dine-in", "status": "new",
         "customer": {"name": "Table 6"}, "table": 6,
         "placedAt": mins_ago(4), "payment": "unpaid",
         "items": [{"name": 'Hot & Spicy 9.5"', "qty": 2, "price": 8.99, "mods": []}],
         "deliveryFee": 0, "discount": 0, "total": 17.98},
        {"id": "o6", "number": 1041, "type": "collection", "status": "completed",
         "customer": {"name": "Walk-in — Neha", "phone": "+919000711133"}, "table": None,
         "placedAt": mins_ago(95), "payment": "cash",
         "items": [{"name": "Duo Deal", "qty": 1, "price": 21.99, "mods": []}],
         "deliveryFee": 0, "discount": 2.2, "total": 19.79},
        {"id": "o7", "number": 1040, "type": "delivery", "status": "completed", "customer": oc(cust["cu5"]), "table": None,
         "placedAt": mins_ago(130), "payment": "card",
         "items": [{"name": 'Margherita 12"', "qty": 1, "price": 9.99, "mods": ["+ Extra Cheese"]},
                   {"name": "Chocolate Fudge Cake", "qty": 1, "price": 3.99, "mods": []}],
         "deliveryFee": 2.5, "discount": 0, "total": 17.68},
    ]
    return historic + today


async def seed_all(db):
    from tenants import seed_default_tenant, DEMO_TENANT
    await seed_default_tenant(db)
    tid = DEMO_TENANT["id"]

    # users
    if await db.users.count_documents({"tenant_id": tid}) == 0:
        docs = []
        for s in STAFF:
            docs.append({
                "id": s["id"], "tenant_id": tid,
                "name": s["name"], "role": s["role"], "initials": s["initials"],
                "pin_hash": hash_pin(s["pin"]),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        await db.users.insert_many(docs)

    if await db.categories.count_documents({"tenant_id": tid}) == 0:
        await db.categories.insert_many([{**c, "tenant_id": tid} for c in CATEGORIES])

    if await db.menu_items.count_documents({"tenant_id": tid}) == 0:
        await db.menu_items.insert_many([{**m, "tenant_id": tid} for m in MENU_ITEMS])

    if await db.customers.count_documents({"tenant_id": tid}) == 0:
        await db.customers.insert_many([{**c, "tenant_id": tid} for c in CUSTOMERS])

    if await db.tables.count_documents({"tenant_id": tid}) == 0:
        await db.tables.insert_many([{**t, "tenant_id": tid} for t in _table_seed()])

    if await db.inventory.count_documents({"tenant_id": tid}) == 0:
        await db.inventory.insert_many([{**i, "tenant_id": tid} for i in INVENTORY])

    if await db.orders.count_documents({"tenant_id": tid}) == 0:
        await db.orders.insert_many([{**o, "tenant_id": tid} for o in _orders_seed()])

    counter_key = f"{tid}:order_number"
    # Initial seed
    if await db.counters.count_documents({"_id": counter_key}) == 0:
        await db.counters.insert_one({"_id": counter_key, "seq": 1046})
    # Reconcile: if real orders exist with higher numbers (e.g. legacy single-tenant
    # rows backfilled in), bump the counter so new orders don't collide.
    max_doc = await db.orders.find({"tenant_id": tid}, {"number": 1, "_id": 0}).sort("number", -1).limit(1).to_list(1)
    if max_doc:
        max_num = max_doc[0]["number"]
        await db.counters.update_one(
            {"_id": counter_key, "seq": {"$lt": max_num}},
            {"$set": {"seq": max_num}},
        )

    # Indexes — drop legacy single-field unique indexes (pre multi-tenancy) once,
    # then create compound (tenant_id, id|number) unique indexes.
    for coll_name, single_idx in [
        ("users", "id_1"), ("menu_items", "id_1"), ("categories", "id_1"),
        ("customers", "id_1"), ("tables", "id_1"), ("tables", "number_1"),
        ("inventory", "id_1"), ("orders", "id_1"), ("orders", "number_1"),
    ]:
        try:
            await db[coll_name].drop_index(single_idx)
        except Exception:
            pass

    await db.tenants.create_index("slug", unique=True)
    await db.users.create_index([("tenant_id", 1), ("id", 1)], unique=True)
    await db.menu_items.create_index([("tenant_id", 1), ("id", 1)], unique=True)
    await db.categories.create_index([("tenant_id", 1), ("id", 1)], unique=True)
    await db.customers.create_index([("tenant_id", 1), ("id", 1)], unique=True)
    await db.customers.create_index([("tenant_id", 1), ("phone", 1)])
    await db.tables.create_index([("tenant_id", 1), ("id", 1)], unique=True)
    await db.tables.create_index([("tenant_id", 1), ("number", 1)], unique=True)
    await db.inventory.create_index([("tenant_id", 1), ("id", 1)], unique=True)
    await db.orders.create_index([("tenant_id", 1), ("id", 1)], unique=True)
    await db.orders.create_index([("tenant_id", 1), ("number", 1)], unique=True)
    # For /reports/summary's rolling 7-day window (uses ISO-string $gte filter).
    await db.orders.create_index([("tenant_id", 1), ("placedAt", -1)])

    # Staff ops collections (added 2026-02-25).
    await db.time_punches.create_index([("tenant_id", 1), ("user_id", 1), ("at", -1)])
    await db.time_punches.create_index([("tenant_id", 1), ("at", -1)])
    await db.shifts.create_index([("tenant_id", 1), ("start", 1)])
    await db.shifts.create_index([("tenant_id", 1), ("user_id", 1), ("start", 1)])
    await db.waste_entries.create_index([("tenant_id", 1), ("at", -1)])
    await db.cash_drawers.create_index([("tenant_id", 1), ("status", 1)])
    await db.cash_drawers.create_index([("tenant_id", 1), ("opened_at", -1)])
    await db.tip_pools.create_index([("tenant_id", 1), ("shift_date", -1)])
    await db.coupons.create_index([("tenant_id", 1), ("code", 1)], unique=True)
    await db.locations.create_index([("tenant_id", 1), ("id", 1)], unique=True)
    await db.refund_logs.create_index([("tenant_id", 1), ("at", -1)])
    await db.loyalty_txns.create_index([("tenant_id", 1), ("customer_id", 1), ("at", -1)])
    await db.report_rollups.create_index([("tenant_id", 1), ("date", 1)], unique=True)
    await db.dashboard_users.create_index("email", unique=True)
    await db.dashboard_users.create_index([("tenant_id", 1), ("dash_role", 1)])

    # Seed the 3 demo dashboard accounts (owner / manager / area_manager).
    from routes.dash_auth import ensure_demo_dashboard_users
    await ensure_demo_dashboard_users(db)

    # Backfill existing seed users with the new HR fields so the Staff
    # screen renders correctly on the first paint.
    await db.users.update_many(
        {"tenant_id": tid, "active": {"$exists": False}},
        {"$set": {"active": True, "hourly_rate": 0.0, "phone": ""}},
    )
