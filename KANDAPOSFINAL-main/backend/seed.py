"""Seed Kanda POS Mongo with mock data on first boot. Idempotent."""
from datetime import datetime, timezone, timedelta
from tz import now_ist
from auth import hash_pin


STAFF = [
    {"id": "s1",  "name": "Aarav Reddy",     "pin": "1234", "role": "Manager", "initials": "AR"},
    {"id": "s2",  "name": "Priya Iyer",      "pin": "2345", "role": "Cashier", "initials": "PI"},
    {"id": "s3",  "name": "Rohan Sharma",    "pin": "3456", "role": "Cashier", "initials": "RS"},
    {"id": "s7",  "name": "Ananya Gupta",    "pin": "7890", "role": "Cashier", "initials": "AG"},
    {"id": "s8",  "name": "Rahul Verma",     "pin": "8901", "role": "Cashier", "initials": "RV"},
    {"id": "s5",  "name": "Meera Nair",      "pin": "5678", "role": "Kitchen", "initials": "MN"},
    {"id": "s6",  "name": "Vikram Desai",    "pin": "6789", "role": "Kitchen", "initials": "VD"},
    {"id": "s4",  "name": "Karthik Rao",     "pin": "4567", "role": "Driver",  "initials": "KR"},
    {"id": "s9",  "name": "Sanjay Kumar",    "pin": "9012", "role": "Driver",  "initials": "SK"},
    {"id": "s10", "name": "Divya Menon",     "pin": "1235", "role": "Driver",  "initials": "DM"},
    {"id": "s11", "name": "Arjun Nair",      "pin": "1236", "role": "Driver",  "initials": "AN"},
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

_IMG = {
    "pizza_a": "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=500&q=80",
    "pizza_b": "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=500&q=80",
    "pizza_c": "https://images.unsplash.com/photo-1571066811602-716837d681de?w=500&q=80",
    "feast": "https://images.unsplash.com/photo-1600891964599-f61ba0e24092?w=500&q=80",
    "fries": "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=500&q=80",
    "side_b": "https://images.unsplash.com/photo-1550547660-d9450f859349?w=500&q=80",
    "wings": "https://images.unsplash.com/photo-1608039755401-742074f0548d?w=500&q=80",
    "burger": "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500&q=80",
    "wrap": "https://images.unsplash.com/photo-1611270629569-8b357cb88da9?w=500&q=80",
    "drink": "https://images.unsplash.com/photo-1554866585-cd94860890b7?w=500&q=80",
    "dessert": "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=500&q=80",
}

MENU_ITEMS = [
    {"id": "d1", "cat_id": "deals", "name": "Family Feast", "desc": "2 Large Pizzas + 2 Sides + 1.5L Drink", "price": 899, "available": True, "is_pizza": False, "image_url": _IMG["feast"],
     "deal_groups": [
         {"cat_id": "pizzas", "label": "Choose 2 Large Pizzas", "count": 2, "size": "lg"},
         {"cat_id": "sides", "label": "Choose 2 Sides", "count": 2},
         {"cat_id": "drinks", "label": "Choose a Drink", "count": 1},
     ]},
    {"id": "d2", "cat_id": "deals", "name": "Duo Deal", "desc": "2 Medium Pizzas + a Side", "price": 649, "available": True, "is_pizza": False, "image_url": _IMG["pizza_a"],
     "deal_groups": [
         {"cat_id": "pizzas", "label": "Choose 2 Medium Pizzas", "count": 2, "size": "md"},
         {"cat_id": "sides", "label": "Choose a Side", "count": 1},
     ]},
    {"id": "d3", "cat_id": "deals", "name": "Lunch Special", "desc": "Any Small Pizza + a Drink", "price": 199, "available": True, "is_pizza": False, "image_url": _IMG["pizza_b"],
     "deal_groups": [
         {"cat_id": "pizzas", "label": "Choose a Small Pizza", "count": 1, "size": "sm"},
         {"cat_id": "drinks", "label": "Choose a Drink", "count": 1},
     ]},
    {"id": "d4", "cat_id": "deals", "name": "Big Night In", "desc": "1 Large Pizza + Chicken + a Side + a Drink", "price": 749, "available": True, "is_pizza": False, "image_url": _IMG["pizza_c"],
     "deal_groups": [
         {"cat_id": "pizzas", "label": "Choose a Large Pizza", "count": 1, "size": "lg"},
         {"cat_id": "chicken", "label": "Choose Chicken", "count": 1},
         {"cat_id": "sides", "label": "Choose a Side", "count": 1},
         {"cat_id": "drinks", "label": "Choose a Drink", "count": 1},
     ]},

    {"id": "p1", "cat_id": "pizzas", "name": "Margherita", "desc": "Tomato base, mozzarella", "sizes": {"sm": 199, "md": 349, "lg": 499}, "available": True, "is_pizza": True, "image_url": _IMG["pizza_a"]},
    {"id": "p2", "cat_id": "pizzas", "name": "Pepperoni Passion", "desc": "Double pepperoni, extra cheese", "sizes": {"sm": 249, "md": 399, "lg": 599}, "available": True, "is_pizza": True, "image_url": _IMG["pizza_b"]},
    {"id": "p3", "cat_id": "pizzas", "name": "Non-Veg Supreme", "desc": "Chicken tikka, chicken sausage, keema, extra cheese", "sizes": {"sm": 299, "md": 449, "lg": 649}, "available": True, "is_pizza": True, "image_url": _IMG["pizza_c"]},
    {"id": "p4", "cat_id": "pizzas", "name": "BBQ Chicken Classic", "desc": "BBQ base, chicken, onions, peppers", "sizes": {"sm": 279, "md": 429, "lg": 629}, "available": True, "is_pizza": True, "image_url": _IMG["pizza_a"]},
    {"id": "p5", "cat_id": "pizzas", "name": "Veggie Supreme", "desc": "Mushrooms, onions, peppers, sweetcorn, tomatoes", "sizes": {"sm": 229, "md": 379, "lg": 549}, "available": True, "is_pizza": True, "image_url": _IMG["pizza_b"]},
    {"id": "p6", "cat_id": "pizzas", "name": "Tropical Chicken", "desc": "Chicken & pineapple", "sizes": {"sm": 229, "md": 379, "lg": 549}, "available": True, "is_pizza": True, "image_url": _IMG["pizza_c"]},
    {"id": "p7", "cat_id": "pizzas", "name": "Hot & Spicy", "desc": "Spicy chicken, jalapenos, onions", "sizes": {"sm": 259, "md": 409, "lg": 599}, "available": True, "is_pizza": True, "image_url": _IMG["pizza_a"]},
    {"id": "p8", "cat_id": "pizzas", "name": "Tandoori Sizzler", "desc": "Tandoori chicken, peppers, red onions", "sizes": {"sm": 279, "md": 429, "lg": 629}, "available": True, "is_pizza": True, "image_url": _IMG["pizza_b"]},
    {"id": "p9", "cat_id": "pizzas", "name": "Four Cheese", "desc": "Mozzarella, cheddar, blue cheese, parmesan", "sizes": {"sm": 259, "md": 409, "lg": 599}, "available": False, "is_pizza": True, "image_url": _IMG["pizza_c"]},

    {"id": "si1", "cat_id": "sides", "name": "Garlic Bread (4pc)", "price": 129, "available": True, "is_pizza": False, "image_url": _IMG["side_b"]},
    {"id": "si2", "cat_id": "sides", "name": "Cheesy Garlic Bread", "price": 169, "available": True, "is_pizza": False, "image_url": _IMG["side_b"]},
    {"id": "si3", "cat_id": "sides", "name": "Potato Wedges", "price": 119, "available": True, "is_pizza": False, "image_url": _IMG["fries"]},
    {"id": "si4", "cat_id": "sides", "name": "Onion Rings (8pc)", "price": 129, "available": True, "is_pizza": False, "image_url": _IMG["fries"]},
    {"id": "si5", "cat_id": "sides", "name": "Coleslaw", "price": 89, "available": True, "is_pizza": False, "image_url": _IMG["side_b"]},
    {"id": "si6", "cat_id": "sides", "name": "Fries", "price": 99, "available": True, "is_pizza": False, "image_url": _IMG["fries"]},

    {"id": "c1", "cat_id": "chicken", "name": "BBQ Wings (6pc)", "price": 199, "available": True, "is_pizza": False, "image_url": _IMG["wings"]},
    {"id": "c2", "cat_id": "chicken", "name": "Hot Wings (6pc)", "price": 199, "available": True, "is_pizza": False, "image_url": _IMG["wings"]},
    {"id": "c3", "cat_id": "chicken", "name": "Chicken Strips (5pc)", "price": 219, "available": True, "is_pizza": False, "image_url": _IMG["wings"]},
    {"id": "c4", "cat_id": "chicken", "name": "Popcorn Chicken", "price": 179, "available": True, "is_pizza": False, "image_url": _IMG["wings"]},

    {"id": "b1", "cat_id": "burgers", "name": "Classic Chicken Burger", "price": 169, "available": True, "is_pizza": False, "image_url": _IMG["burger"]},
    {"id": "b2", "cat_id": "burgers", "name": "Chicken Fillet Burger", "price": 169, "available": True, "is_pizza": False, "image_url": _IMG["burger"]},
    {"id": "b3", "cat_id": "burgers", "name": "Peri Peri Wrap", "price": 159, "available": True, "is_pizza": False, "image_url": _IMG["wrap"]},
    {"id": "b4", "cat_id": "burgers", "name": "Aloo Tikki Burger", "price": 149, "available": True, "is_pizza": False, "image_url": _IMG["burger"]},

    {"id": "dr1", "cat_id": "drinks", "name": "Coca-Cola 330ml", "price": 60, "available": True, "is_pizza": False, "image_url": _IMG["drink"]},
    {"id": "dr2", "cat_id": "drinks", "name": "Coke Zero 330ml", "price": 60, "available": True, "is_pizza": False, "image_url": _IMG["drink"]},
    {"id": "dr3", "cat_id": "drinks", "name": "Fanta 330ml", "price": 60, "available": True, "is_pizza": False, "image_url": _IMG["drink"]},
    {"id": "dr4", "cat_id": "drinks", "name": "Coca-Cola 1.5L", "price": 99, "available": True, "is_pizza": False, "image_url": _IMG["drink"]},
    {"id": "dr5", "cat_id": "drinks", "name": "Water 500ml", "price": 20, "available": True, "is_pizza": False, "image_url": None},

    {"id": "de1", "cat_id": "desserts", "name": "Chocolate Fudge Cake", "price": 149, "available": True, "is_pizza": False, "image_url": _IMG["dessert"]},
    {"id": "de2", "cat_id": "desserts", "name": "Choco Lava Cake", "price": 99, "available": True, "is_pizza": False, "image_url": _IMG["dessert"]},
    {"id": "de3", "cat_id": "desserts", "name": "Choco Chip Cookie", "price": 129, "available": True, "is_pizza": False, "image_url": _IMG["dessert"]},
    {"id": "de4", "cat_id": "desserts", "name": "Cinnamon Bites", "price": 99, "available": True, "is_pizza": False, "image_url": _IMG["dessert"]},
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
    {"id": "i1",  "name": "Pizza Dough Balls",  "unit": "pcs",  "stock": 84,   "reorder": 40,  "supplier": "FreshBake Ltd",       "cost_per_unit": 18},
    {"id": "i2",  "name": "Mozzarella Cheese",  "unit": "kg",   "stock": 12.5, "reorder": 8,   "supplier": "DairyDirect",         "cost_per_unit": 420},
    {"id": "i3",  "name": "Tomato Sauce",       "unit": "ltr",  "stock": 18,   "reorder": 10,  "supplier": "ItalFoods",           "cost_per_unit": 160},
    {"id": "i4",  "name": "Pepperoni",          "unit": "kg",   "stock": 4.2,  "reorder": 5,   "supplier": "MeatCo",              "cost_per_unit": 650},
    {"id": "i5",  "name": "Chicken Breast",     "unit": "kg",   "stock": 9,    "reorder": 6,   "supplier": "MeatCo",              "cost_per_unit": 280},
    {"id": "i6",  "name": "Mushrooms",          "unit": "kg",   "stock": 3.1,  "reorder": 3,   "supplier": "GreenGrocer",         "cost_per_unit": 120},
    {"id": "i7",  "name": "Pizza Boxes 12\"",  "unit": "pcs",  "stock": 220,  "reorder": 100, "supplier": "PackRight",           "cost_per_unit": 14},
    {"id": "i8",  "name": "Pizza Boxes 15\"",  "unit": "pcs",  "stock": 64,   "reorder": 80,  "supplier": "PackRight",           "cost_per_unit": 18},
    {"id": "i9",  "name": "Coca-Cola 330ml",    "unit": "cans", "stock": 96,   "reorder": 48,  "supplier": "DrinksWholesale",     "cost_per_unit": 35},
    {"id": "i10", "name": "Burger Buns",        "unit": "pcs",  "stock": 38,   "reorder": 30,  "supplier": "FreshBake Ltd",       "cost_per_unit": 12},
    {"id": "i11", "name": "Potato Wedges",      "unit": "kg",   "stock": 14,   "reorder": 8,   "supplier": "FrozenFoods",         "cost_per_unit": 140},
    {"id": "i12", "name": "Jalapenos",          "unit": "kg",   "stock": 1.4,  "reorder": 2,   "supplier": "ItalFoods",           "cost_per_unit": 220},
]

SUPPLIERS = [
    {"id": "sup1", "name": "FreshBake Ltd",     "email": "orders@freshbake.example.com",     "phone": "+914023456701"},
    {"id": "sup2", "name": "DairyDirect",       "email": "orders@dairydirect.example.com",   "phone": "+914023456702"},
    {"id": "sup3", "name": "ItalFoods",         "email": "orders@italfoods.example.com",     "phone": "+914023456703"},
    {"id": "sup4", "name": "MeatCo",            "email": "orders@meatco.example.com",        "phone": "+914023456704"},
    {"id": "sup5", "name": "GreenGrocer",       "email": "orders@greengrocer.example.com",   "phone": "+914023456705"},
    {"id": "sup6", "name": "PackRight",         "email": "orders@packright.example.com",     "phone": "+914023456706"},
    {"id": "sup7", "name": "DrinksWholesale",   "email": "orders@drinkswholesale.example.com", "phone": "+914023456707"},
    {"id": "sup8", "name": "FrozenFoods",       "email": "orders@frozenfoods.example.com",   "phone": "+914023456708"},
]


def _orders_seed():
    now = now_ist()
    def mins_ago(m): return (now - timedelta(minutes=m)).isoformat()
    def days_ago(d, h=12, m=0): return (now - timedelta(days=d, hours=now.hour - h, minutes=now.minute - m)).isoformat()
    cust = {c["id"]: c for c in CUSTOMERS}
    def oc(c):
        return {"id": c["id"], "name": c["name"], "phone": c["phone"], "address": c.get("address"), "postcode": c.get("postcode")}

    historic = []
    # 6 days of historic completed orders to populate weekly chart
    day_specs = [
        (6, [(570, "card", "delivery"), (320, "cash", "collection"), (840, "card", "delivery")]),
        (5, [(390, "cash", "collection"), (460, "card", "delivery")]),
        (4, [(640, "card", "delivery"), (250, "cash", "collection"), (360, "card", "dine-in"), (490, "card", "delivery")]),
        (3, [(300, "cash", "collection"), (550, "card", "delivery")]),
        (2, [(680, "card", "delivery"), (370, "cash", "collection"), (440, "card", "delivery"), (600, "card", "delivery"), (330, "cash", "collection")]),
        (1, [(770, "card", "delivery"), (460, "card", "delivery"), (400, "cash", "collection"), (890, "card", "delivery"), (310, "cash", "collection"), (580, "card", "delivery")]),
    ]
    base_num = 1000
    seed_items_pool = [
        [{"name": 'Pepperoni Passion 12"', "qty": 1, "price": 399, "mods": []}, {"name": "Fries", "qty": 1, "price": 99, "mods": []}],
        [{"name": 'Non-Veg Supreme 15"', "qty": 1, "price": 649, "mods": ["+ Jalapenos"]}, {"name": "BBQ Wings (6pc)", "qty": 1, "price": 199, "mods": []}],
        [{"name": "Family Feast", "qty": 1, "price": 899, "mods": []}],
        [{"name": 'Margherita 12"', "qty": 1, "price": 349, "mods": []}, {"name": "Coca-Cola 1.5L", "qty": 1, "price": 99, "mods": []}],
        [{"name": "Duo Deal", "qty": 1, "price": 649, "mods": []}],
        [{"name": 'BBQ Chicken Classic 15"', "qty": 1, "price": 629, "mods": []}, {"name": "Garlic Bread (4pc)", "qty": 1, "price": 129, "mods": []}],
        [{"name": 'Tropical Chicken 12"', "qty": 1, "price": 379, "mods": []}, {"name": "Chocolate Fudge Cake", "qty": 1, "price": 149, "mods": []}],
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
                "deliveryFee": 49 if otype == "delivery" else 0, "discount": 0, "total": total,
            })

    today = [
        {"id": "o1", "number": 1042, "type": "delivery", "status": "out-for-delivery", "customer": oc(cust["cu3"]), "table": None,
         "placedAt": mins_ago(38), "payment": "card", "driver": "Karthik Rao",
         "items": [{"name": 'Non-Veg Supreme 15"', "qty": 1, "price": 649, "mods": ["+ Jalapenos"]},
                   {"name": "BBQ Wings (6pc)", "qty": 1, "price": 199, "mods": []},
                   {"name": "Coca-Cola 1.5L", "qty": 1, "price": 99, "mods": []}],
         "deliveryFee": 49, "discount": 0, "total": 996},
        {"id": "o2", "number": 1043, "type": "collection", "status": "ready",
         "customer": {"name": "Walk-in — Vikram", "phone": "+919000711122"}, "table": None,
         "placedAt": mins_ago(22), "payment": "cash",
         "items": [{"name": 'Pepperoni Passion 12"', "qty": 1, "price": 399, "mods": []},
                   {"name": "Fries", "qty": 1, "price": 99, "mods": []}],
         "deliveryFee": 0, "discount": 0, "total": 498},
        {"id": "o3", "number": 1044, "type": "dine-in", "status": "in-kitchen",
         "customer": {"name": "Table 3"}, "table": 3,
         "placedAt": mins_ago(15), "payment": "unpaid",
         "items": [{"name": 'Tropical Chicken 12"', "qty": 1, "price": 379, "mods": []},
                   {"name": "Aloo Tikki Burger", "qty": 1, "price": 149, "mods": []},
                   {"name": "Coke Zero 330ml", "qty": 2, "price": 60, "mods": []}],
         "deliveryFee": 0, "discount": 0, "total": 648},
        {"id": "o4", "number": 1045, "type": "delivery", "status": "in-kitchen", "customer": oc(cust["cu1"]), "table": None,
         "placedAt": mins_ago(9), "payment": "card",
         "items": [{"name": "Family Feast", "qty": 1, "price": 899, "mods": ["Large: BBQ Chicken Classic", "Large: Veggie Supreme"]}],
         "deliveryFee": 49, "discount": 0, "total": 948},
        {"id": "o5", "number": 1046, "type": "dine-in", "status": "new",
         "customer": {"name": "Table 6"}, "table": 6,
         "placedAt": mins_ago(4), "payment": "unpaid",
         "items": [{"name": 'Hot & Spicy 9.5"', "qty": 2, "price": 259, "mods": []}],
         "deliveryFee": 0, "discount": 0, "total": 518},
        {"id": "o6", "number": 1041, "type": "collection", "status": "completed",
         "customer": {"name": "Walk-in — Neha", "phone": "+919000711133"}, "table": None,
         "placedAt": mins_ago(95), "payment": "cash",
         "items": [{"name": "Duo Deal", "qty": 1, "price": 649, "mods": []}],
         "deliveryFee": 0, "discount": 65, "total": 584},
        {"id": "o7", "number": 1040, "type": "delivery", "status": "completed", "customer": oc(cust["cu5"]), "table": None,
         "placedAt": mins_ago(130), "payment": "card",
         "items": [{"name": 'Margherita 12"', "qty": 1, "price": 349, "mods": ["+ Extra Cheese"]},
                   {"name": "Chocolate Fudge Cake", "qty": 1, "price": 149, "mods": []}],
         "deliveryFee": 49, "discount": 0, "total": 547},
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
                "created_at": now_ist().isoformat(),
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

    if await db.suppliers.count_documents({"tenant_id": tid}) == 0:
        await db.suppliers.insert_many([{**s, "tenant_id": tid} for s in SUPPLIERS])

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
    await db.pos_devices.create_index("token_hash", unique=True)
    await db.pos_devices.create_index([("tenant_id", 1), ("revoked_at", 1)])
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
    # Idempotency key for offline-queued order creation (see routes/orders.py
    # create_order) — a retried POST with the same client_ref must resolve to
    # the same order, never a duplicate. Partial so normal online orders
    # (client_ref: null) don't collide with each other.
    await db.orders.create_index(
        [("tenant_id", 1), ("client_ref", 1)], unique=True,
        partialFilterExpression={"client_ref": {"$type": "string"}},
    )

    # updated_at indexes for offline-sync clients pulling incremental deltas
    # (?since=<ISO8601>) instead of a full collection fetch every time.
    for coll_name in ("menu_items", "categories", "inventory", "customers", "menu_schedules", "tables"):
        await db[coll_name].create_index([("tenant_id", 1), ("updated_at", 1)])

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
    await db.suppliers.create_index([("tenant_id", 1), ("id", 1)], unique=True)

    # Seed the 3 demo dashboard accounts (owner / manager / area_manager).
    from routes.dash_auth import ensure_demo_dashboard_users
    await ensure_demo_dashboard_users(db)

    # Backfill existing seed users with the new HR fields so the Staff
    # screen renders correctly on the first paint.
    await db.users.update_many(
        {"tenant_id": tid, "active": {"$exists": False}},
        {"$set": {"active": True, "hourly_rate": 0.0, "phone": ""}},
    )

    # Backfill GST auto-suggestion onto any category created before the tax
    # feature existed, across every tenant (not just the demo one above).
    # Price-banded categories (e.g. apparel) are deliberately left unset so
    # each item's own price re-derives the rate at order time instead of
    # freezing the whole category to one rate — see tax.is_price_banded.
    from tax import suggest_tax_rate, is_price_banded
    business_type_by_tenant = {
        t["id"]: t.get("business_type", "restaurant")
        async for t in db.tenants.find({}, {"_id": 0, "id": 1, "business_type": 1})
    }
    async for cat in db.categories.find({"tax_rate": {"$exists": False}}, {"_id": 0, "id": 1, "tenant_id": 1, "name": 1}):
        business_type = business_type_by_tenant.get(cat["tenant_id"], "restaurant")
        if is_price_banded(cat["name"], business_type):
            continue
        rate = suggest_tax_rate(cat["name"], business_type)
        await db.categories.update_one({"tenant_id": cat["tenant_id"], "id": cat["id"]}, {"$set": {"tax_rate": rate}})
