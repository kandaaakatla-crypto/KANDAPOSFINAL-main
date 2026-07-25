import React, { useEffect, useState } from "react";
import { onboardingApi } from "../../api/client";
import { CheckCircle2, Circle, X, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { usePos } from "../../store/PosContext";

/**
 * Top-of-screen checklist for new tenants. Shown only to Managers and only
 * until either the checklist is complete or the manager dismisses it.
 */
export default function OnboardingBanner() {
  const { staffUser } = usePos();
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (staffUser?.role !== "Manager") return;
    onboardingApi.status().then(setStatus).catch(() => setStatus(null));
  }, [staffUser?.role]);

  if (!status || status.completed) return null;

  const items = [
    { key: "has_extra_staff", label: "Add your real employees", route: "/biz/staff", done: status.has_extra_staff },
    { key: "has_menu", label: "Confirm your menu is set up", route: "/menu", done: status.has_menu },
    { key: "has_location", label: "Verify your store location", route: "/biz/locations", done: status.has_location },
    { key: "has_real_orders", label: "Take your first paid order", route: "/", done: status.has_real_orders },
  ];
  const doneCount = items.filter((i) => i.done).length;

  const dismiss = async () => {
    setBusy(true);
    try { await onboardingApi.dismiss(); setStatus({ ...status, completed: true }); } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl p-3 mx-3 mt-3" data-testid="onboarding-banner"
      style={{ background: "linear-gradient(135deg, #1a2a4a 0%, #0f1828 100%)", border: "1px solid var(--pos-border)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4" style={{ color: "var(--pos-accent)" }} />
          <div>
            <div className="text-sm font-bold text-white">Get Kanda fully set up — {doneCount}/{items.length} done</div>
            <div className="text-[10px]" style={{ color: "var(--pos-muted)" }}>Knock these out to unlock the full POS experience.</div>
          </div>
        </div>
        <button data-testid="onboarding-dismiss" onClick={dismiss} disabled={busy} className="pos-btn p-1 rounded" style={{ color: "var(--pos-muted)" }}>
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
        {items.map((it) => (
          <button key={it.key} data-testid={`onboarding-${it.key}`} onClick={() => navigate(it.route)} disabled={it.done}
            className="pos-btn flex items-center gap-2 rounded-md px-2 py-1.5 text-left"
            style={{ background: it.done ? "#0e2515" : "var(--pos-panel-2)", border: `1px solid ${it.done ? "#1d4d2d" : "var(--pos-border)"}`, opacity: it.done ? 0.7 : 1 }}>
            {it.done ? <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: "#86efac" }} /> : <Circle className="w-4 h-4 shrink-0" style={{ color: "var(--pos-muted)" }} />}
            <span className="text-xs text-white">{it.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
