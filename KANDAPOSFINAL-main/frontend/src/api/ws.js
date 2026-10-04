/**
 * Lightweight WebSocket client for Kanda POS realtime updates.
 * Auto-reconnect with exponential backoff; the token is passed via query string.
 */
import { tokenStore, tenantStore, deviceStore } from "./client";

function wsUrl() {
  // REACT_APP_WS_BACKEND_URL is a dedicated override for the WebSocket
  // connection only — Firebase Hosting's rewrite-to-Cloud-Run integration
  // (what REACT_APP_BACKEND_URL="" + relative /api paths resolve through
  // for every other request) doesn't proxy WebSocket upgrades at all, so
  // realtime needs a different path: api.kandapos.com, mapped directly to
  // the Cloud Run service via a Cloud Run domain mapping. Falls back to
  // REACT_APP_BACKEND_URL when unset (Android/Windows, or local dev).
  const base = process.env.REACT_APP_WS_BACKEND_URL || process.env.REACT_APP_BACKEND_URL || "";
  // Convert http(s) → ws(s)
  const wsBase = base.replace(/^http/i, "ws");
  return `${wsBase}/api/ws`;
}

export function connectWs(onEvent) {
  let socket = null;
  let attempt = 0;
  let closedByCaller = false;

  const open = () => {
    const t = tokenStore.get();
    if (!t || closedByCaller) return;
    // Staff sessions on an unlocked till are bound to it server-side; the
    // device token rides as a query param (WebSockets can't set headers).
    const slug = tenantStore.get();
    const device = slug && deviceStore.get(slug);
    socket = new WebSocket(`${wsUrl()}?token=${encodeURIComponent(t)}${device ? `&device=${encodeURIComponent(device)}` : ""}`);

    socket.onopen = () => { attempt = 0; };
    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        onEvent?.(msg);
      } catch { /* ignore non-JSON */ }
    };
    socket.onclose = () => {
      if (closedByCaller) return;
      attempt += 1;
      const wait = Math.min(15000, 500 * 2 ** Math.min(attempt, 5));
      setTimeout(open, wait);
    };
    socket.onerror = () => { /* will close → reconnect */ };
  };

  open();

  return () => {
    closedByCaller = true;
    try { socket?.close(); } catch { /* noop */ }
  };
}
