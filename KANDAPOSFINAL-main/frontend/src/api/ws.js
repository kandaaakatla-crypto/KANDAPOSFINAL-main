/**
 * Lightweight WebSocket client for Kanda POS realtime updates.
 * Auto-reconnect with exponential backoff; the token is passed via query string.
 */
import { tokenStore } from "./client";

function wsUrl() {
  const base = process.env.REACT_APP_BACKEND_URL || "";
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
    socket = new WebSocket(`${wsUrl()}?token=${encodeURIComponent(t)}`);

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
