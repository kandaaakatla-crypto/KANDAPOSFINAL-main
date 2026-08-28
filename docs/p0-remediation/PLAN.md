# P0 remediation plan

Agreed 2026-08-28. Companion to `FINDINGS.md` — read that first, including the
**Retracted** section at the bottom.

Scope of this plan is the five P0 findings only. P1–P4 are recorded in
FINDINGS.md and are explicitly out of scope until every box below is checked.

## Status

| PR | Issue | Status |
|----|-------|--------|
| 1 | Test harness + CI (non-gating) | [ ] not started |
| 2 | P0-5 deactivated staff keep access | [ ] not started |
| 3 | P0-2 5xx dropped from `error_logs` | [ ] not started |
| 4 | P0-1 Sentry captures backend exceptions | [ ] not started |
| 5 | P0-3 cron loops duplicate across instances | [ ] not started |
| 6 | P0-4 flip the deploy gate | [ ] not started |

Update this table as each PR merges. Order is deliberate: easiest and lowest
blast radius first, so the process is proven on cheap changes before the
expensive ones.

---

## Rules that apply to every PR

1. One PR per row. Never combine two.
2. Write the regression test **first**. Run it against current `master` and
   confirm it fails. Paste the failing run and the passing run into the PR body.
   A test that has never failed proves nothing.
3. Branch from `master`, name it `p0/<n>-<slug>`.
4. Do not fix adjacent things you notice. Add them to FINDINGS.md and move on.
5. PR N+1 does not start until PR N is merged and validated.

---

## PR 1 — Test harness

**Branch:** `p0/1-test-harness`

There is currently no unit test layer (FINDINGS P0-4). Everything after this
depends on it, which is why it goes first despite not fixing a user-visible bug.

**Build:**

- `backend/tests/unit/` using FastAPI `TestClient`.
- A session fixture that connects to `MONGO_URL` (default
  `mongodb://localhost:27017`), creates a uniquely-named throwaway database,
  yields it, and drops it at teardown. Never reuse `DB_NAME` from `.env`.
- `.github/workflows/test.yml` running on pull requests and pushes to `master`,
  with a `mongo:7` service container. **It reports; it does not gate.** Gating
  is PR 6.
- Register an `integration` marker in `pytest.ini` and mark all 21 existing
  files with it, deselected by default, so the legacy live-server suite cannot
  redden CI before it has been triaged.

**One product-code change is unavoidable.** `TestClient`'s startup hook runs
`seed_all` and spawns all five background loops, including the SMS and email
senders. Add a `DISABLE_BACKGROUND_TASKS` env guard in `server.py`'s startup
hook and set it in the test fixture. This is the only non-test line in this PR.

**Definition of done:** `pytest backend/tests/unit` passes locally and in CI
against a clean Mongo; the legacy suite is deselected by default; no deploy
behavior has changed.

**Risk:** medium-low but the most likely PR to grow. Building a first test layer
against an app whose startup does real work always surfaces coupling. If it
sprawls past the harness plus the one env guard, stop and re-scope rather than
letting it absorb fixes that belong in later PRs.

---

## PR 2 — Deactivated staff keep access (P0-5)

**Branch:** `p0/2-staff-active-check`

**Change:** in `backend/auth.py` `get_current_user`, the staff branch must
reject `active is False`, mirroring what the dashboard branch already does.
Roughly three lines.

Correct against the cache by construction, since the check runs after the cache
read — but the test must cover the cached path explicitly, not just the cold
one.

**Tests:**
- create staff → authenticate → deactivate → assert the existing token now 401s.
- same, but prime the user cache with a request before deactivating, to prove
  the 60s TTL does not open a window.

**Risk:** low. Contained to one function. Watch for existing tests or seed data
where staff documents have no `active` field at all — absent must mean active,
not inactive, or every legacy user is locked out. Check `seed.py` and
`owner_routes.py:310` / `routes/brands.py:548`, none of which set `active` on
insert.

---

## PR 3 — 5xx dropped from `error_logs` (P0-2)

**Branch:** `p0/3-error-log-5xx`

**Change:** in `backend/ops.py`, split the condition so 401 is skipped and 5xx
is recorded. Roughly five lines.

**Tests:** mount a route that returns a 500 response (not raises); assert an
`error_logs` document is written with the right status. Assert 401 still writes
nothing. Assert an existing 4xx path still writes, so the fix does not
regress the branch that already worked.

