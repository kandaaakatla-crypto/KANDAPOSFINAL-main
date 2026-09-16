// Light/dark mode for the POS/Dashboard/Owner Portal/KDS surfaces (the
// landing page and storefront customer-ordering pages have their own
// separate, unaffected theme systems). Always defaults to light — nobody's
// experience changes until they explicitly toggle, and the choice then
// persists per-device across every surface that shares this app shell.
const KEY = "kanda_theme_v1"; // "light" | "dark"

export function getTheme() {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore — theme just won't persist this session */
  }
}

export function toggleTheme() {
  const next = getTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}
