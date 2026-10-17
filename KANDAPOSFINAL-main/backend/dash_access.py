"""Dashboard role access — which stores and which details each dashboard
user (owner / area manager / manager) can reach, enforced server-side.

Two independent axes, both owner-controlled:

* **Stores.** A store is a tenant. The owner reaches their home store plus
  every store under their brand. A manager or area manager reaches only the
  stores listed in their `store_ids` (their home store is always included).
  A manager is held to exactly one store; an area manager can have several.
  Checked on every request (`assert_store_access`), so an owner removing a
  store from someone's list cuts them off immediately, not when their token
  expires.

* **Details.** `PERMISSIONS` is the list of dashboard sections an owner can
  switch on or off per person. Each key covers a fixed set of
  (HTTP method, route template) pairs in `_RULES`; `enforce_dash_permissions`
  is mounted on the whole `/api` router and returns 403 when a dashboard
  token hits a rule its user lacks. Owners always have everything. POS staff
  (PIN) tokens are not dashboard tokens and are never affected.
"""
from typing import Dict, Iterable, List, Optional, Set

import jwt
from fastapi import HTTPException
from starlette.requests import HTTPConnection

OWNER = "owner"
AREA_MANAGER = "area_manager"
MANAGER = "manager"

# key -> (label, default for area_manager, default for manager). Defaults
# mirror what the dashboard nav already showed each role before owners could
# change them, so existing accounts keep the access they had.
PERMISSIONS: Dict[str, tuple] = {
    "reports": ("Sales & reports", True, True),
    "payroll": ("Payroll & labour cost", True, False),
    "staff": ("Add / edit staff", True, True),
    "customers": ("Customer list", True, True),
    "customer_admin": ("Delete / restore customers & send SMS", True, False),
    "loyalty": ("Loyalty program", True, False),
    "gift_cards": ("Gift cards", True, False),
    "coupons": ("Coupons", True, True),
    "menu": ("Edit menu", True, True),
    "inventory": ("Edit inventory & suppliers", True, True),
    "settings": ("Store settings & features", True, False),
    "pricing": ("Surge / peak pricing rules", True, False),
}

_ALL = ("GET", "POST", "PUT", "PATCH", "DELETE")
_WRITE = ("POST", "PUT", "PATCH", "DELETE")

