# Andromeda POS — API Contracts & Integration Plan

Backend: FastAPI + MongoDB (motor). All routes prefixed with `/api`.
Auth: JWT Bearer token (HS256) from PIN-based login. Token sent as `Authorization: Bearer <token>` header.

---

## 1. Mock Data → Mongo Mapping

| Frontend (`mock.js`) | Mongo Collection | Notes |
|---|---|---|
| `STAFF`        | `users`      | `pin` becomes `pin_hash` (bcrypt). Stable id `s1..s4`. |
| `CATEGORIES`   | `categories` | Stable ids `deals,pizzas,...` |
| `MENU_ITEMS`   | `menu_items` | Stable ids `p1,d1,si1,...`. `sizes` map for pizzas. |
| `CUSTOMERS`    | `customers`  | Stable ids `cu1..cu6`. |
| `TABLES`       | `tables`     | 12 tables, ids `t1..t12`. |
| `INVENTORY`    | `inventory`  | Stable ids `i1..i12`. |
| `ORDERS`       | `orders`     | Seed 7 sample orders `o1..o7`. |
| n/a            | `counters`   | `{_id:"order_number", seq:1047}` for incrementing order #. |

Seed runs on FastAPI startup. Idempotent: if a collection is empty it gets seeded.

---

## 2. Auth Endpoints (`/api/auth`)

- `POST /api/auth/login` — body `{pin: "1234"}` → `{token, user}` (sets `Authorization` for future calls). 401 on invalid PIN.
- `GET  /api/auth/me`    — header `Authorization: Bearer <token>` → returns current user object.

Bcrypt hash for PIN. JWT payload: `{sub: user_id, role, exp}`. Access token TTL 12h (POS shift length).

---

## 3. Resource Endpoints (all require auth)

### Menu
- `GET    /api/menu/categories`             → `[Category]`
- `GET    /api/menu/items`                  → `[MenuItem]`
- `POST   /api/menu/items`                  → create (Manager only)
- `PUT    /api/menu/items/{id}`             → update
- `PATCH  /api/menu/items/{id}/availability` body `{available: bool}` → toggle 86'd

### Tables
- `GET   /api/tables`                       → `[Table]`
- `PATCH /api/tables/{id}`                  body `{status, order_id?}` → set status

### Customers
- `GET    /api/customers`                   → `[Customer]`
- `GET    /api/customers/search?phone=...`  → `Customer | null`
- `POST   /api/customers`                   → create
- `PUT    /api/customers/{id}`              → update
- `DELETE /api/customers/{id}`              → delete

### Inventory
- `GET   /api/inventory`                    → `[InventoryItem]`
- `PATCH /api/inventory/{id}/adjust`        body `{delta: number}` → mutates stock
- `POST  /api/inventory/{id}/reorder`       → resets stock to 2x reorder level (mock PO)

### Orders
- `GET   /api/orders`                       → `[Order]` (newest first)
- `POST  /api/orders`                       → create order, auto increments `number`, increments customer order count, marks dine-in table occupied. Returns full order.
- `PATCH /api/orders/{id}/status`           body `{status}` → updates status, frees table on completion.

### Reports
- `GET /api/reports/summary`                → `{todaySales, ordersToday, avgOrder, deliveriesToday, cashTotal, cardTotal, unpaidTotal, weeklySales, topItems}` computed from `orders` + static weekly seed for first launch.

---

## 4. Data Models (Mongo documents)

```ts
User       { id, name, role, initials, pin_hash, created_at }
Category   { id, name, color, sort_order }
MenuItem   { id, cat_id, name, desc?, price?, sizes?:{sm,md,lg}, available, is_pizza }
Customer   { id, name, phone, address?, postcode?, notes?, orders:int }
Table      { id, number, seats, status, order_id? }
InventoryItem { id, name, unit, stock, reorder, supplier }
OrderItem  { name, qty, price, mods:[str] }
Order      {
  id, number:int, type, status,
  customer:{ id?, name, phone?, address?, postcode? },
  table?:int, items:[OrderItem],
  delivery_fee, discount, total, payment, placed_at, driver?
}
```

All `id` fields are stable UUIDs/seeded strings (not Mongo `_id`); `_id` is excluded from API responses.

---

## 5. Frontend Integration Plan

1. Create `/app/frontend/src/api/client.js` — axios instance, base URL `${REACT_APP_BACKEND_URL}/api`, attaches `Authorization: Bearer <token>` from localStorage.
2. Rewrite `PosContext.jsx`:
   - On mount: if token present → `GET /auth/me`, then fetch all resources in parallel.
   - `login(pin)` → POST `/auth/login`, persist token + user.
   - Replace every local mutation with the matching API call and refresh state from response.
3. Components keep working — they consume the same fields from `usePos()`.

Mock-only frontend constants kept in `mock.js` (UI constants): `PIZZA_SIZES`, `TOPPINGS`, `TOPPING_PRICE`, `CATEGORIES` fallback, `DELIVERY_FEE`, `WEEKLY_SALES`, `TOP_ITEMS` (last two replaced by API once `/reports/summary` is wired).
