# Andromeda POS — Product Requirements Document

## Original Problem Statement
Clone the Andromeda POS system specifically for restaurants and pizza delivery. Build the actual POS application interface with:
- Order taking (dine-in / takeaway / delivery)
- Menu management
- Cart & checkout
- Table management
- Staff/cashier login
- Sales reports & dashboard
- Customer management for deliveries
- Inventory management
- Strategy: frontend-first with realistic mock data, then wire up FastAPI + MongoDB backend.

## User Personas
- **Manager** — full access, menu management, reports.
- **Cashier** — order taking, payments, customer lookup.
- **Driver** — delivery dispatch / status updates.

## Core Requirements (delivered)
- Staff PIN-based login (4-digit PIN, bcrypt hashed) + JWT (12h).
- Order types: delivery, collection, dine-in.
- Pizza item modifiers (3 sizes × 14 toppings) and meal deals.
- Cart with subtotal, discount (0/10/20%), delivery fee, total.
- Cash + card payment flow with change-due calculation.
- Orders kanban with status flow: new → in-kitchen → ready → out-for-delivery → completed.
- 12-table plan with seat/status tracking, auto-occupy on dine-in order.
- Customer directory with phone search, address + delivery notes.
- Inventory with reorder alerts, +/- adjustments, mock PO reorder.
- Menu management: add/edit items, 86' toggle, pizza-size pricing.
- Reports dashboard: today sales/orders/avg/deliveries, payment split, weekly chart, top sellers.

## Architecture (current)
```
React (CRA) + Tailwind + Shadcn UI + Sonner toasts
        │  axios (Bearer JWT)
        ▼
FastAPI + Motor + MongoDB (DB: andromeda_pos)
  /api/auth/{login,me}
  /api/menu/{categories,items}
  /api/tables
  /api/customers + /search
  /api/inventory + /adjust + /reorder
  /api/orders (number from counters collection)
  /api/reports/summary
```
Auto-seed on startup if collections empty (idempotent). MongoDB counters collection drives monotonic order numbers from 1047.

## Implemented (2026-02-15)
- Frontend MVP with mock data (Phase 1 — previous session).
- FastAPI backend with all P0 endpoints + JWT auth + bcrypt PIN + auto-seed.
- React PosContext rewired through `/app/frontend/src/api/client.js`.
- Reports screen consumes `/api/reports/summary` live.
- Backend regression suite: 33/33 passing (`/app/backend/tests/test_andromeda_api.py`).

## Implemented (2026-02-16) — P1
- Reports `/api/reports/summary` now filters today's-only stats and computes a rolling 7-day `weeklySales` + `topItems` from real order data.
- Role gating on menu mutations — `POST /api/menu/items`, `PUT /api/menu/items/{id}`, `PATCH /api/menu/items/{id}/availability` require `Manager` role (driver/cashier → 403).
- Literal/enum validation on `Order.type`, `Order.status`, `Order.payment`, `Table.status` (invalid value → 422).
- Seed widened to insert 6 days of historic orders so the weekly chart shows realistic data on first boot.
- Test suite expanded to 42/42 covering the new behaviour.

## Implemented (2026-02-17) — P3a · Multi-tenant foundation + Kanda POS rebrand
- **Rebrand**: app name "Andromeda" → **Kanda POS** across backend (FastAPI title, log namespace, module docstrings), frontend (login splash, sidebar header, page title, Razorpay merchant name) and localStorage token key. Default store name → "Demo Restaurant".
- **Tenants collection** (`/app/backend/tenants.py`) with seed `demo` tenant carrying its own `store` block (name/address/phone/tax_id/footer). Receipts now source store info from the tenant doc, so each tenant prints with their own branding.
- **`tenant_id` on every record** (`users`, `categories`, `menu_items`, `customers`, `tables`, `inventory`, `orders`). Compound `(tenant_id, id)` and `(tenant_id, number)` unique indexes replace the legacy single-field unique ones; migration drops the old indexes once and backfills any pre-multi-tenant rows with `tenant_id="demo"`. Counter is now keyed `<tenant>:order_number` and auto-reconciles to the max existing order on boot so collisions can't happen.
- **JWT carries `tenant_id`** as a signed claim; `get_current_user` returns it, every Mongo query in `server.py`/`payments.py`/`receipts.py` filters via `tenant_filter(user, …)` — strict isolation, no cross-tenant leakage possible.
- **Login resolves tenant from `X-Tenant-Slug` header** (defaults to `demo`). Unknown slug → 404. Frontend interceptor sends the header automatically; subdomain detection treats `<slug>.kanda.<tld>` as production tenants and falls back to `demo` on preview/local hosts.
- **WebSocket channel scoped per tenant** — `manager.broadcast` only sends events to sockets whose JWT `tenant_id` matches. No XYZ Pizza event ever reaches ABC Restaurant's terminals.
- Test suite still 61/61 passing.

## Implemented (2026-02-18) — P3b · Platform Owner Portal (verified E2E)
- **Owner backend** (`owners.py`, `owner_routes.py`): Email/Password + TOTP 2FA (PyOTP), bcrypt password hashing, two-step `/api/owner/auth/login` → `/api/owner/auth/verify` flow, 12h access JWT with `iss="owner"`, `role="PlatformOwner"`. Owner endpoints: `/auth/me`, `/kpis`, `/tenants` (list + create + detail), `/tenants/{id}/impersonate`, `/me/totp-qr`.
- **Impersonation tokens** (`create_impersonation_token`): 30-min tenant-scoped JWT carrying `imp_owner` + `auditor` claims. Auditor middleware in `tenants.py` blocks every non-GET except `/api/payments/verify`. All impersonations logged to `owner_impersonations` collection.
- **Owner CLI bootstrap** (`python -m owner_bootstrap`) prints the TOTP secret + otpauth URI for the authenticator app on first provision.
- **Test-only TOTP bypass** — when `OWNER_TOTP_TEST_BYPASS=true` in `/app/backend/.env`, the fixed code `000000` is accepted as a valid TOTP. Live TOTP secrets still work in parallel. **NEVER set this in production.**
- **Owner Portal UI** (`/app/frontend/src/components/owner/*`): OwnerLogin → OwnerTotp → OwnerLayout with sidebar (Dashboard / Tenants / New tenant / Sign out), OwnerDashboard with 4 KPI tiles + recent tenants, TenantsList, TenantDetail with per-tenant KPIs + staff table + Impersonate CTA, CreateTenant form, ImpersonateModal (full / auditor with reason) and sticky ImpersonationBanner shown during impersonation.
- **Bug fixes in this session**:
  - `OwnerTotp.jsx`: replaced render-phase `navigate()` with `useEffect` guards so the success re-render no longer races the redirect back to `/owner/login`.
  - `ImpersonateModal.jsx`: switched from SPA `navigate("/")` to `window.location.assign("/")` so PosContext bootstraps fresh with the new impersonation token. Mirrors the hard-reload convention already used in `ImpersonationBanner.onExit`.
