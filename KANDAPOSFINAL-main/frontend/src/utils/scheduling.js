// Client-side mirror of backend/scheduling.py so the POS checkout preview
// shows the same day-part availability and time-based pricing the server
// would compute. A schedule owns its own category/item membership (assigned
// from the Dashboard's Schedules screen) rather than menu items carrying a
// schedule_id. The storefront (public ordering) still re-enforces this
// server-side since that channel is untrusted — POS staff are trusted, so
// this preview IS the pricing here, same trust model as the rest of the cart.

/** True if `schedule` is currently in its active day/time window.
 *
 * `now` is any real Date (its epoch value is timezone-agnostic). We convert
 * to IST wall-clock components ourselves via the epoch-shift + UTC-getter
 * trick, rather than `now.getHours()`/`now.getDay()` — those apply the
 * *runtime's* local timezone, which for a POS terminal or this dev sandbox
 * may not be IST, and schedules are always defined in IST (matching the
 * backend's `now_ist()`). */
export function isScheduleActive(schedule, now) {
  if (!schedule || schedule.active === false) return false;
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const days = schedule.days || [];
  const isoDay = ist.getUTCDay() === 0 ? 7 : ist.getUTCDay(); // JS: 0=Sun..6=Sat -> ISO 1=Mon..7=Sun
  if (days.length && !days.includes(isoDay)) return false;
  const [sh, sm] = schedule.start_time.split(":").map(Number);
  const [eh, em] = schedule.end_time.split(":").map(Number);
  const nowMin = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (startMin <= endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin; // overnight window
}

function scheduleIncludesItem(schedule, item) {
  return (schedule.item_ids || []).includes(item.id) || (schedule.category_ids || []).includes(item.catId);
}

/** [mode, value, hidden] for `item` given every schedule it belongs to. */
export function resolveItemScheduleState(item, schedules, now) {
  const memberOf = (schedules || []).filter((s) => scheduleIncludesItem(s, item));
  if (!memberOf.length) return [null, null, false];
  const active = memberOf.filter((s) => isScheduleActive(s, now));
  if (active.length) {
    const priced = active.find((s) => s.pricing_mode === "percent" || s.pricing_mode === "fixed");
    if (priced) {
      const value = priced.pricing_mode === "percent" ? priced.discount_pct : priced.fixed_price;
      if (value != null) return [priced.pricing_mode, value, false];
    }
    return [null, null, false];
  }
  const hidden = memberOf.some((s) => s.restrict_availability);
  return [null, null, hidden];
}

function transformPrice(price, mode, value) {
  if (mode === "percent") return Math.round(price * (1 - value / 100) * 100) / 100;
  if (mode === "fixed") return Math.round(value * 100) / 100;
  return price;
}

/** Recompute a menu item's price/sizes/variants/available for "right now",
 * given the full schedules list. Items with no matching schedule pass
 * through unchanged (same object reference, no extra render churn). */
export function applyScheduleToItem(item, schedules, now) {
  const [mode, value, hidden] = resolveItemScheduleState(item, schedules, now);
  if (hidden) return { ...item, available: false };
  if (!mode || value == null) return item;
  const out = { ...item, _onSchedule: true, _pricingMode: mode, _pricingValue: value };
  if (out.price != null) out.price = transformPrice(out.price, mode, value);
  if (out.sizes) out.sizes = { sm: transformPrice(out.sizes.sm, mode, value), md: transformPrice(out.sizes.md, mode, value), lg: transformPrice(out.sizes.lg, mode, value) };
  if (out.variants) out.variants = out.variants.map((v) => ({ ...v, price: transformPrice(v.price, mode, value) }));
  return out;
}
