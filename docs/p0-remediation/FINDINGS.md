# Kanda POS — audit findings

Audit date: 2026-08-28. Read-only pass over the repo at commit `ef49838`
("Remove Emergent platform cruft"). No code was changed by the audit.

Every claim below was verified by reading source — application code, the
installed `sentry-sdk` in `backend/venv/Lib/site-packages`, and the installed
`@sentry/browser` in `frontend/node_modules`. Where something could not be
verified, it says so.

---

## How this was verified (method notes)

- Backend syntax: all 62 `.py` files compile clean under Python 3.10.
- An AST scan across all 62 files looked for `find_one_and_update` results used
  without a null guard. It returned 8 hits; manual review of each reduced that
  to 4 real ones (see P1-2).
- The Sentry findings were confirmed by reading the installed library source,
  not from documentation or memory.
- **The test suite was never run.** It cannot run without a live backend and a
  live MongoDB, and neither was available to the audit session. This is itself
  finding P0-4.

---

## P0 — blast-radius generators

### P0-1. Sentry receives zero backend exceptions

`backend/ops.py`, `install_ops_middleware` → `audit_and_error_middleware`
catches every unhandled exception, writes it to the `error_logs` collection,
and returns `JSONResponse(status_code=500, ...)`. It never re-raises and never
calls `sentry_sdk.capture_exception`.

Verified against `sentry-sdk==2.68.1` as installed:

- `sentry_sdk/integrations/fastapi.py` contains **no** `_capture_exception` call
  anywhere. It only handles request data and transaction naming.
- `sentry_sdk/integrations/asgi.py` captures at lines 208 and 375, but only for
  exceptions that escape the **entire** application. `SentryAsgiMiddleware` is
  installed by `patch_asgi_app()` as the outermost wrapper around
  `Starlette.__call__`, i.e. outside the ops middleware. A swallowed exception
  never reaches it.
- `sentry_sdk/integrations/starlette.py:322` captures only when the exception
  has a `status_code` attribute in `failed_request_status_codes`, which defaults
  to `_DEFAULT_FAILED_REQUEST_STATUS_CODES = frozenset(range(500, 600))`
  (`sentry_sdk/integrations/__init__.py:12`). This codebase raises no 5xx
  `HTTPException` anywhere, so this path is dead too.

`SENTRY_DSN` is wired into both Cloud Run regions in `deploy-backend.yml`. The
backend Sentry project is empty by construction.

**Fix note:** capture explicitly; do **not** re-raise. Re-raising hands the
request to Starlette's `ServerErrorMiddleware`, which returns plain-text
`Internal Server Error` instead of the `{"detail": ...}` JSON the frontend
expects. Explicit capture fixes observability with zero change to response
behavior.

### P0-2. 5xx responses are dropped from `error_logs` as well

Same middleware, response-status branch:

```python
if response.status_code >= 500 or response.status_code == 401:
    # 401 noise — skip
    pass
elif response.status_code >= 400 and ...:
    # logged
```

The comment intends to skip 401 noise, but `>= 500` was lumped into the same
condition. Any handler that *returns* a 500 (rather than raising) is recorded
in neither Sentry nor `error_logs`. The owner-facing ops errors dashboard at
`GET /api/owner/ops/errors` cannot show them.

### P0-3. All four cron loops run on every instance, in both regions

Started unconditionally in `server.py`'s `startup` hook:
`reservation_reminder_loop`, `digest_scheduler_loop`, `daily_rollup_cron_loop`,
`birthday_bonus_loop`.

`deploy-backend.yml` sets `--min-instances 1` in **both** asia-south1 and
us-central1, so at least 2 instances always run these loops concurrently; at
peak it is `--max-instances 8` + `3` = 11.

Every dedupe is check-then-act, not atomic:

- `background_tasks.py` — reads `cron_state`, compares `last_run_date`, runs,
  then writes. Concurrent instances all read a stale value and all run.
- The per-customer `last_birthday_bonus_year` guard is also check-then-act
  (read customers → filter in Python → `$inc`), so it does not save it.
- `routes/digest.py:326` `digest_scheduler_loop` — same pattern via
  `last_sent_at`.
- `sms_service.py:147` `reservation_reminder_loop` — reads matching
  reservations, sends, then marks `reminded_at`.

Consequence: duplicate birthday loyalty credits, duplicate birthday SMS,
duplicate digest emails, duplicate reservation reminder SMS. The docstrings
claiming these are safe were written for a single-instance deployment and are
now stale.