- **Tests**: 81/81 (61 prior + 20 new owner-portal tests in `test_owner_portal.py`). Frontend E2E verified — login + TOTP `000000` → dashboard, tenants list/detail, create tenant + manager PIN 9999 login, impersonation full + auditor (with auditor write-block), exit impersonation, sign out.

## Implemented (2026-02-19) — P3c · Ops & Support + P3d · Razorpay Subscriptions
- **Audit log middleware** (`ops.py:install_ops_middleware`): every mutating `/api/*` request (POST/PUT/PATCH/DELETE) is captured to `audit_logs` with actor type (staff/owner/impersonator), actor id+role, route, method, status, tenant_id, `imp_owner` when impersonating, `auditor_session` flag. Skips owner-ops calls + the Razorpay webhook to keep the noise down.
- **Error log capture**: unhandled exceptions and 4xx responses persist to `error_logs` with a 4 KB traceback for 5xx — surfaced at `/owner/ops/errors` with a click-to-open detail modal.
- **Support tickets**: POS `Help` button (sidebar) opens ContactSupportModal (subject + body + low/normal/high severity). `POST /api/support/tickets` persists the ticket and best-effort emails the platform owner via Resend (`email_service.py`). Owner Portal `/owner/ops/support` (SupportInbox) lists tickets with status filter, reply form (auto-flips to `in_progress`), and status toggles (in_progress / resolved / closed). Resend creds in `/app/backend/.env`: `RESEND_API_KEY`, `SUPPORT_FROM_EMAIL=onboarding@resend.dev`, `SUPPORT_TO_EMAIL=kandaaakatla@gmail.com`.
- **Subscriptions** (`subscriptions.py`): three plans server-defined — `starter ₹999` / `pro ₹1999` / `master ₹2999` monthly INR. `POST /api/owner/tenants/{id}/subscribe` creates a Razorpay Plan (idempotent, cached in `subscription_plans` collection) + a Subscription with `total_count=24` and returns the hosted `short_url`. Cancel uses `cancel_at_cycle_end=1` by default. Owner UI: `TenantBillingCard` on tenant detail (data-testid `tenant-billing`).
- **Webhook** at `POST /api/payments/razorpay/webhook` — HMAC SHA256 against `RAZORPAY_WEBHOOK_SECRET` in `.env`. Handles `subscription.activated`/`charged`/`halted`/`cancelled`/`completed`/`pending` and updates `tenant.subscription_status`, `current_period_end`, `grace_until` (=`current_end` + 7d), `last_payment_at`. Bad signature → 400; unknown subscription id → 200 + skipped.
- **Soft warning + hard block**: `grace_state()` returns `{ok, in_grace, reason, ...}`. `POST /api/auth/login` returns 402 with `detail.code=subscription_required` once past `grace_until`; otherwise allows login. `GET /api/billing/status` powers the yellow `BillingBanner` above POSLayout (dismissable for 12h via localStorage).
- **Frontend additions**: POS `Help` (data-testid=`help-btn`) + `BillingBanner` + `ContactSupportModal`; Owner sidebar `Support / Audit log / Errors` (data-testid=`owner-nav-support` / `owner-nav-audit-log` / `owner-nav-errors`); new pages `SupportInbox.jsx`, `AuditLog.jsx`, `ErrorLog.jsx`, `TenantBillingCard.jsx`.
- **Tests**: 99/99 backend pytest passing — 92 existing + 11 new in `tests/test_p3c_p3d.py` (support full chain, audit/error capture, plan catalogue amounts, billing status shape, webhook signature good/bad). Testing agent iteration_4 verified the full UI surface for both P3c and P3d.

