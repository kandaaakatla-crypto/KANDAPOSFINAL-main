import React, { useEffect, useState } from "react";
import { billingApi } from "../../api/client";
import { AlertTriangle, X } from "lucide-react";

const DISMISS_KEY = "kanda_pos_billing_banner_dismissed_at";

function describe(state) {
  if (!state || state.ok === false) return null;
  if (!state.in_grace) return null;
  const reason = state.reason;
  if (reason === "no_plan") {
    return { tone: "info", label: "Demo mode — no active subscription. Ask your platform owner to enable billing." };
  }
  if (reason === "halted" || reason === "pending" || reason === "cancelled" || reason === "expired") {
    const until = state.grace_until ? new Date(state.grace_until) : null;
    const days = until ? Math.max(0, Math.ceil((until - new Date()) / 86400000)) : null;
    return {
      tone: "warn",
      label: `Payment ${reason} — POS access ends in ${days ?? "a few"} day${days === 1 ? "" : "s"}. Please renew to keep ringing orders.`,
    };
  }
  if (reason === "renewal_soon") {
    return { tone: "info", label: `Renewal in <3 days. Make sure your payment method is up to date.` };
  }
  return null;
}

/** Sticky soft-warning banner shown above POSLayout while the tenant is in the
 *  Razorpay grace window (status halted/pending/cancelled/expired). Dismiss state
 *  is per-day so the banner reappears every login until billing is fixed. */
export default function BillingBanner() {
  const [state, setState] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    const ts = parseInt(localStorage.getItem(DISMISS_KEY) || "0", 10);
    // Re-show 12 hours after dismiss.
    return ts && Date.now() - ts < 12 * 3600 * 1000;
  });

  useEffect(() => {
    let cancel = false;
    billingApi.status().then((s) => { if (!cancel) setState(s); }).catch(() => {});
    return () => { cancel = true; };
  }, []);

  const info = describe(state);
  if (!info || dismissed) return null;

  const palette = info.tone === "warn"
    ? { bg: "#3b2a13", text: "#fcd34d", border: "#a16207" }
    : { bg: "#0f2531", text: "#7dd3fc", border: "#075985" };

  return (
    <div data-testid="billing-banner" className="flex items-center justify-between px-4 py-2 text-xs font-semibold"
      style={{ background: palette.bg, color: palette.text, borderBottom: `1px solid ${palette.border}` }}>
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4" />
        <span>{info.label}</span>
      </div>
      <button data-testid="billing-banner-dismiss" onClick={() => {
        localStorage.setItem(DISMISS_KEY, String(Date.now()));
        setDismissed(true);
      }} className="h-7 px-2 rounded-md flex items-center gap-1 text-[11px]"
        style={{ background: "rgba(0,0,0,0.35)", color: "inherit" }}>
        <X className="w-3 h-3" /> Dismiss
      </button>
    </div>
  );
}
