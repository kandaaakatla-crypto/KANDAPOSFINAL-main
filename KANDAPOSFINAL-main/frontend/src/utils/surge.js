// Aggregator surge / peak pricing (rules managed on Dashboard → Surge
// Pricing, stored by backend/routes/surge.py). A rule targets one
// aggregator or several (combined); every active rule matching the order's
// source stacks, so their percentages add up. Same trust model as day-part
// schedule pricing (utils/scheduling.js): POS staff are trusted, so the
// surged price computed here is what the order is charged.
import { isScheduleActive } from "./scheduling";

export const AGGREGATORS = [
  { id: "swiggy", label: "Swiggy", color: "#fc8019" },
  { id: "zomato", label: "Zomato", color: "#cb202d" },
  { id: "other", label: "Other aggregators" },
];

/** True if `rule` is switched on and inside its day/time window (IST) right now. */
export function isSurgeRuleActive(rule, now) {
  if (!rule || rule.active === false) return false;
  if (!rule.start_time || !rule.end_time) {
    // All-day rule: only the day-of-week filter applies (IST, as in scheduling.js).
    const days = rule.days || [];
    if (!days.length) return true;
    const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    const isoDay = ist.getUTCDay() === 0 ? 7 : ist.getUTCDay();
    return days.includes(isoDay);
  }
  return isScheduleActive(rule, now);
}

/** { pct, rules } — the combined markup for an order from `source` right now. */
export function activeSurge(rules, source, now) {
  const matching = (rules || []).filter((r) => (r.channels || []).includes(source) && isSurgeRuleActive(r, now));
  const pct = Math.round(matching.reduce((s, r) => s + (Number(r.pct) || 0), 0) * 100) / 100;
  return { pct, rules: matching };
}

/** Surged unit price, rounded half-up to the whole rupee (aggregator menus are priced in whole rupees). */
export function applySurge(price, pct) {
  if (!pct) return price;
  return Math.floor(price * (100 + pct) / 100 + 0.5 + 1e-9);
}
