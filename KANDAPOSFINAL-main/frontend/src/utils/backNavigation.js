// Where "back" goes from each POS screen. Shared by the Android hardware
// back button and the on-screen back arrow in the POS header, so both
// always agree.
//
//   home     — a starting screen; back should not silently leave the app
//   navigate — a fixed parent screen (every POS section's parent is the till)
//   history  — anywhere else, behave like a browser back

const POS_SECTIONS = new Set(["orders", "tables", "menu", "dispatch", "workforce"]);

export function backActionFor(pathname) {
  const parts = (pathname || "/").split("/").filter(Boolean);

  if (parts.length === 0) return { type: "home" };
  // /pos/login, /pos/:slug/login, /pos/:slug/clock
  if (parts[0] === "pos") {
    if (parts.length === 2 && parts[1] === "login") return { type: "home" };
    if (parts.length === 3 && parts[2] === "login") return { type: "home" };
    if (parts.length === 3 && parts[2] === "clock") return { type: "navigate", to: `/${parts[1]}/pos` };
    return { type: "history" };
  }
  // /:slug/pos and /:slug/<section>
  if (parts.length === 2) {
    if (parts[1] === "pos") return { type: "home" };
    if (POS_SECTIONS.has(parts[1])) return { type: "navigate", to: `/${parts[0]}/pos` };
  }
  return { type: "history" };
}
