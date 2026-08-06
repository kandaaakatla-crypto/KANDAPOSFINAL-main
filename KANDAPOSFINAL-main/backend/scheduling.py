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


def resolve_item_schedule_state(item: dict, schedules: list[dict], now: datetime) -> tuple[float | None, bool]:
    """(discount_pct, hidden) for `item` given every schedule it belongs to.

    - `discount_pct`: from the first currently-active schedule that has one.
    - `hidden`: True if the item belongs to a restrict-availability schedule
      and none of its schedules are active right now.
    """
    member_of = [s for s in schedules if schedule_includes_item(s, item)]
    if not member_of:
        return None, False
    active = [s for s in member_of if is_schedule_active(s, now)]
    if active:
        discount = next((s["discount_pct"] for s in active if s.get("discount_pct")), None)
        return discount, False
    hidden = any(s.get("restrict_availability") for s in member_of)
    return None, hidden


def apply_discount(price: float, pct: float | None) -> float:
    if not pct:
        return price
    return round(price * (1 - float(pct) / 100), 2)


def discount_item_prices(item: dict, pct: float | None) -> dict:
    """Return a shallow copy of `item` with price/sizes/variants discounted by
    `pct`. Used for both menu display and (via the caller) checkout pricing,
    so the number a customer sees matches what they're charged."""
    if not pct:
        return item
    out = dict(item)
    if out.get("price") is not None:
        out["price"] = apply_discount(out["price"], pct)
    if out.get("sizes"):
        out["sizes"] = {k: apply_discount(v, pct) for k, v in out["sizes"].items()}
    if out.get("variants"):
        out["variants"] = [{**v, "price": apply_discount(v["price"], pct)} for v in out["variants"]]
    return out