# (permission, methods, route template). Templates are FastAPI's own
# `route.path`, so a renamed or new route has to be added here on purpose.
# Endpoints the POS checkout needs (customer search/create, loyalty and
# gift-card lookup, coupon apply) are deliberately absent.
_RULES = [
    ("reports", ("GET",), "/api/reports/summary"),
    ("reports", ("GET",), "/api/reports/daily-rollup"),
    ("reports", ("POST",), "/api/reports/daily-rollup/rebuild"),
    ("reports", ("GET",), "/api/reports/menu-engineering"),
    ("reports", ("GET",), "/api/reports/channels"),
    ("reports", ("GET",), "/api/reports/food-cost"),
    ("reports", _ALL, "/api/digest/config"),
    ("reports", ("GET",), "/api/digest/preview"),
    ("reports", ("POST",), "/api/digest/send-now"),

    ("payroll", ("GET",), "/api/payroll/summary"),
    ("payroll", ("GET",), "/api/payroll/summary.csv"),
    ("payroll", ("GET",), "/api/reports/labour"),

    ("staff", ("POST",), "/api/staff"),
    ("staff", ("PUT", "DELETE"), "/api/staff/{user_id}"),

    ("customers", ("GET",), "/api/customers"),
    ("customers", ("PUT",), "/api/customers/{customer_id}"),
    ("customer_admin", ("GET",), "/api/customers/trash"),
    ("customer_admin", ("DELETE",), "/api/customers/{customer_id}"),
    ("customer_admin", ("POST",), "/api/customers/{customer_id}/restore"),
    ("customer_admin", ("POST",), "/api/sms/send"),
    ("customer_admin", ("POST",), "/api/sms/broadcast"),
    ("customer_admin", ("GET",), "/api/sms/history"),

    ("loyalty", ("PUT",), "/api/loyalty/config"),
    ("loyalty", ("GET",), "/api/loyalty/overview"),
    ("loyalty", ("GET",), "/api/loyalty/txns"),
    ("loyalty", ("POST",), "/api/customers/{customer_id}/loyalty/adjust"),

    ("gift_cards", ("GET", "POST"), "/api/gift-cards"),
    ("gift_cards", ("PATCH",), "/api/gift-cards/{card_id}/cancel"),

    ("coupons", ("GET", "POST"), "/api/coupons"),
    ("coupons", ("PATCH", "DELETE"), "/api/coupons/{coupon_id}"),

    ("menu", _WRITE, "/api/menu/categories"),
    ("menu", _WRITE, "/api/menu/categories/{cat_id}"),
    ("menu", _WRITE, "/api/menu/categories/reorder"),
    ("menu", _WRITE, "/api/menu/items"),
    ("menu", _WRITE, "/api/menu/items/{item_id}"),
    ("menu", _WRITE, "/api/menu/items/{item_id}/availability"),
    ("menu", _WRITE, "/api/menu/items/{item_id}/recipes"),
    ("menu", ("POST",), "/api/menu/import"),
    ("menu", _WRITE, "/api/menu/schedules"),
    ("menu", _WRITE, "/api/menu/schedules/{schedule_id}"),

    ("inventory", ("POST",), "/api/inventory"),
    ("inventory", ("PATCH", "DELETE"), "/api/inventory/{item_id}"),
    ("inventory", ("PATCH",), "/api/inventory/{item_id}/adjust"),
    ("inventory", ("POST",), "/api/inventory/{item_id}/transfer"),
    ("inventory", ("POST",), "/api/inventory/{item_id}/reorder"),
    ("inventory", ("POST",), "/api/suppliers"),
    ("inventory", ("PATCH", "DELETE"), "/api/suppliers/{supplier_id}"),

    ("settings", ("PATCH",), "/api/tenant/features"),
    ("settings", ("PUT",), "/api/tenant/online-pause"),
    ("settings", ("PUT",), "/api/tenant/sales-target"),
    ("settings", ("POST", "DELETE"), "/api/tenant/store/branding"),
    ("settings", ("GET",), "/api/integrations/website"),
    ("settings", ("POST", "DELETE"), "/api/integrations/website/key"),
    ("settings", ("PUT",), "/api/voice/config"),
    ("settings", ("POST",), "/api/voice/configure-twilio"),
    ("settings", ("POST",), "/api/voice/numbers/purchase"),

    # Surge pricing routes arrive with PR #42 (routes/surge.py); these rules
    # start enforcing the moment that lands. Drop them from
    # _AWAITING_ROUTES once it has merged.
    ("pricing", ("POST",), "/api/pricing/surge-rules"),
    ("pricing", ("PUT", "DELETE"), "/api/pricing/surge-rules/{rule_id}"),
]
_AWAITING_ROUTES = {"/api/pricing/surge-rules", "/api/pricing/surge-rules/{rule_id}"}

# Never delegable: these move money or change what the owner pays for.
_OWNER_ONLY = [
    (("POST",), "/api/locations"),
    (("PATCH", "DELETE"), "/api/locations/{loc_id}"),
    (("POST",), "/api/payments/purchase-location"),
]

_RULE_INDEX: Dict[tuple, str] = {}
for _perm, _methods, _path in _RULES:
    for _m in _methods:
        _RULE_INDEX[(_m, _path)] = _perm
_OWNER_ONLY_INDEX: Set[tuple] = {(m, p) for ms, p in _OWNER_ONLY for m in ms}


def role_defaults(dash_role: Optional[str]) -> Dict[str, bool]:
    if dash_role == OWNER:
        return {k: True for k in PERMISSIONS}
    col = 1 if dash_role == AREA_MANAGER else 2
    return {k: bool(v[col]) for k, v in PERMISSIONS.items()}