**Fix note:** atomic claim in Mongo, no new infrastructure needed. Claim with
`find_one_and_update({id, last_run_date: {$ne: today}}, {$set: {last_run_date:
today}}, upsert=True)` and run only if the claim succeeded; the losing instances
get `DuplicateKeyError` on the unique `id` index, which is the signal to skip.
Reservations get a cleaner per-row version: claim each with
`find_one_and_update({id, reminded_at: None}, {$set: {reminded_at: now}})` so
only the winner sends, which removes the need for a loop-level lock entirely.

A Redis lock also works but would have to fail **closed**, unlike everything
else in `cache.py` where "Redis down" safely degrades to "cache miss." Here
"Redis down" defaulting to "everyone runs" is the bug being fixed. Mongo is
already a hard dependency; Redis is not.

### P0-4. No test gate, and no unit tests exist

`deploy-backend.yml` triggers on push to `master` and deploys straight to both
Cloud Run regions. No workflow runs any test.

The 21 files in `backend/tests/` are all HTTP integration tests:
`conftest.py` builds `BASE_URL` from `REACT_APP_BACKEND_URL`, loads a dead
`/app/frontend/.env` path, and authenticates with PIN 1234. Two files
(`test_reports_window.py`, `test_loyalty_burn_cap.py`) additionally open a
direct `MongoClient` and default to `localhost:8001`. There is no unit test
layer at all.

`build-android.yml` and `deploy-frontend.yml` also set `CI: false`, which
suppresses CRA's treat-lint-warnings-as-errors behavior.

### P0-5. Deactivated staff keep working access

`backend/auth.py`, `get_current_user`. The dashboard-user branch checks
`if not du or du.get("active") is False: raise 401`. The staff branch does not
check `active` at all.

`DELETE /api/staff/{user_id}` (`routes/staff.py`, `deactivate_staff`) sets
`active: False` and correctly invalidates the user cache, but an already-issued
JWT keeps working until it expires (`ACCESS_TOKEN_HOURS`).

---

## P1 — correctness and money

### P1-1. Only 1 of 131 mutating endpoints is idempotent

131 `@router.post/put/patch/delete` handlers across the backend. Idempotency
exists in exactly one place: `client_ref` on order creation
(`routes/orders.py:145`), backed by a unique partial index in `seed.py:324`
with `DuplicateKeyError` recovery. That implementation is correct.

The offline outbox in `frontend/src/data/syncEngine.js` replays five other
mutation kinds. Assessed individually:

- `order.status`, `order.packed`, `table.status` — `$set` to an absolute value,
  naturally idempotent. Safe.
- `order.append` — `POST /orders/{id}/append`, `$push` with no idempotency key.
  A request that lands but whose response is lost duplicates line items and
  money on replay. **Not safe.**
- `inventory.adjust` — see P1-3. **Not safe.**

### P1-2. Four unguarded `find_one_and_update` dereferences

Confirmed by AST scan plus manual review of each hit:

- `routes/orders.py:358` — append handler, then `res["number"]`.
- `routes/inventory.py:81` — adjust, then `clean(res)`.
- `routes/inventory.py:178` — reorder, then `clean(res)`.
- `routes/central_supply.py:79` — restock, then `clean(res)`.

Each does a `find_one` existence check first, then a separate
`find_one_and_update`. A concurrent delete between the two returns `None`, and
`clean(None)` raises `AttributeError` → 500. Narrow race, real crash.

Ruled out on review: `routes/dash_auth.py:227` and `:242` use
`clean(res) if res else invite`; `routes/_shared.py:59` uses `upsert=True`;
`kds.py:293` is guarded.

### P1-3. Stock updates are read-modify-write, not atomic

`routes/inventory.py` `adjust_inventory` and `reorder_inventory`, and
`routes/central_supply.py` `restock_supply_item`, all read the current stock,
compute a new absolute value in Python, then `$set` it.

Two consequences from one root cause: concurrent stock changes silently lose
one (last writer wins), and an outbox replay of `inventory.adjust` recomputes
from current stock and double-applies the delta. Should be an atomic `$inc`.

### P1-4. Order write and inventory decrement are not atomic

`routes/orders.py` `create_order` calls `_apply_recipes` **after**
`insert_one`, with no transaction. A crash in between leaves the order booked
and stock un-decremented.

`_apply_recipes` also matches menu items by **name**, not id
(`name_to_id[m["name"]]`), loads up to 2000 menu items on every order, and
issues up to two `recipes.find_one` queries per line item. This is the hot path.

### P1-5. `GET /orders` is unbounded and has no delta support