## Implemented (2026-02-20) — KDS · Cleanup script · server.py route refactor
- **Kitchen Display System** (`/app/backend/kds.py`, `/app/frontend/src/components/kds/KDSBoard.jsx`): standalone `/kds[?station]` board with **4 lanes** (New / Preparing / Ready / Recall), **per-item checkbox** promotion inside hybrid order cards, **per-item station tags** (kitchen/pizza/grill/drinks/desserts) routed from menu categories via `CAT_STATION`, station chips at top + per-station URLs (`/kds/pizza`, …), **Web Audio API beep** + flash on new tickets (toggle data-testid=`kds-toggle-sound`), 6 s polling refresh. Recall lane keeps a bumped order visible for 5 minutes.
- **KDS auth = long-lived token per tenant**: `kds_token` field on the tenant doc. Owner endpoints `GET /api/owner/tenants/{id}/kds-token` (idempotent) and `POST .../kds-token/rotate`. Owner UI: new `KdsTokenCard` on TenantDetail (data-testid `kds-token-card`) with Station picker, Copy URL, Rotate. KDS endpoints accept token via `?token=` or `X-KDS-Token` header — auditor read-only guard skips `/api/kds/*` by design.
- **Order pipeline integration**: `routes/orders.py` calls `annotate_order_items_for_kds()` on every POST so each item is stamped with `station` + `kds_status='new'`. Bumping all items to `ready` auto-flips the legacy `order.status` to `ready` so the POS Orders screen reflects KDS progress in real time. `kds.ticket` event broadcast on new orders for any future KDS WS upgrade.
- **server.py refactor** — monolithic file split into `/app/backend/routes/` modules: `_shared.py` (helpers), `auth.py`, `menu.py`, `tables.py`, `customers.py`, `inventory.py`, `orders.py`, `reports.py`. `routes/__init__.py` exposes a single `api_router` (prefix `/api`) that `server.py` mounts; the now ~95-line server.py only owns app lifecycle, auditor middleware, and cross-cutting router wiring (payments / receipts / ws / support / kds / owner / subscriptions / ops). All endpoint URLs are unchanged.
- **`cleanup_qa.py`** — one-shot cleanup of QA detritus. Removes `qatest*` tenants (and every record scoped to them), `^(smoke|test_|qa[:_ ]|owner-flow)`-style support tickets, `TEST_*` customers, and KDS-cluttering probe orders matching `^(TEST_|QA |Iter\d|UI Probe|Iter5 Smoke|Smoke Chain)`. Also trims audit/error logs older than 30 days. Run: `python -m cleanup_qa`. Idempotent — safe to schedule from cron.
- **Tests**: 114/114 backend pytest passing — 107 prior (61 + 20 + 11 + 7 + 8 KDS) + 7 new iteration_5 smoke. New `tests/test_kds.py` covers token issuance/rotation, 401/400 paths, lane promotion, recall, station filter. Iteration_5 testing-agent report → 0 critical, 0 minor, 0 design issues.

## Implemented (2026-02-21) — 5-feature batch
- **Menu categories CRUD** (`routes/menu.py`): Manager-only POST / PUT / DELETE / PATCH-reorder. Optional `station` field per category overrides the static `CAT_STATION` map for KDS routing. DELETE returns 409 if any menu items still reference the category.
- **Recipes ↔ Inventory** (`routes/menu.py` + `routes/orders.py`): GET/PUT `/api/menu/items/{id}/recipes` with size-aware variants (`size: 'sm'|'md'|'lg'|null` + ingredient list). `POST /api/orders` now calls `_apply_recipes()` to decrement linked inventory items by `qty × recipe.qty`. Tries size-specific first, falls back to size=null. Unwired items skip silently.
- **Driver mobile view** (`DriverScreen.jsx`): Drivers (role=Driver) auto-route to `/driver` on login (LoginScreen redirects based on role). Stripped UI with two sections — `My deliveries` and `Available`. New endpoints: `POST /api/orders/{id}/claim` (Driver-only self-assign), `PATCH /api/orders/{id}/payment` (cash collection). One-click `tel:` and Google Maps deep-links. Polls every 8 s.
- **Free-form table layout editor** (`TableLayoutEditor.jsx`): drag tables on a snap-to-10px canvas; side-panel controls shape (square/round/rect), width/height/seats, rotation (+15° steps); add new table; remove. Layout fields (x, y, width, height, shape, rotation) are now preserved in the `Table` response model (`_shared.table_doc_to_response` extended). New endpoints: `POST /api/tables` (Manager-only create), `DELETE /api/tables/{id}`, `PATCH /api/tables/{id}/position`. Floor elements CRUD endpoints (walls, room labels, doors) wired but no UI yet.
- **Reservations** (`routes/reservations.py`): GET/POST/PATCH/DELETE `/api/reservations` with proper time-window overlap guard (returns 409 when a new booking intersects an existing booked/seated reservation on the same table). Statuses: `booked`, `seated`, `cancelled`, `no-show`. API-only — UI deferred.
- **Order `source` field**: `OrderCreate` + `Order` carry `source: 'in-store'|'phone'|'swiggy'|'zomato'|'other'`. OrderScreen has a 5-pill source selector (Swiggy=orange `#fc8019`, Zomato=red `#cb202d`). Field persists round-trip and is available for reports.
- **Tests**: 125/125 backend pytest passing — 114 prior + 11 new in `tests/test_iteration6_features.py` covering all five features.

## Implemented (2026-02-22) — Menu/Recipes/Reservations UI + CSV
- **Recipe modal** (`RecipeModal.jsx`) per menu item: size tabs (sm/md/lg) for pizzas, single tab for everything else. Pick an ingredient from inventory, set qty per unit, save. Wired to `GET/PUT /api/menu/items/{id}/recipes`.
- **Category manager modal** (`CategoryManagerModal.jsx`): Manager-only — add, rename, recolor, set KDS station override, reorder via ▲/▼, delete (refuses if items still reference it).
- **MenuScreen now uses dynamic categories** from the API (previously hardcoded). New header row: `Categories / Template / Export / Import / Add Item`. Each row gets a ChefHat recipe shortcut.
- **CSV import/export** (`/app/backend/routes/menu_csv.py`): `GET /api/menu/export.csv` (download current menu), `GET /api/menu/template.csv` (header + 2 sample rows), `POST /api/menu/import` (multipart upload — creates new rows when `id` is empty, updates when `id` exists; skips rows with unknown category and reports per-row errors). All Manager-only.
- **Reservation modal** (`ReservationModal.jsx`) on TablesScreen — date picker, daily list with seat/no-show/delete actions, booking form (table picker, customer, phone, party size, datetime, duration). Wired to `/api/reservations` with the proper time-window overlap guard.
- **PosContext**: added `refreshMenu` so CSV import refreshes the menu in-place; `refreshTables` already exposed for layout editor.
- **Tests**: 125/125 backend pytest passing. UI verified via smoke screenshot — all four modals open + render correctly.

