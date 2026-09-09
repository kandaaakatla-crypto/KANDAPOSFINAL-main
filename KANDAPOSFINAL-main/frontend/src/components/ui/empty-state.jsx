import React from "react";

// Every "no data yet" case in the app used to be its own one-line muted
// sentence, hand-duplicated per screen. This is the shared shape, extended
// with an optional title and CTA so an empty state can also be an
// onboarding trigger, not just a dead end.
export default function EmptyState({ icon: Icon, title, description, action, testid }) {
  return (
    <div className="rounded-xl p-8 text-center" style={{ background: "var(--pos-panel)", border: "1px dashed var(--pos-border)" }} data-testid={testid}>
      {Icon ? <Icon className="w-6 h-6 mx-auto mb-3" style={{ color: "var(--pos-muted)" }} /> : null}
      {title ? <div className="text-sm font-bold mb-1" style={{ color: "var(--pos-text)" }}>{title}</div> : null}
      {description ? <p className="text-xs" style={{ color: "var(--pos-muted)" }}>{description}</p> : null}
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="pos-btn mt-4 h-9 px-4 rounded-md text-xs font-bold text-white"
          style={{ background: "var(--pos-accent)" }}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
