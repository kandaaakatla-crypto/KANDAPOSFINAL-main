"""Kanda POS — FastAPI app entrypoint.

Resource routes live under `/api/...` and are assembled in
`routes/__init__.py`. Cross-cutting routers (payments, receipts, websocket,
support, KDS, owner portal, subscriptions, ops) are mounted directly here
because they either need raw-app access or carry extra prefixes.
"""
from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import logging

import httpx
import sentry_sdk
from fastapi import FastAPI, HTTPException
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse

# Optional — unset SENTRY_DSN (e.g. local dev) leaves this a no-op, same
# graceful-degradation pattern as cache.py's Redis wiring. send_default_pii
# is deliberately left off: this app handles payment and customer PII in
# request bodies/headers that shouldn't leave the process by default.
if os.environ.get("SENTRY_DSN"):
    sentry_sdk.init(
        dsn=os.environ["SENTRY_DSN"],
        environment=os.environ.get("SENTRY_ENVIRONMENT", "production"),
        traces_sample_rate=0.1,
    )

from db import get_db, close as close_db
from seed import seed_all
from payments import payments_router
from receipts import receipts_router
from ws import ws_router
from owner_routes import owner_router
from owners import decode_token as decode_any_token, ISSUER as OWNER_ISSUER
from ops import install_ops_middleware, support_router, ops_router
from subscriptions import subscriptions_router
from kds import kds_router, owner_kds_router
from routes import api_router


logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("kanda")

app = FastAPI(title="Kanda POS API")


# Unauthenticated liveness/readiness probe for Cloud Run (and any other
# container platform) — deliberately outside /api and outside every
# middleware/auth chain above so it stays cheap and always answers.
@app.get("/healthz")
async def healthz():
    return {"ok": True}


# ----------------- Lifecycle -----------------
@app.on_event("startup")
async def on_startup():
    db = get_db()
    await seed_all(db)
    # Set by the unit-test fixture (backend/tests/unit/conftest.py) — a
    # TestClient boots this same startup hook on a throwaway database, and
    # these loops do real work (SMS, email, external Redis/WS connections)
    # that must never fire against test data.
    if os.environ.get("DISABLE_BACKGROUND_TASKS") == "1":
        logger.info("Kanda POS DB seeded / verified (background tasks disabled)")
        return
    # Start the reservation reminder background task (1h-before SMS reminders)
    import asyncio
    from sms_service import reservation_reminder_loop
    from routes.digest import digest_scheduler_loop
    from background_tasks import daily_rollup_cron_loop, birthday_bonus_loop, leads_digest_loop
    from ws import redis_subscriber_loop
    asyncio.create_task(reservation_reminder_loop(get_db))
    asyncio.create_task(digest_scheduler_loop(get_db))
    asyncio.create_task(daily_rollup_cron_loop(get_db))
    asyncio.create_task(birthday_bonus_loop(get_db))
    asyncio.create_task(leads_digest_loop(get_db))
    asyncio.create_task(redis_subscriber_loop())
    logger.info("Kanda POS DB seeded / verified + reminder loop started")


@app.on_event("shutdown")
async def on_shutdown():
    await close_db()


# ----------------- SPA soft-404 fix -----------------
# firebase.json's Hosting rewrite table forwards any path that isn't a real
# static asset or an explicitly listed app route here (as a catch-all,
# lowest-priority "run" rewrite) instead of the default static-shell
# rewrite, which would otherwise answer every dead link with the React app
# shell and an HTTP 200 — a "soft 404" search engines flag. Real /api/*
# 404s (and everything else, e.g. 405s) keep their normal JSON error body;
# only an actually-unmatched public route gets the HTML swap below.
_SOFT_404_FALLBACK_HTML = "<!doctype html><title>404 Not Found</title><h1>404 Not Found</h1>"


@app.exception_handler(StarletteHTTPException)
async def spa_soft_404_handler(request, exc):
    if exc.status_code == 404 and not request.url.path.startswith("/api/"):
        base = os.environ.get("PUBLIC_BASE_URL")
        if base:
            try:
                async with httpx.AsyncClient(timeout=5.0) as hc:
                    resp = await hc.get(f"{base}/index.html")
                if resp.status_code == 200:
                    return HTMLResponse(content=resp.text, status_code=404)
            except Exception:
                pass
        return HTMLResponse(content=_SOFT_404_FALLBACK_HTML, status_code=404)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


# ----------------- Auditor read-only guard -----------------
# When the Platform Owner impersonates a tenant in `auditor` mode the JWT
# carries `auditor=True`. Block every mutating verb across /api/ except the
# Razorpay verify webhook (kept whitelisted per product spec).
_AUDITOR_WRITE_WHITELIST = {"/api/payments/verify"}


@app.middleware("http")
async def auditor_readonly_guard(request, call_next):
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return await call_next(request)
    if request.url.path in _AUDITOR_WRITE_WHITELIST:
        return await call_next(request)
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            payload = decode_any_token(auth[7:])
            if payload.get("auditor") is True and payload.get("iss") == OWNER_ISSUER:
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Auditor session is read-only"},
                )
        except HTTPException:
            pass
        except Exception:
            pass
    return await call_next(request)


# ----------------- Mount routers -----------------
# Cross-cutting routers attach to the shared /api prefix on `api_router`.
api_router.include_router(payments_router)
api_router.include_router(receipts_router)
api_router.include_router(ws_router)
api_router.include_router(support_router)
api_router.include_router(kds_router)
# Owner-only ops + KDS-token routes are mounted under /api/owner/...
owner_router.include_router(ops_router)
owner_router.include_router(owner_kds_router, prefix="/tenants/{tenant_id}")
api_router.include_router(owner_router)
# Razorpay subscription webhook lives at /api/payments/razorpay/...
api_router.include_router(subscriptions_router, prefix="/payments/razorpay")

app.include_router(api_router)

# Audit + error capture wraps every /api/* request (including the
# auditor read-only guard above) — installed AFTER routes are wired.
install_ops_middleware(app)

app.add_middleware(
    CORSMiddleware,
    # Auth here is Bearer-token-only (see auth.py) — nothing relies on
    # cookies or other ambient credentials cross-origin, so this must stay
    # False. `allow_credentials=True` combined with a wildcard origin is
    # spec-invalid (browsers refuse to expose the response), and this app
    # has no case that actually needs it.
    allow_credentials=False,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