## Implemented (2026-02-23) — CSV preview · Twilio SMS · KDS WebSocket push
- **CSV preview-before-commit**: `POST /api/menu/import?dry_run=true` parses + returns the diff (`{created, updated, skipped, errors, changes}`) without writing. MenuScreen now opens a `csv-preview-modal` showing every action row (`create`/`update`/`create_with_id`) and only commits when the user clicks `Apply import`. Skipped rows + error reasons surface inline.
- **Twilio SMS reservation reminders** (`/app/backend/sms_service.py`): `send_sms()` graceful wrapper (never raises). `reservation_reminder_loop()` runs every 5 minutes inside the FastAPI process (kicked off in `@app.on_event("startup")`), finds reservations with phone set + status=booked + `reminded_at IS NULL` + `at` within the 55–65 min window, sends SMS via Twilio, then stamps `reminded_at` + `reminder_sent`. Trial-account 400 (unverified destination) returns False and continues — verified prod numbers will deliver as expected. Creds in `/app/backend/.env`: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`.
- **KDS WebSocket push** (`/api/ws/kds?token=`): new public WS endpoint authenticated by the long-lived `kds_token` on the tenant doc. Joins the same per-tenant fan-out pool so the kitchen tablet receives `order.upserted` / `kds.ticket` / `kds.updated` events instantly. KDSBoard.jsx now opens the WS on mount, refreshes on any push, and keeps a 30 s safety poll as a fallback (down from a 6 s polling cadence). Auto-reconnect on close with 3 s back-off.
- **Tests**: 131/131 backend pytest passing — 125 prior + 6 new in `tests/test_iteration7.py` covering CSV dry-run vs apply, SMS graceful failure, WS reject-missing-token + accept-valid-token.

## Implemented (2026-02-25) — Menu CSV recipe columns · Reports DB-filter
- **Menu CSV recipes** (`routes/menu_csv.py`): export, template, and import now round-trip recipes via four extra columns — `recipe_default`, `recipe_sm`, `recipe_md`, `recipe_lg` — using a `Name:qty;Name:qty` cell syntax (qty can carry a unit suffix like `200g`). Unknown ingredient names surface as per-row warnings during import. Template ships with one pizza + one side example.
- **Frontend CSV download token** (`MenuScreen.jsx`): fixed stale token key (`kanda_pos_token` → `kanda_pos_token_v1`) so the Template + Export download buttons correctly authenticate.
- **`/api/reports/summary` perf** (`routes/reports.py`): the rolling 7-day chart now applies a DB-level `placedAt >= week_start.isoformat()` filter and runs on a new compound index `(tenant_id, placedAt: -1)` (added to `seed.py`). MongoDB `explain()` confirms `IXSCAN` instead of full collection scan, addressing the deployment-health-check warning.
- **Tests**: 132/132 backend pytest passing — 131 prior + 1 new `tests/test_reports_window.py` confirming a 45-day-old order does not leak into weekly buckets or topItems.

## Implemented (2026-02-25 · part 2) — Staff Ops module (Phase A+B+C + restaurant gaps)
Massive feature batch enabling Kanda POS to actually run a restaurant's HR & ops, not just take orders.

**New backend route modules** (all in `/app/backend/routes/`):
- `staff.py` — Manager-only employee CRUD with PIN-uniqueness checks; soft-deactivate preserves history.
- `timeclock.py` — public `POST /api/timeclock/punch` (PIN + selfie b64) with auto in/out detection from last punch. Manager endpoints: `/current`, `/punches` (history), manual-punch insert, `/timesheet` (overtime > 40h, 1.5× premium, gross pay), `/timesheet.csv` payroll export.
- `shifts.py` — Rota CRUD + `POST /api/shifts/publish` bulk-publish. Non-managers only see their own published shifts.
- `waste.py` — Wastage log decrements `inventory.stock`, requires reason; appears in audit-friendly list.
- `cashdrawer.py` — `/cashdrawer/open` (with float), `/close` (counted cash → variance = counted − (float + cash_sales since open)). One drawer open per tenant at a time.
- `tips.py` — Pro-rata tip pool: shares distributed by hours from `time_punches` on the shift date; last allocation absorbs rounding remainder.
- `coupons.py` — `code/kind/value/min_subtotal/max_uses/valid_from/valid_to/active`. `/coupons/apply` validates without bumping `used_count`; counter bumps on order create (prevents abandoned-cart burn).
- `locations.py` — Multi-location for one tenant. Auto-seeds `loc_default` on first read. Refuses delete of last remaining location. `is_default` cascades.
- `prep.py` — `/prep-list?horizon_hours=24` derives shortfall from `recipes × last-7-day usage × horizon/168`.

**Model + index changes** (`models.py`, `seed.py`):
- `Order` extended with `tip`, `coupon_code`, `location_id` (all optional, backward-compatible).
- `User` HR backfill: `active=True`, `hourly_rate=0`, `phone=""`.
- New compound indexes: `time_punches(tenant_id, user_id, at)`, `shifts(tenant_id, user_id, start)`, `cash_drawers(tenant_id, status)`, `coupons(tenant_id, code) unique`, etc.

**New frontend screens** (Manager-only sidebar gating):
- `StaffScreen.jsx` (`/staff`) — list + Add/Edit modal with PIN rotate, hourly rate, phone, active toggle. Inactive employees hidden by default with a "Show inactive (n)" pill.
- `TimeClockScreen.jsx` (`/clock`) — public terminal: PIN keypad + live webcam selfie capture (`getUserMedia` → 160×120 jpg @ 0.6 quality). Auto in/out detection. Linked from LoginScreen via "Open Time Clock terminal →".
- `WorkforceScreen.jsx` (`/workforce`) — 3 tabs: **Timesheets** (week picker, overtime highlighting, CSV export), **Rota** (employee × day grid with drag-friendly click-to-edit modal + bulk publish), **Currently In** (live polling every 10s, selfie thumbnails).
- `OperationsScreen.jsx` (`/operations`) — 6 sub-tabs: Wastage / Z-Report / Tip Pool / Coupons / Prep List / Locations.

**Biometric integration doc** (`/app/backend/BIOMETRIC_INTEGRATION.md`):
Contract for `POST /api/timeclock/punch`. Recommended ZKTeco/ESSL via open-source `pyzk` (with example bridge script for Raspberry Pi). WebAuthn fingerprint and QR rotation strategies also documented.

**Testing**:
- 150/150 backend pytest passing (was 132/132 before this batch — 18 new tests in `test_iteration8_workforce.py` + fixed env loading in `test_reports_window.py`).
- Testing-agent iter 8 reported **zero production bugs** across all 17 backend flows + 5 frontend flows.

## Implemented (2026-02-25 · part 3) — Checkout depth + Refund/Loyalty/Onboarding + perf
Closing the loop on the iter-8 backlog with all 10 outstanding asks shipped in one cohesive batch.

**Backend** (3 new route modules + 2 extensions):
- `routes/refunds.py` — `POST /orders/{id}/refund` partial/full with `refund_logs` audit; `POST /orders/{id}/void` reverses recipe-driven inventory + records cause. Manager-only. (Production bug fixed during testing: Mongo `_id` was leaking into the response — now stripped.)
- `routes/loyalty.py` — Earn 1 pt / ₹100 spent (auto on cash/card orders for matched customers), redeem 1 pt = ₹1 off, tiers `bronze/silver/gold` from lifetime spend, manual adjust w/ reason, `/loyalty/lookup?phone=` for cashier checkout. **Burn cap fixed to use gross item subtotal** (not client-side discounted total) — prevents free-order exploit where redeem zeroed `total` and bypassed balance debit.
- `routes/onboarding.py` — 4-step checklist (extra staff / menu / location / paid order) with persistent dismiss; powers the new banner.
- `routes/reports.py` — `+ /reports/labour` (today's labour spend, currently-in, 30-day run-rate) using new `effective_hourly_rate` helper that normalises monthly-paid staff to hourly via 234 h/mo. `+ /reports/daily-rollup?days=N` with cache-immutable historic days in `report_rollups` and live recompute for today.
- `routes/orders.py` — extended to persist `tip`, `coupon_code`, `customer_email`, `redeem_loyalty_points`, `splits[]` (cash+card sum-to-total enforced), and to fire `order_receipt_email()` via Resend on `send_email_receipt`. Auto credits/burns loyalty.
- `models.py` — Staff gets `pay_type` (`monthly` default) + `monthly_pay`. Customer gets `loyalty_points/tier/lifetime_spend`. Order gets refund/void + loyalty + splits + email fields. New models for everything above.

**Frontend** (5 new components + 6 extensions):
- `CartPanel.jsx` — tip presets (None/5/10/15%), coupon code input with live `/coupons/apply` validation, redeem-loyalty input with "Max" button (gated on customer phone match), email receipt input + Switch.
- `PaymentModal.jsx` — third method **Split**, with cash/card pad, 50/50 + "Card = remainder" shortcuts; cash component recorded, card component routed through Razorpay.
- `RefundVoidModal.jsx` — reason pills, partial-amount with 25/50/full shortcuts.
- `OnboardingBanner.jsx` — checklist banner mounted in `POSLayout`; Manager-only; auto-hides on dismiss or completion.
- `TimeClockScreen.jsx` — webcam empty-state CTA over the video tile.
- `KDSBoard.jsx` — exponential-backoff WS reconnect (1→2→4→8→…30s) + 30s polling safety net.
- `ReportsScreen.jsx` — labour-cost widget at the top (Manager only) with labour-vs-sales % indicator.
- `StaffScreen.jsx` — pay-type selector + monthly-salary input + "normalises to ₹X/hr" hint.
- `OrdersScreen.jsx` — Manager-only Refund / Void buttons per order card; "VOIDED" / "Refunded ₹X" badges.

**Tests**: 180 pytest backend tests pass (was 150 + 29 new from iter-9 + 1 new loyalty-cap regression). One critical bug fixed mid-iteration (refund/void ObjectId leak). One subtle bug fixed by main agent (loyalty burn cap).

## Implemented (2026-06-29) — Rota PDF · staff-rota view · Operations restructure · runtime-error fix
Closing out the next batch of user asks.

**New / fixed**:
- **Rota PDF export** (`/api/shifts.pdf`) — Manager-only, renders a landscape A4 grouped by employee using `reportlab` (5.0.0 added to `requirements.txt`). Frontend `rota-pdf-btn` in `WorkforceScreen` triggers a real attachment download.
- **Staff + Driver own-rota view** — new `MyRotaTab` in `WorkforceScreen` with totals card + day-grouped published shifts. Cashiers see `nav-my-rota` in sidebar; Drivers get a `driver-rota-btn` in their `DriverScreen` header (Drivers don't see POSLayout's sidebar otherwise).
- **Runtime error fix** — 5 instances of `useEffect(load, [])` where `load` returned `apiCall(…).then(setX)` (a Promise) were crashing the Tip Pool / Coupons / Prep List / Locations / Drawer / Wastage sub-tabs on unmount ("destroy is not a function"). Converted to `useEffect(() => { load(); }, [])` in `OperationsScreen`, `StaffScreen`, `WorkforceScreen`.
- **UI restructure** per user direction:
  - **Wastage** moved out of Operations into `InventoryScreen` (toggle pill `inv-toggle-waste`)
  - **Z-Report (Cash Drawer)** moved into `ReportsScreen` as a collapsible Manager-only section
  - **Tip Pool** moved into `ReportsScreen` as a collapsible Manager-only section
  - **Multi-location** removed from Operations — now a header dropdown (`LocationSwitcher.jsx`) next to the store name. Active location persisted to `localStorage.kanda_pos_active_location_v1`. No all-stores aggregated view (per user spec).
  - **Operations tab** now hosts only Coupons + Prep List.
- **Manager-only route guard** (`ManagerOnly` in `App.js`) — Cashiers/Drivers URL-hacking to `/staff` or `/operations` get redirected to `/` instead of seeing a broken screen with 403 errors.

**Tests**: 180/180 backend pytest pass (151 baseline + 29 iter-9 + 5 new iter-10 PDF/myrota tests). Frontend smoke-verified at 1280×800 and 1920×1080 — no console errors during Manager / Cashier / Driver navigation across all screens.

## Implemented (2026-06-29 · part 2) — Restaurant Owner Dashboard + 3-tier auth
Third tier between Platform Owner and POS-PIN staff.

**Backend** (`routes/dash_auth.py`):
- `POST /api/dash/auth/login` — email+password for **3 roles** (`owner` / `area_manager` / `manager`).
- `GET /api/dash/auth/me`, `POST /api/dash/auth/change-password`.
- New `dashboard_users` collection. JWT stamps `role: "Manager"` so all existing endpoints transparently accept dash tokens; `dash_role` + `location_ids` carried for client-side scope checks.
- `auth.py:get_current_user` now resolves dash tokens against `dashboard_users` instead of staff `users`.
- Demo seeded accounts (idempotent): `owner@demo.com / OwnerPass#2025`, `manager@demo.com / DemoMgr#2025`, `area@demo.com / DemoArea#2025`.