**Risk:** low. Same file as PR 4, which is why they are sequential.

---

## PR 4 — Sentry captures backend exceptions (P0-1)

**Branch:** `p0/4-sentry-capture`

**Change:** in `backend/ops.py`'s exception handler, call
`sentry_sdk.capture_exception(exc)` before returning the 500. Add `release` to
`Sentry.init` in `server.py` and set tenant context on scope.

**Do not re-raise.** See the fix note in FINDINGS P0-1: re-raising hands the
request to Starlette's `ServerErrorMiddleware`, which returns plain-text
`Internal Server Error` instead of the `{"detail": ...}` JSON the frontend's
axios interceptors expect. Explicit capture changes response behavior by zero
bytes.

**Tests:** install a fake Sentry transport in the fixture, force an unhandled
exception in a test route, assert exactly one event was captured and that the
response body is still the JSON `{"detail": "Internal server error"}` shape.
That second assertion is the one that protects the frontend contract.

**Risk:** low-medium. The only subtlety is the test transport. Do not assert on
Sentry internals beyond "an event arrived" — that couples the suite to an SDK
version.

---

## PR 5 — Cron loops duplicate across instances (P0-3)

**Branch:** `p0/5-cron-single-writer`

Largest surface of the five. Four loops across three files.

**Change:** atomic claims in Mongo, no new infrastructure. See the fix note in
FINDINGS P0-3 for the exact pattern and for why a Redis lock was considered and
rejected.

- `background_tasks.py` — `daily_rollup_cron_loop` and `birthday_bonus_loop`
  claim via `cron_state` with a `$ne` filter and `upsert=True`; catch
  `DuplicateKeyError` as "lost the race, skip."
- `routes/digest.py` — `digest_scheduler_loop` claims per tenant. Needs a
  `last_sent_date` field to claim against; the existing `last_sent_at` timestamp
  is not usable as an atomic filter.
- `sms_service.py` — `reservation_reminder_loop` claims per row with
  `find_one_and_update({id, reminded_at: None}, {$set: {reminded_at: now}})`.
  Only the winner sends. This removes the need for a loop-level lock entirely
  and is the cleanest of the four.
- Also fix the per-customer birthday guard to be conditional in the same update
  rather than filtered in Python.

**Tests:** for each loop, simulate two concurrent instances against the same
database and assert exactly one send / one credit. These must be real
concurrency tests (`asyncio.gather` on two loop bodies), not two sequential
calls — a sequential test passes against the current broken code and proves
nothing.

**Risk:** medium, and the highest-value fix here. Note that
`reservation_reminder_loop` currently marks `reminded_at` *after* sending;
claiming first inverts that, so a send that fails after a successful claim will
not be retried. That is the correct trade for an SMS (better missed than
duplicated) but it is a deliberate behavior change and should be called out in
the PR body.

---

## PR 6 — Flip the deploy gate (P0-4)

**Branch:** `p0/6-gate-deploys`

**Change:** add `needs: [test]` to the deploy job in
`.github/workflows/deploy-backend.yml`. One line.

Do this last, once the suite from PR 1 has been green across five real PRs and
is trusted. Consider also removing `CI: false` from the frontend workflows in a
follow-up, but that will surface pre-existing lint warnings and belongs in its
own PR, not this one.

**Risk:** low to write, highest consequence to get wrong — a flaky suite now
blocks all deploys. Trivially revertible.

---

## What "done" means

All six boxes checked, `pytest backend/tests/unit` green in CI, no deploy
possible without it, and the backend Sentry project receiving real events.

At that point the P0s are closed. Whether that means the system is error-free is
a different question and the honest answer is no — see the "Not assessed"
section of FINDINGS.md. The value of finishing this list is that from here on,
a new error is a new error rather than one more symptom of the same five causes.

## Confidence, as agreed

- The five P0 diagnoses are correct: **97%**. Each traces to source read during
  the audit, including the sentry-sdk and `@sentry/browser` internals.
- This plan clears all five with passing regression tests: **93%**. The gap is
  almost entirely PR 1.
- That closing the P0s means "no errors left": **not claimed, and deliberately
  so.** No number above 50 is defensible on that until the harness exists and
  Sentry has seen live traffic. PRs 1 and 6 are what start making it knowable.
