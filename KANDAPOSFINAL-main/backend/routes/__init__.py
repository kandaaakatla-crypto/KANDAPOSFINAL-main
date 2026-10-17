"""Aggregate Kanda POS resource routes under a single `/api` router.

Each sub-module owns one concern (auth, menu, tables, orders, etc.) and is
mounted *without* a path prefix so the final URL stays the same as the
original monolithic server.py (e.g. `/api/menu/items`, `/api/orders/...`).

Cross-cutting routers (payments, receipts, ws, KDS, support, owner,
subscriptions, ops) are still mounted directly in `server.py` because they
either need raw-app access (websocket) or extra prefixes (subscriptions).
"""
from fastapi import APIRouter, Depends

from dash_access import enforce_dash_permissions

from . import (
    auth, menu, tables, customers, inventory, orders, reports, reservations,
    menu_csv, staff, timeclock, shifts, waste, cashdrawer, tips, coupons,
    locations, prep, refunds, loyalty, onboarding, dash_auth, voice,
    digest, sms, whatsapp, plans, suppliers, storefront, payroll, brands,
    store_credit, gift_cards, menu_schedules, central_supply, leads, pos_devices, surge,
    website_orders, online_pause, sales_target,
)

# enforce_dash_permissions gates dashboard (owner / area manager / manager)
# tokens per section — see dash_access.py. A no-op for every other caller.
api_router = APIRouter(prefix="/api", dependencies=[Depends(enforce_dash_permissions)])

# Health probe lives here so /api/ returns a JSON heartbeat.
@api_router.get("/")
async def root():
    return {"service": "kanda-pos", "status": "ok"}


for module in (
    auth, menu, tables, customers, inventory, orders, reports, reservations,
    menu_csv, staff, timeclock, shifts, waste, cashdrawer, tips, coupons,
    locations, prep, refunds, loyalty, onboarding, dash_auth, voice,
    digest, sms, whatsapp, plans, suppliers, storefront, payroll, brands,
    store_credit, gift_cards, menu_schedules, central_supply, leads, pos_devices, surge,
    website_orders, online_pause, sales_target,
):
    api_router.include_router(module.router)