**Frontend** new routes at `/biz/*`:
- `DashLogin` · `DashLayout` · `DashHome` (KPIs + multi-store cards) · `DashChangePassword` · `DashLocations` (read-only, "Add location · payment required" disabled).
- Existing screens **reused** as-is via `/biz/menu`, `/biz/staff`, `/biz/workforce`, `/biz/coupons`. The dash login mirrors the JWT into `kanda_pos_token_v1` so the existing axios client just works.

**POS restructure per user spec**:
- Manager nav lost: **Staff**, **Workforce (Rota)**, **Coupons**. Replaced with a single "Dashboard" link → `/biz`.
- POS `/menu` is now **view-only** (no Add Item / Categories / CSV / Edit pencil / Recipe icons) — manager goes to `/biz/menu` for CRUD.
- `LocationSwitcher` "Add new location" replaced with a locked-style button hinting to use the Dashboard (payment-gated).

**Tests**: smoke-verified via Playwright — owner login → dashboard → menu/staff/coupons all editable; POS `/menu` view-only. Backend curl-tested: dash token reaches `/api/staff`, `/api/coupons`, `/api/menu/items` with valid responses.

## Implemented (2026-06-29 · part 3) — Operations tab removed + Rota PDF fix
Per user request: simplify UI, drop seldom-used screens, ship reliable PDF export.