`routes/orders.py:139` — no pagination, no `since` parameter, hard `to_list(1000)`
cap. Orders are also absent from `syncEngine.js`'s `COLLECTION_APIS`, so every
terminal boot pulls the full history and silently truncates past 1000 rows.

---

## P2 — caching

The cache layer itself (`backend/cache.py`) is well built: optional, degrades
to no-op without `REDIS_URL`, and every call site handles a miss. The problems
are structural rather than in the primitives.

### P2-1. Invalidation is manual per call site, with no key registry

Correct today in `routes/menu.py`, `routes/brands.py` (per-tenant, inside the
push loop) and `routes/staff.py`. But the keys are constructed ad hoc by private
helpers (`_categories_key`, `_menu_items_key`, `user_cache_key`) that other
modules import directly. Every future writer to `menu_items`, `categories` or
`users` is a new stale-read bug that nothing will catch. This is the real cache
issue — not any single missed invalidation.

### P2-2. Read-populate race can re-cache stale data

`list_categories` / `list_menu_items` read Mongo, then `cache_set`. A write that
invalidates between those two steps loses: the in-flight read re-populates the
cache with its pre-write snapshot. Bounded by `_MENU_CACHE_TTL = 30`, not
eliminated.

### P2-3. `cache_set` silently swallows serialization failures

`cache.py` wraps `json.dumps` in a bare `except Exception` that logs a warning
and returns. A non-serializable field means the cache silently never populates
and nothing alerts on it.

### P2-4. User cache holds `role` for 60 seconds

`auth.py` caches the full user document with `ttl=60`. `routes/staff.py`
invalidates on update and deactivate, so the documented paths are covered, but
any future role change that does not call `cache_delete` leaves up to a 60s
window of stale privileges.

---

## P3 — observability and frontend

### P3-1. No React error boundary anywhere

No `ErrorBoundary` or `componentDidCatch` in `frontend/src`. A render error
white-screens the terminal mid-transaction and drops the cart.

### P3-2. Frontend performance monitoring is dead

`frontend/src/index.js` sets `tracesSampleRate: 0.1` but never adds
`Sentry.browserTracingIntegration()`.

Verified by reading the installed
`@sentry/browser@10.71.0` build source
(`build/npm/cjs/dev/sdk.js`, `getDefaultIntegrations`): it returns
`inboundFilters`, `functionToString`, `conversationId`, `browserApiErrors`,
`breadcrumbs`, `globalHandlers`, `linkedErrors`, `dedupe`, `httpContext`,
`cultureContext`, `browserSession`. `browserTracingIntegration` is **not** among
them. No performance data is being collected.

The same read confirms `breadcrumbsIntegration()` **is** a default, so console
and fetch/XHR breadcrumbs are on. That, not the exception payload, is the real
PII path to review.

### P3-3. No release or source maps in either Sentry SDK

Neither `Sentry.init` sets `release`. No source map upload step exists in any
workflow, so frontend stack traces arrive minified. Neither sets user or
tenant context, so events cannot be triaged per store.

### P3-4. `error_logs` and `audit_logs` grow unbounded

No TTL index on either collection (`seed.py` creates none). `error_logs` stores
`tb[-4000:]` tracebacks, which can contain payment and customer PII — while the
backend `Sentry.init` deliberately leaves `send_default_pii` off. Inconsistent
posture between the two sinks.

### P3-5. Audit write is inline on the hot path

`ops.py` awaits `db.audit_logs.insert_one` on every mutating `/api` request
before returning the response, including order creation.

---

## Found during PR 1 (test harness)

### P4-3. The `integration` marker doesn't stop the legacy suite crashing collection

`pytest.ini`'s `addopts = -m "not integration"` only deselects already-collected
test *items*. Eight of the 21 legacy files (`test_assistant_and_digest.py`,
`test_iteration5_smoke.py`, `test_iteration6_features.py`, `test_iteration7.py`,
`test_iteration8_workforce.py`, `test_iteration9_batch.py`,
`test_orders_append.py`, `test_owner_portal.py`) run module-level code —
reading `REACT_APP_BACKEND_URL` with `os.environ[...]` or `.get(...).rstrip()`,
or opening `/app/frontend/.env` directly — that raises before collection
finishes, regardless of any marker. Confirmed: `pytest backend/tests` (no path
narrowing) aborts with `Interrupted: 8 errors during collection` even with the
marker in place; `pytest backend/tests/unit` is unaffected because pytest only
imports conftest.py files that are ancestors of an explicitly-targeted path,
not sibling test modules outside it.

