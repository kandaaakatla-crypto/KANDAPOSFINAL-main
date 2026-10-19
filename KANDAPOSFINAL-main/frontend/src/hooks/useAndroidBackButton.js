import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { toast } from "sonner";
import { backActionFor } from "../utils/backNavigation";

// Without a listener, Android's back button walks the WebView history, which
// on the POS means stepping back into the PIN screen or out of the app
// mid-shift. This gives it the order staff expect: close the open sheet or
// dialog first, then go to the parent screen, and only leave the app after a
// second press on a starting screen. Web and Electron are untouched.
const EXIT_WINDOW_MS = 2000;

export default function useAndroidBackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  // The listener is registered once; refs keep it reading the current route.
  const pathRef = useRef(location.pathname);
  const lastHomePressRef = useRef(0);
  pathRef.current = location.pathname;

  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return undefined;

    let handle;
    let cancelled = false;
    CapApp.addListener("backButton", ({ canGoBack }) => {
      // Radix dialogs and sheets close on Escape.
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return;
      }
      const action = backActionFor(pathRef.current);
      if (action.type === "navigate") {
        navigate(action.to, { replace: true });
        return;
      }
      if (action.type === "history" && canGoBack) {
        window.history.back();
        return;
      }
      const now = Date.now();
      if (now - lastHomePressRef.current < EXIT_WINDOW_MS) {
        CapApp.exitApp();
        return;
      }
      lastHomePressRef.current = now;
      toast("Press back again to exit");
    }).then((h) => {
      if (cancelled) h.remove();
      else handle = h;
    }).catch(() => {
      // Plugin missing from an older native build: keep Android's default.
    });

    return () => {
      cancelled = true;
      if (handle) handle.remove();
    };
  }, [navigate]);
}
