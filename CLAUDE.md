# Kanda POS — working notes for Claude Code

## Repo layout

Git root is this directory. The application lives one level down in
`KANDAPOSFINAL-main/` (backend + frontend). CI workflows are at
`.github/workflows/` here at the root, and they reference paths as
`KANDAPOSFINAL-main/backend/...`.

- `KANDAPOSFINAL-main/backend` — FastAPI + Motor/MongoDB, deployed to Cloud Run
  in two regions (asia-south1 = HTTP API, us-central1 = WebSocket).
- `KANDAPOSFINAL-main/frontend` — React 19 + CRA/craco, ships to web,
  Electron (Windows) and Capacitor (Android).

## Active work: P0 remediation

A read-only audit was completed on 2026-08-28 in a separate Claude session
(Cowork, cloud sandbox). That session made **no code changes**. Its output is
checked in here:

- **`docs/p0-remediation/FINDINGS.md`** — 19 confirmed issues, the evidence for
  each P0, and three findings that were investigated and **retracted**. Read the
  retractions before acting on anything: they are things that look like bugs and
  are not.
- **`docs/p0-remediation/PLAN.md`** — the agreed remediation plan. Six PRs,
  strictly sequential, easiest to hardest. Start at PR 1.

Track progress by editing the status boxes in `PLAN.md` as each PR merges.

## Working rules for this effort

1. **One PR per issue.** Never combine two fixes in one branch — the whole point
   of the sequencing is that a bad PR can be scrapped without touching anything
   else.
2. **Regression test first.** Write the test, run it against current `master`,
   and confirm it FAILS before writing the fix. A test that has never failed
   proves nothing. Paste both runs (failing, then passing) in the PR body.
3. **Do not skip ahead.** PR N+1 does not start until PR N is merged and
   validated. PR 1 (test harness) blocks everything.
4. **Do not "fix while you're in there."** If you spot something adjacent, add
   it to FINDINGS.md as a new entry and keep moving.

## Environment notes

- `backend/.env` and `frontend/.env` are gitignored and point at localhost.
  Local Mongo, not Atlas — a local test run cannot touch production data.
- `docker-compose.yml` (in `KANDAPOSFINAL-main/`) brings up mongo:7 + the
  backend for local parity. MongoDB Server 8.3 also appears to be installed
  natively on this Windows machine.
- The existing 21 files in `backend/tests/` are **integration tests against a
  live HTTP server**, not unit tests. They need a running backend plus a seeded
  demo tenant (PIN 1234). They cannot run in CI as-is. `conftest.py` still loads
  a dead Emergent-era path (`/app/frontend/.env`).