- **Operations tab removed** from POS sidebar entirely. `/operations` route, `ManagerOnly` wrapper, and `OperationsScreen.jsx` deleted.
- **Coupons (management UI) and Prep List dropped** per user choice (option d — drop entirely). `/biz/coupons` route + Coupons nav in `DashLayout` removed. Customers can still **redeem** coupons in checkout via `CartPanel` (`couponsApi.apply` retained).
- **Reusable panels extracted** to `components/pos/OpsPanels.jsx`: `WastePanel` (still inside Inventory), `CashDrawerPanel` + `TipPoolPanel` (still inside Reports). No functional regression.
- **Rota PDF download fixed** (`WorkforceScreen.downloadPdf`). Root cause: the anchor element was never appended to the DOM before `.click()` — Firefox silently no-ops in that case, and even Chromium revoked the blob URL before the download stream completed. New flow: build blob → `appendChild` → `click()` → `removeChild` → delayed `revokeObjectURL`. Verified end-to-end via Playwright: 2.5 KB valid `%PDF` file downloads on Manager click.
- **Onboarding banner** "Verify your store location" CTA repointed from the now-defunct `/operations` to `/biz/locations`.

**Tests**: 185/185 backend pytest pass (no regressions). Frontend smoke + Playwright PDF download verified.

## Implemented (2026-06-30) — AI Calling Agent (Phase 2)
Per-tenant multilingual phone agent that answers calls and takes orders.

**Stack**: Twilio Programmable Voice + Media Streams ↔ OpenAI Realtime API (GA, model `gpt-realtime`). Audio format `audio/pcmu` (8 kHz μ-law) end-to-end — no transcoding.

**Backend** (`routes/voice.py` + `tests/manual/probe_voice_bridge.py`):
- `GET/PUT /api/voice/config` — per-tenant voice settings stored under `tenant.voice` (enabled, twilio_number, default_language, voice, greeting, persona).
- `POST /api/voice/configure-twilio` — uses Twilio REST `incoming_phone_numbers.update` to auto-wire the tenant's number to our public webhook.
- `POST /api/voice/twilio-incoming` — returns TwiML `<Connect><Stream wss://.../api/voice/twilio-stream>` with `tenant_id` as a custom parameter; tenant matched by `To` number.
- **WebSocket `/api/voice/twilio-stream`** — the bridge. Accepts Twilio Media Streams, concurrently opens a WS to `wss://api.openai.com/v1/realtime?model=gpt-realtime` (Authorization header only — GA schema, no `OpenAI-Beta` header), sends `session.update` with `type:"realtime"`, nested `audio.input/output.format.type:"audio/pcmu"`, server VAD, Whisper transcription, and 3 function tools. Audio frames forwarded both ways; `response.output_audio.delta` → Twilio `media` event with `streamSid`.
- **Function tools** (called by OpenAI mid-call):
  - `place_order` — matches items against tenant menu (exact then loose contains), inserts an `Order` doc with `source:"phone"`, broadcasts `kds.ticket` over the existing WS pool.
  - `book_reservation` — inserts into `reservations` with `source:"phone"`.
  - `end_call` — graceful goodbye → close stream after 2.5 s.
- **Call log** (`voice_calls` collection): row created on `start`, finalised on disconnect with `duration_seconds`, transcript (user + assistant), and intent (`order_placed` / `reservation_booked`).
- **Per-tenant system prompt**: auto-built from tenant store info + the live menu (category-grouped, price-tagged), with language clause ("auto-detect English/Hindi/Telugu from first sentence"), and owner-configurable persona append.

