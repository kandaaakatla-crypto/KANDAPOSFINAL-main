import React from "react";

// Extracted from the STATUS_META-style {label, color, bg} pattern that was
// hand-duplicated in OrdersScreen.jsx, DispatchScreen.jsx and TenantsList.jsx
// — same shape, same color convention, now one component instead of three.
const TONES = {
  success: { color: "#22c55e", bg: "#13271a" },
  danger: { color: "#f87171", bg: "#321519" },
  warning: { color: "#f59e0b", bg: "#2a2210" },
  info: { color: "#3b82f6", bg: "#14233f" },
  special: { color: "#a855f7", bg: "#2a1a3a" },
  neutral: { color: "var(--pos-muted)", bg: "var(--pos-panel-2)" },
};

export default function StatusChip({ label, tone = "neutral", className = "" }) {
  const t = TONES[tone] || TONES.neutral;
  return (
    <span
      className={`text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide whitespace-nowrap ${className}`}
      style={{ background: t.bg, color: t.color }}
    >
      {label}
    </span>
  );
}
