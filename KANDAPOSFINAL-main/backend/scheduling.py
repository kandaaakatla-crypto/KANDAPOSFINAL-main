"""Day-part menu scheduling — shared by the POS-facing menu API and the
server-authoritative storefront checkout so both sides agree on whether a
schedule is "active" right now and what an item's price/availability should
be. A schedule owns its own category/item membership (assigned from the
Dashboard's Schedules screen) rather than menu items carrying a schedule_id.
"""
from datetime import datetime, time as dtime


def _parse_hm(s: str) -> dtime:
    h, m = s.split(":")
    return dtime(int(h), int(m))


def is_schedule_active(schedule: dict | None, now: datetime) -> bool:
    """True if `schedule` is currently in its active day/time window."""
    if not schedule or not schedule.get("active", True):
        return False
    days = schedule.get("days") or []
    if days and now.isoweekday() not in days:
        return False
    start = _parse_hm(schedule["start_time"])
    end = _parse_hm(schedule["end_time"])
    now_t = now.time()
    if start <= end:
        return start <= now_t < end
    # Overnight window wraps past midnight, e.g. 22:00 -> 02:00.
    return now_t >= start or now_t < end


def schedule_includes_item(schedule: dict, item: dict) -> bool:
    return item.get("id") in (schedule.get("item_ids") or []) or item.get("cat_id") in (schedule.get("category_ids") or [])


def resolve_item_schedule_state(item: dict, schedules: list[dict], now: datetime) -> tuple[str | None, float | None, bool]:
    """(pricing_mode, value, hidden) for `item` given every schedule it belongs to.

    - `pricing_mode`/`value`: from the first currently-active schedule with a
      "percent" or "fixed" pricing mode ("percent" -> value is the % off,
      "fixed" -> value is the flat ₹ price).
    - `hidden`: True if the item belongs to a restrict-availability schedule
      and none of its schedules are active right now.
    """
    member_of = [s for s in schedules if schedule_includes_item(s, item)]
    if not member_of:
        return None, None, False
    active = [s for s in member_of if is_schedule_active(s, now)]
    if active:
        priced = next((s for s in active if s.get("pricing_mode") in ("percent", "fixed")), None)
        if priced:
            value = priced.get("discount_pct") if priced["pricing_mode"] == "percent" else priced.get("fixed_price")
            if value is not None:
                return priced["pricing_mode"], value, False
        return None, None, False
    hidden = any(s.get("restrict_availability") for s in member_of)
    return None, None, hidden


def _transform_price(price: float, mode: str, value: float) -> float:
    if mode == "percent":
        return round(price * (1 - float(value) / 100), 2)
    if mode == "fixed":
        return round(float(value), 2)
    return price


def apply_schedule_pricing(item: dict, mode: str | None, value: float | None) -> dict:
    """Return a shallow copy of `item` with price/sizes/variants transformed
    per `mode` ("percent" scales, "fixed" replaces outright). Used for both
    menu display and (via the caller) checkout pricing, so the number a
    customer sees matches what they're charged."""
    if not mode or value is None:
        return item
    out = dict(item)
    if out.get("price") is not None:
        out["price"] = _transform_price(out["price"], mode, value)
    if out.get("sizes"):
        out["sizes"] = {k: _transform_price(v, mode, value) for k, v in out["sizes"].items()}
    if out.get("variants"):
        out["variants"] = [{**v, "price": _transform_price(v["price"], mode, value)} for v in out["variants"]]
    return out
