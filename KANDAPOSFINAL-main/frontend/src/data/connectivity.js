import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";

// `navigator.onLine`/the browser's online/offline events are what the web
// build and the future Electron shell use — accurate enough there (both run
// on Chromium with a real network stack under them). Android's WebView
// implements the same API but it's known to be unreliable (it can report
// "online" while only connected to a captive portal, or lag behind an
// actual disconnect) — @capacitor/network reads the OS-level connectivity
// state directly, so native platforms get that instead.
const isNative = Capacitor.isNativePlatform();

export async function isOnline() {
  if (isNative) {
    const status = await Network.getStatus();
    return status.connected;
  }
  if (typeof navigator === "undefined" || !("onLine" in navigator)) return true;
  return navigator.onLine;
}

// Subscribes to connectivity changes; `onChange(online: boolean)` fires on
// every transition. Returns an unsubscribe function.
export function subscribeConnectivity(onChange) {
  if (isNative) {
    let handle;
    let cancelled = false;
    Network.addListener("networkStatusChange", (status) => onChange(status.connected)).then(
      (h) => {
        if (cancelled) h.remove();
        else handle = h;
      },
    );
    return () => {
      cancelled = true;
      handle?.remove();
    };
  }
  const goOnline = () => onChange(true);
  const goOffline = () => onChange(false);
  window.addEventListener("online", goOnline);
  window.addEventListener("offline", goOffline);
  return () => {
    window.removeEventListener("online", goOnline);
    window.removeEventListener("offline", goOffline);
  };
}
