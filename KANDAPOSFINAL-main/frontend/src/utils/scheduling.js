// Client-side mirror of backend/scheduling.py so the POS checkout preview
// shows the same day-part availability and happy-hour pricing the server
// would compute. A schedule owns its own category/item membership (assigned
// from the Dashboard's Schedules screen) rather than menu items carrying a
// schedule_id. The storefront (public ordering) still re-enforces this
// server-side since that channel is untrusted — POS staff are trusted, so
// this preview IS the pricing here, same trust model as the rest of the cart.

/** True if `schedule` is currently in its active day/time window. */
export function isScheduleActive(schedule, now) {
  if (!schedule || schedule.active === false) return false;
  const days = schedule.days || [];
  const isoDay = now.getDay() === 0 ? 7 : now.getDay(); // JS: 0=Sun..6=Sat -> ISO 1=Mon..7=Sun
  if (days.length && !days.includes(isoDay)) return false;
  const [sh, sm] = schedule.start_time.split(":").map(Number);
  const [eh, em] = schedule.end_time.split(":").map(Number);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (startMin <= endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin; // overnight window
}

function scheduleIncludesItem(schedule, item) {
  return (schedule.item_ids || []).includes(item.id) || (schedule.category_ids || []).includes(item.catId);
}

/** (discountPct, hidden) for `item` given every schedule it belongs to. */
export function resolveItemScheduleState(item, schedules, now) {
  const memberOf = (schedules || []).filter((s) => scheduleIncludesItem(s, item));
  if (!memberOf.length) return [null, false];
  const active = memberOf.filter((s) => isScheduleActive(s, now));
  if (active.length) {
    const discount = active.find((s) => s.discount_pct)?.discount_pct ?? null;
    return [discount, false];
  }
  const hidden = memberOf.some((s) => s.restrict_availability);
  return [null, hidden];
}

function applyDiscount(price, pct) {
  if (!pct) return price;
  return Math.round(price * (1 - pct / 100) * 100) / 100;
}

/** Recompute a menu item's price/sizes/variants/available for "right now",
 * given the full schedules list. Items with no matching schedule pass
 * through unchanged (same object reference, no extra render churn). */
export function applyScheduleToItem(item, schedules, now) {
  const [discountPct, hidden] = resolveItemScheduleState(item, schedules, now);
  if (hidden) return { ...item, available: false };
  if (!discountPct) return item;
  const out = { ...item, _onSchedule: true, _discountPct: discountPct };
  if (out.price != null) out.price = applyDiscount(out.price, discountPct);
  if (out.sizes) out.sizes = { sm: applyDiscount(out.sizes.sm, discountPct), md: applyDiscount(out.sizes.md, discountPct), lg: applyDiscount(out.sizes.lg, discountPct) };
  if (out.variants) out.variants = out.variants.map((v) => ({ ...v, price: applyDiscount(v.price, discountPct) }));
  return out;
}
