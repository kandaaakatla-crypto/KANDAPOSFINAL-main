// One date format everywhere, always in IST (the business's time zone), not the
// viewing device's: "3 Oct 2026, 10:54 am IST".
const TZ = "Asia/Kolkata";

export function fmtDate(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
}

export function fmtDateTime(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "—";
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ }).toLowerCase();
  return `${fmtDate(iso)}, ${time} IST`;
}