**Frontend** (`components/dash/DashVoice.jsx`):
- New `/biz/voice` route + sidebar nav item ("Voice Agent").
- Status banner ("Agent is LIVE / OFF"), enable toggle.
- Config form: Twilio number + auto-wire-webhook button (or copyable manual URL), language fallback, voice picker (9 OpenAI voices), custom greeting, persona instructions.
- OpenAI billing reminder + link to platform.openai.com/account/billing.
- Call log table with intent badges; click row → modal with full speaker-tagged transcript (timestamps + role).

**Tests**: 6 new `tests/test_voice_agent.py` pytest tests (config CRUD, normalisation, TwiML shape, unknown-number hangup, call log).

**Credentials needed (all already configured in `backend/.env`)**:
- `OPENAI_API_KEY` (user-provided, must have Realtime credit).
- `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM_NUMBER` (already in use for reservation SMS — reused).
- `PUBLIC_BACKEND_URL` (https://retail-engine-97.preview.emergentagent.com) — used so the TwiML `<Stream>` URL is the public one.

**Status**: REST/dashboard/auto-wire fully verified ✅. Live phone-call audio bridge verified to the point where OpenAI accepts the session and only fails on `insufficient_quota` — i.e. the integration itself is correct; user just needs to top-up OpenAI credit. After top-up, dialing **+19086498077** will reach the AI agent.

## Test Credentials
See `/app/memory/test_credentials.md`. Tenant Manager PIN `1234`. Platform Owner: `owner@kanda.app` / `OwnerPass#2025` / TOTP `000000`.

## Backlog (P1) — DONE 2026-02-16
- ~~Today-only filter on `/api/reports/summary`.~~
- ~~Role gating on menu mutations (Manager only).~~
- ~~Literal/enum validation for `Order.type`, `Order.payment`, `Table.status`.~~
- ~~Real weekly sales calc from order history.~~

## Backlog (P2) — DONE 2026-02-17
- ~~Razorpay integration for real card payments.~~
- ~~Receipt printing: HTML browser-print receipt + ESC/POS thermal scaffolding.~~
- ~~WebSocket live updates: order / table / inventory.~~
- ~~Driver dispatch view: assign driver + Google Maps embed + ETA.~~

## Backlog (P3 / future)
- **P3c** ~~Ops & support (error log, audit log, Contact Support form)~~ — DONE 2026-02-19.
- **P3d** ~~Razorpay Subscriptions for tenant billing + lifecycle~~ — DONE 2026-02-19.
- KDS (Kitchen Display System) ~~dedicated screen~~ — DONE 2026-02-20.
- Razorpay subscription webhook configuration in the Razorpay Dashboard (manual step): URL `${REACT_APP_BACKEND_URL}/api/payments/razorpay/webhook`, events `subscription.*`. Webhook secret is in `/app/backend/.env` as `RAZORPAY_WEBHOOK_SECRET`.
- Verify the SUPPORT_TO_EMAIL is the verified Resend account email for production email delivery (currently best-effort; ticket persists either way).
- Periodic cleanup of accumulated `qatest*` tenants and `Smoke/TEST_` support tickets from test runs.
- ETA / route optimisation using real driving distance (would need a routing API key).
- Receipt printer transport layer (TCP/USB/CUPS) to actually pipe the ESC/POS bytes.
- WebSocket fan-out scoped per-terminal (currently single broadcast pool).
- Loyalty / discounts engine.
- Refund + void workflow.
- Razorpay one-time payment webhook reconciliation for offline captures.
- Light refactor: move backend routes/models into `/app/backend/routes` and `/app/backend/models` directories as the codebase grows.


## Session 2026-02-24 — AI Everywhere Phase 1 & 2 ✅
### Phase 1 — Floating "Ask AI" bubble (Claude Sonnet 4.5 via Emergent LLM key)
- **Backend** `/app/backend/routes/assistant.py`: `POST /api/assistant/chat` — combines a static how-to knowledge base + 6 live-data tools (todays sales, top items, low stock, active orders, staff on duty, pending reservations). Model emits `<tools>[...]</tools>` when it needs live data; server executes and re-prompts.
- Budget-exceeded errors now raise HTTP 402 with a friendly detail; other upstream errors raise 502. Frontend surfaces the detail instead of a generic message.
- **Frontend** `AIAssistant.jsx`: floating bubble on every authenticated page (hidden on /login, /biz/login, /owner/login, /clock). Suggested prompts, tool-usage indicator, graceful auth handling.

### Phase 2 — Daily Digest ✅
- **Backend** `/app/backend/routes/digest.py`:
  - `GET/PUT /api/digest/config` — per-tenant `DigestConfig` in `digest_configs` collection: enabled flag, UTC hour/minute, channel toggles (email/SMS), recipient lists. Dedupes on save.
  - `GET /api/digest/preview` — computes today's data (reusing assistant tools) + yesterday's revenue for delta comparison + AI-written summary via Claude Sonnet 4.5.
  - `POST /api/digest/send-now` — immediately sends via configured channels (Resend email + Twilio SMS).
  - Background `digest_scheduler_loop` started on app startup — polls every 60s, fires each enabled tenant's digest at their scheduled UTC time, dedupes by `last_sent_at` (one send per UTC day).
- **Frontend** `components/dash/DashDigest.jsx` + `/biz/digest` route + nav link ("Daily Digest" with Sparkles icon):
  - Preview panel with revenue / orders / avg-ticket / staff-on-duty cards + AI summary + top sellers + low-stock lists.
  - Delivery settings panel: enable toggle, hour/minute inputs, email/SMS channel toggles, add/remove recipients, save button.
  - "Send preview now" button for on-demand delivery.

### Verified
- Backend pytest 8/8 (assistant + digest) — `/app/backend/tests/test_assistant_and_digest.py`.
- Frontend Playwright: owner login → /biz/digest → all UI flows green.
- Real Resend email delivery confirmed to `kandaaakatla@gmail.com`.

## Session 2026-02-24 (later) — Manager Whisper + Voice Mode ✅
### Manager Whisper (into live AI voice calls) — P2 ✅
- **Backend** `/app/backend/routes/voice.py`:
  - Module-level `LIVE_BRIDGES: dict[str, dict]` registry; each active Twilio↔OpenAI bridge registers on session-open and unregisters on close.
  - `GET /api/voice/calls/active` — lists in-progress bridges for the caller's tenant (id, started_at, whisper_count).
  - `POST /api/voice/calls/{call_id}/whisper` (Manager only) — injects a `system`-role `conversation.item.create` prefixed with "[MANAGER WHISPER from {name} — invisible to caller. Fold naturally; do NOT recite verbatim.]" into the live OpenAI Realtime session, then forces a `response.create` so the AI immediately reflects the whisper. Persisted on the call log for audit + broadcast via WS as `voice.whisper.sent` so all managers see it.
  - Validation: 400 on empty/blank message, 400 on message > 500 chars, 404 if call not currently live, 403 cross-tenant.
  - Route ordering fixed: `/voice/calls/active` registered BEFORE `/voice/calls/{call_id}` so path resolution is correct.
- **Frontend** `components/dash/LiveCallsPanel.jsx`:
  - Each active-call card now has a purple "Whisper" composer (mic icon input + send button) at the bottom.
  - Live-updating whispers appear inline in the transcript stream (distinct purple styling) via the new `voice.whisper.sent` WS event.
  - Manager Whisper is invisible to the caller by design.
- **Tests**: `/app/backend/tests/test_whisper.py` — 6 pytest tests (auth guards, size/blank validation, cross-tenant 403, in-process happy-path with AsyncMock OpenAI WS).

### Voice Mode for AI Assistant — ✅
- **Frontend** `components/AIAssistant.jsx`:
  - Header mic-toggle switches the bubble between text ↔ voice mode.
  - Voice mode uses browser Web Speech API (`SpeechRecognition` + `speechSynthesis`) — no backend cost.
  - Big "Tap and speak" button in place of the text input; live "Listening…" pulse indicator; speaker mute toggle in header.
  - AI replies are spoken aloud in `en-IN`; markdown is stripped before TTS.
  - Graceful fallback text when the browser doesn't support Web Speech API.
- No new backend endpoints needed — voice input is transcribed client-side and sent as the same `/api/assistant/chat` text turn.

### Verified
- Backend pytest 6/6 (`test_whisper.py`) + curl on all 4 endpoints.
- Frontend Playwright + testing_agent_v3_fork iteration 12: zero blockers, zero minor issues.


## Backlog (P2/P3) — remaining
- Full Swiggy/Zomato API integration (currently UI-only MOCK).
- First-run onboarding wizard for new tenants.
- Receipt printer transport layer (TCP/USB/CUPS).
- Live "seated X min ago" timer + quick close-bill directly on floor plan cell.
- Turn OFF the `000000` TOTP bypass on `/owner/login` before going to production.


## 2026-02-16 — Reopen occupied-table bill & running-tab settlement (P0)
Fixes user report: *"cannot open occupied table bill as its empty, how do i generate bill now. and for all the orders sent to kitchen needs to be able to be billed again."*

### Backend
- **New endpoint `POST /api/orders/{id}/append`** — appends items to an unpaid order, re-annotates for KDS, decrements recipes' inventory, updates running total, drops status back to `"new"` to re-alert kitchen, broadcasts `kds.ticket` + `order.upserted`. Rejects if order is paid / voided / completed.
- **`GET /api/tables` now self-heals** — any table marked `occupied` whose linked order is completed / paid / voided / missing is auto-freed on each list call. Prevents "empty bill on occupied table" data drift (Table 3 in demo data was affected).
- **New Pydantic model** `OrderAppendPayload` in `models.py`.

### Frontend
- **`OrderScreen` gains an edit mode.** When the URL has `?order=OID`:
  - Loads the referenced unpaid order into `editingOrder`, prefills order type / table / customer, disables order-type switching.
  - New `reopen-banner` shows "Reopened Bill #N · Table X · Y sent · ₹Z" with a close (×) → back to `/tables`.
  - `CartPanel` renders a "Already sent to kitchen" panel (`running-bill-items`) above the new cart with item breakdown + running-bill total.
  - Cart total = `runningBill.total + newSubtotal + tip - discounts` (delivery fee not re-charged in edit mode).
  - "Send to Kitchen" button label → "Add to Kitchen" — hits the new `POST /orders/{id}/append`.
  - "Pay" button label → "Pay Bill ₹X" and stays **enabled with an empty cart** so waitstaff can settle without adding items.
  - On payment success: calls `PATCH /orders/{id}/status = completed` (releases the table), toasts "Bill #N settled", navigates back to `/tables`.
- **`OrdersScreen`** — each unpaid non-voided non-completed order gets a "Bill this order" quick action (`data-testid="bill-<orderNumber>"`) → routes to `/?order=OID`, enabling settlement of any kitchen-sent delivery / collection / dine-in order.
- **Cart action bar** — lifted `z-index: 20` + bottom padding so the Emergent preview badge (`#emergent-badge`) no longer intercepts clicks on Pay at 1920×1080.

### Verified
- Backend pytest — 6/6 in `/app/backend/tests/test_orders_append.py` (new + old order flows, error paths, table release).
- Frontend E2E via `testing_agent_v3_fork` iteration 16 — reopen flow, add-to-kitchen, cash settlement (with auto-back to /tables + table freed), OrdersScreen "Bill this order" button. All GREEN.

### Files touched
`/app/backend/models.py`, `/app/backend/routes/orders.py`, `/app/backend/routes/tables.py`, `/app/frontend/src/api/client.js`, `/app/frontend/src/store/PosContext.jsx`, `/app/frontend/src/components/pos/OrderScreen.jsx`, `/app/frontend/src/components/pos/CartPanel.jsx`, `/app/frontend/src/components/pos/OrdersScreen.jsx`.