def effective_permissions(du: dict) -> Dict[str, bool]:
    """Role defaults overlaid with the owner's per-person choices. Unknown
    keys in the stored doc are ignored; owners can't be narrowed."""
    perms = role_defaults(du.get("dash_role"))
    if du.get("dash_role") == OWNER:
        return perms
    for k, v in (du.get("permissions") or {}).items():
        if k in perms:
            perms[k] = bool(v)
    return perms


def clean_permissions(raw: Optional[dict]) -> Dict[str, bool]:
    return {k: bool(v) for k, v in (raw or {}).items() if k in PERMISSIONS}


def assigned_store_ids(du: dict) -> List[str]:
    """Stores a manager / area manager was given, home store first."""
    ids = [du["tenant_id"]]
    for sid in du.get("store_ids") or []:
        if sid not in ids:
            ids.append(sid)
    return ids


async def owner_store_ids(db, du: dict) -> List[str]:
    """Every store an owner controls: their home store plus every store
    under their brand."""
    ids = [du["tenant_id"]]
    if du.get("brand_id"):
        async for t in db.tenants.find({"brand_id": du["brand_id"]}, {"_id": 0, "id": 1}):
            if t["id"] not in ids:
                ids.append(t["id"])
    return ids


async def accessible_store_ids(db, du: dict) -> List[str]:
    if du.get("dash_role") == OWNER:
        return await owner_store_ids(db, du)
    return assigned_store_ids(du)


async def assert_store_access(db, du: dict, tenant_id: Optional[str]) -> None:
    """Raise 401 if the dashboard user can no longer act on `tenant_id` (the
    store their token is scoped to). The home store needs no lookup; only a
    switched-to store costs a query, and only for owners."""
    if not tenant_id or tenant_id == du["tenant_id"]:
        return
    if du.get("dash_role") == OWNER:
        if du.get("brand_id"):
            t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "brand_id": 1})
            if t and t.get("brand_id") == du["brand_id"]:
                return
    elif tenant_id in (du.get("store_ids") or []):
        return
    raise HTTPException(status_code=401, detail="You no longer have access to this store")


def _route_key(conn: HTTPConnection) -> Optional[tuple]:
    if conn.scope.get("type") != "http":
        return None  # websockets carry their own auth
    route = conn.scope.get("route")
    path = getattr(route, "path", None)
    if not path:
        return None
    return (conn.scope["method"].upper(), path)


async def enforce_dash_permissions(request: HTTPConnection) -> None:
    """Router-level dependency on `/api`. A no-op for anything that isn't a
    dashboard token hitting a gated route — the route's own auth handles
    missing/invalid tokens. Typed HTTPConnection (not Request) so the
    websocket routes under /api can resolve it too."""
    key = _route_key(request)
    if key is None:
        return
    perm = _RULE_INDEX.get(key)
    owner_only = key in _OWNER_ONLY_INDEX
    if perm is None and not owner_only:
        return
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return
    from auth import _secret, JWT_ALG
    try:
        payload = jwt.decode(auth[7:], _secret(), algorithms=[JWT_ALG])
    except jwt.InvalidTokenError:
        return
    if not payload.get("dash"):
        return
    from db import get_db
    du = await get_db().dashboard_users.find_one(
        {"id": payload.get("sub")}, {"_id": 0, "dash_role": 1, "permissions": 1},
    )
    if not du:
        return  # get_current_user rejects this on the route itself
    if du.get("dash_role") == OWNER:
        return
    if owner_only:
        raise HTTPException(status_code=403, detail="Only the owner can do this")
    if not effective_permissions(du).get(perm):
        label = PERMISSIONS[perm][0]
        raise HTTPException(status_code=403, detail=f"Your owner hasn't given you access to {label}")


def all_rule_paths() -> Iterable[str]:
    """For the test that keeps `_RULES` in sync with the real routes."""
    for _perm, _methods, path in _RULES:
        if path not in _AWAITING_ROUTES:
            yield path
    for _methods, path in _OWNER_ONLY:
        yield path