Not a problem for PR 1's own definition of done (CI runs `pytest
backend/tests/unit` specifically) or for anyone else who does the same. It
does mean a developer running bare `pytest` from `backend/` or
`backend/tests/` gets 8 collection errors instead of a clean "20 deselected."
Fix belongs with whichever PR actually triages the legacy suite (out of scope
here per CLAUDE.md's working rules — not fixed in PR 1).

## Found during PR 2 (staff active check)

### P4-4. `/auth/login` still issues tokens to deactivated staff

`routes/auth.py` `login` matches the PIN against every row in `db.users` for
the tenant with no `active` filter, so a deactivated employee's PIN still
returns 200 and a fresh token. After PR 2 that token is rejected by
`get_current_user` on first use, so there is no access, but the sign-in screen
reports success and the terminal then fails on its next request. Skipping
`active is False` rows in the login loop (and returning the normal "Invalid
PIN") would make it fail cleanly. Not fixed in PR 2 per CLAUDE.md's working
rules.

---

## Found during the Kanda Driver app PR

Found while building the driver app. These apply to the in-POS driver view
too; the separate app just puts them on more phones.

### P4-5. Drivers download every order and every customer's details
`DriverScreen.jsx` polls `GET /orders` every 8 s, which returns up to 1000
orders for the whole tenant (`routes/orders.py:162`) with customer name,
phone and address, regardless of role. The screen filters to deliveries
client-side. A Driver token should get only open deliveries and its own.
**Fixed in the driver app PR (#37):** the app now uses `GET /driver/feed`, which returns only unclaimed deliveries (no phone/email) and the driver's own orders.

### P4-6. Any staff role can change any order's status or payment
`PATCH /orders/{id}/status` and `PATCH /orders/{id}/payment`
(`routes/orders.py:508`) have no role or ownership check, so a Driver can
mark an order it does not hold as delivered or cash-paid.
**Fixed for Driver tokens in #37:** a driver can only move their own delivery ready → out-for-delivery → completed, can't complete it unpaid, and can only mark their own unpaid order as cash. Other roles are unchanged.

### P4-7. Delivery ownership is keyed on the driver's display name
`claim_order` stores `user["name"]` in `order.driver`, and `DriverScreen`
matches on name. Two drivers with the same name see and act on each
other's deliveries; renaming a driver orphans their active ones.
**Partly fixed in #37:** claims now store `driver_id` and ownership checks use it. Orders assigned from Dispatch still go by name.

## P4 — dead or stale

### P4-1. Menu schedules are half-wired

`routes/menu_schedules.py` guards deletion with
`db.menu_items.count_documents(tenant_filter(user, {"schedule_id": schedule_id}))`.
But `schedule_id` is not a field on the `MenuItem` model
(`models.py:284`), is not returned by `menu_doc_to_response`
(`routes/_shared.py`), and is not settable via `MenuItemCreate` / `MenuItemUpdate`.

The actual link runs the other way: `MenuSchedule` carries `category_ids` and
`item_ids`. So the delete guard always counts 0, and a schedule still
referenced by `item_ids` deletes silently. The module docstring describing an
item-side `schedule_id` is stale.

### P4-2. Brand menu push bumps `updated_at` on every item, every push

`routes/brands.py` `push_menu_template` rewrites `updated_at` on every category
and item in every target tenant on each push, forcing every terminal in every
store to re-sync the entire menu via the delta cursor. It also does not tombstone
items deleted from the source template.

---

## Retracted — investigated and found NOT to be bugs

Do not re-open these. Each looked wrong on a first read and is correct.

1. **`reservation_reminder_loop` filter.** The query uses
   `"reminded_at": {"$in": [None]}` and `create_reservation` never sets
   `reminded_at`. This works: in MongoDB, `{field: {$in: [null]}}` matches
   documents where the field is missing, exactly like `{field: null}`.
   Reminders do fire.

2. **`lodash` pinned to `4.18.1`.** This is a real published version. Confirmed
   resolved from `registry.npmjs.org` in `package-lock.json` and present in
   `node_modules/lodash/package.json`.

3. **`menu_csv.py` cache invalidation.** It invalidates only `_menu_items_key`
   and not `_categories_key`, which looks incomplete — but the importer never
   creates categories. An unrecognised category name is skipped with an error
   (`routes/menu_csv.py:182`). Invalidating menu items alone is correct.

---

## Not assessed

- `routes/voice.py` (65 KB) and `routes/whatsapp.py` (25 KB) were not audited in
  depth.
- No production Sentry data, Cloud Run logs, or `error_logs` contents were
  available. Everything above is static analysis. Which of these actually fire
  in production, and at what rate, is unknown until P0-1 is fixed and the
  backend Sentry project starts receiving events.
