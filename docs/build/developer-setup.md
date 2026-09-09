# Developer setup

**Audience:** anyone writing or reviewing code — you need repo access and a
local machine. You do **not** need any GitHub Secrets, GCP access, or the
Android/Windows signing credentials described in
[secrets-and-infrastructure.md](secrets-and-infrastructure.md) — everything
below runs against a throwaway local database and, for the frontend, real
demo data on production.

## Repo layout

Git root is `C:\KANDA POS\KANDAPOSFINAL-main`. The application lives one
level down:
- `KANDAPOSFINAL-main/backend` — FastAPI + Motor/MongoDB
- `KANDAPOSFINAL-main/frontend` — React 19 + CRA (via `craco`)

## Backend

### Install

```bash
cd KANDAPOSFINAL-main/backend
pip install -r requirements.txt
```

### Configure

`backend/server.py` auto-loads `backend/.env` on startup (gitignored — not
committed). Create one with at minimum:

```bash
MONGO_URL=mongodb://localhost:27017
DB_NAME=kanda_pos
JWT_SECRET=local-dev-secret-change-me
CORS_ORIGINS=*
PUBLIC_BASE_URL=http://localhost:3000
```

That's enough to boot the server and use the core POS/dashboard flows.
Everything else (Twilio SMS/WhatsApp/voice, Anthropic/OpenAI for the AI
assistant, Razorpay payments, Resend email, Sentry) is optional locally —
each integration degrades gracefully (silently disabled, not a crash) when
its variables are unset. The full variable reference, including which of
these you'd need to set to exercise a specific feature, is in
[secrets-and-infrastructure.md](secrets-and-infrastructure.md#backend-runtime-configuration).

### Get a local MongoDB

Two options:

**A — Docker (recommended, matches Cloud Run's container):**
```bash
cd KANDAPOSFINAL-main
docker compose up
```
Brings up `mongo:7` (port 27017, persisted volume) and the backend itself
(port 8000) together, using the same Dockerfile Cloud Run runs. This is
backend-only — it does not build or serve the frontend.

**B — Native Mongo + bare `uvicorn` (faster iteration, hot-reload-friendly):**
```bash
cd KANDAPOSFINAL-main/backend
uvicorn server:app --reload
```
Needs a Mongo instance reachable at whatever `MONGO_URL` your `.env` points
at — either a locally installed `mongod`, or point `MONGO_URL` at the
`docker compose up` Mongo container while running the backend natively
outside Docker.

### Run tests

```bash
cd KANDAPOSFINAL-main/backend
pytest tests/unit -v
```

This is the suite CI actually runs (`.github/workflows/test.yml`, on every PR
and push to `master`). It needs nothing but a reachable Mongo — the fixtures
boot the real app in-process, create a disposable database
(`kanda_test_<uuid>`), and disable all background tasks (SMS/email/Redis/WS
loops) automatically. No `.env` or API keys required.

**The other 21 files under `backend/tests/*.py`** (`test_iteration5_smoke.py`
etc.) are legacy integration tests, not run in CI. They're excluded by
default (`pytest.ini` sets `addopts = -m "not integration"`) and need a real
running server plus a seeded demo tenant (PIN `1234`) to do anything. If you
need to run one:
```bash
REACT_APP_BACKEND_URL=http://localhost:8000 pytest -m integration
```
with the backend already running against a seeded database. `conftest.py`
tries to load this URL from `/app/frontend/.env` first — a dead path left
over from the project's earlier hosting platform — so set it explicitly as
shown above rather than relying on that fallback.

## Frontend

### Install

```bash
cd KANDAPOSFINAL-main/frontend
npm ci --legacy-peer-deps
```

`--legacy-peer-deps` is required — there's a pre-existing peer-dependency
conflict (`date-fns` v4 vs. `react-day-picker`'s peer range) that a plain
`npm install`/`npm ci` refuses to resolve.

### Configure

Create `frontend/.env` (gitignored):
```bash
REACT_APP_BACKEND_URL=http://localhost:8000
```
Points the frontend at your local backend. Leave the other `REACT_APP_*`
variables (`REACT_APP_APP_TARGET`, `REACT_APP_WS_BACKEND_URL`,
`REACT_APP_SENTRY_DSN`) unset for normal web-app local dev — see
[release-and-builds.md](release-and-builds.md) for what they do when a
specific build target needs them.

**No local backend? Point at production instead.** There's no requirement to
run the backend locally to work on the frontend — for pure UI work, it's
often faster to run the frontend against the real deployed API with real
demo data:
```bash
REACT_APP_BACKEND_URL=https://api.kandapos.com PORT=3000 npm start
```
Demo credentials: dashboard owner login `owner@demo.com` /
`OwnerPass#2025`; POS staff PIN `1234` (Aarav Reddy, Manager). This only
gives you read-mostly access to the shared demo tenant — don't rely on it
for anything that needs a clean/isolated dataset.

### Run

```bash
npm start
```
Runs via `craco` (a CRA override — see `craco.config.js`), not plain
`react-scripts`. Hot-reloads on save.

### Build

```bash
CI=false npm run build
```
`CI=false` matters: CRA treats pre-existing ESLint warnings as build-failing
errors when `CI=true` (which every CI runner sets by default), even though
the same warnings don't fail a plain local build. Every deploy/build
workflow in this repo sets `CI: false` explicitly for this reason — match it
locally so your build result matches what CI will actually produce.

Runs `craco build` followed by `node scripts/prerender-seo.js` (a
post-build SEO prerender step for the marketing pages).

### Tests

```bash
npm test
```

## What you don't need for local dev

- Any GitHub Secret or Variable
- GCP / Cloud Run / Firebase access
- The Android keystore or Windows code-signing cert
- Redis (features using it degrade to single-instance/no-op behavior when
  `REDIS_URL` is unset)

If a task needs any of the above, it's covered in
[secrets-and-infrastructure.md](secrets-and-infrastructure.md) instead.
