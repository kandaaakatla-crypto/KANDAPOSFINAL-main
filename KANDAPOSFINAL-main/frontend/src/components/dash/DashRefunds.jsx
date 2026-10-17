import React, { useEffect, useMemo, useState } from "react";
import { Undo2, Ban, BadgePercent, ShieldAlert } from "lucide-react";
import { useDash } from "../../store/DashContext";
import EmptyState from "../ui/empty-state";

// Money that left the till after the sale: refunds, voids and discounts,
// with who did each one and why. Owner apps (Toast Now's Refunds / Voids /
// Discounts cards) lead with this because it is where staff mistakes and
// abuse show up first. Refunds and voids come from the refund log; discounts
// are read off the orders themselves.

const inr = (n) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

const RANGES = [
  { key: "today", label: "Today", days: 1 },
  { key: "week", label: "7 days", days: 7 },
];

// Start of the window in device-local time: today = since midnight,
// 7 days = since midnight six days ago.
function since(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

function when(iso, days) {
  const d = new Date(iso);
  const t = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  return days === 1 ? t : `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, ${t}`;
}

export default function DashRefunds() {
  const { api } = useDash();
  const [logs, setLogs] = useState(null);
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState("");
  const [range, setRange] = useState("today");
  const [tab, setTab] = useState("all");

  useEffect(() => {
    Promise.all([api.get("/refunds/log", { params: { limit: 500 } }), api.get("/orders")])
      .then(([l, o]) => { setLogs(l.data || []); setOrders(o.data || []); })
      .catch((e) => setError(e?.response?.data?.detail || "Could not load refunds"));
  }, [api]);

  const days = RANGES.find((r) => r.key === range).days;

  const data = useMemo(() => {
    const from = since(days);
    const inRange = (iso) => new Date(iso) >= from;
    const entries = (logs || []).filter((l) => inRange(l.at));
    const discounts = (orders || [])
      .filter((o) => !o.voided && (o.discount || 0) > 0 && inRange(o.placedAt))
      .map((o) => ({ id: `d-${o.id}`, kind: "discount", order_number: o.number, amount: o.discount, reason: o.coupon_code ? `Coupon ${o.coupon_code}` : "Manual discount", by_user_name: null, at: o.placedAt }));
    const sum = (arr) => arr.reduce((s, e) => s + (e.amount || 0), 0);
    const refunds = entries.filter((e) => e.kind === "refund");
    const voids = entries.filter((e) => e.kind === "void");
    // Per-person totals for refunds + voids — discounts carry no staff name.
    const byPerson = {};
    entries.forEach((e) => {
      const k = e.by_user_name || "Unknown";
      byPerson[k] = byPerson[k] || { name: k, count: 0, amount: 0 };
      byPerson[k].count += 1;
      byPerson[k].amount += e.amount || 0;
    });
    const all = [...entries, ...discounts].sort((a, b) => new Date(b.at) - new Date(a.at));
    return {
      totals: { refund: sum(refunds), void: sum(voids), discount: sum(discounts) },
      counts: { refund: refunds.length, void: voids.length, discount: discounts.length },
      people: Object.values(byPerson).sort((a, b) => b.amount - a.amount),
      all,
    };
  }, [logs, orders, days]);

  const shown = tab === "all" ? data.all : data.all.filter((e) => e.kind === tab);
  const KIND = {
    refund: { label: "Refund", icon: Undo2, color: "#dc2626" },
    void: { label: "Void", icon: Ban, color: "#7c3aed" },
    discount: { label: "Discount", icon: BadgePercent, color: "#d97706" },
  };

  return (
    <div className="p-4 space-y-3" data-testid="dash-refunds">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold" style={{ color: "var(--pos-text)" }}>Refunds & discounts</h1>
        <div className="lg-card rounded-full p-1 flex text-xs font-semibold shrink-0">
          {RANGES.map((r) => (
            <button key={r.key} type="button" onClick={() => setRange(r.key)} data-testid={`refunds-range-${r.key}`}
              className="h-7 px-3 rounded-full" style={{ background: range === r.key ? "var(--pos-accent)" : "transparent", color: range === r.key ? "#fff" : "var(--pos-muted)" }}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="text-sm rounded-xl p-3" style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626" }}>{error}</div>}

      <div className="grid grid-cols-3 gap-2">
        {["refund", "void", "discount"].map((k) => {
          const { label, icon: Icon, color } = KIND[k];
          const active = tab === k;
          return (
            <button key={k} type="button" onClick={() => setTab(active ? "all" : k)} data-testid={`refunds-total-${k}`}
              className="lg-card lg-press rounded-2xl p-3 text-left" style={active ? { borderColor: color } : undefined}>
              <div className="flex items-center gap-1 text-[11px]" style={{ color: "var(--pos-muted)" }}>
                <Icon className="w-3.5 h-3.5" style={{ color }} /> {label}s
              </div>
              <div className="text-base font-bold tabular-nums mt-0.5" style={{ color: "var(--pos-text)" }}>{logs ? inr(data.totals[k]) : "—"}</div>
              <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>{logs ? `${data.counts[k]} ${data.counts[k] === 1 ? "order" : "orders"}` : ""}</div>
            </button>
          );
        })}
      </div>

      {data.people.length > 0 && (
        <div className="lg-card rounded-2xl p-4" data-testid="refunds-by-person">
          <div className="flex items-center gap-2 text-sm font-bold mb-2" style={{ color: "var(--pos-text)" }}>
            <ShieldAlert className="w-4 h-4" style={{ color: "var(--pos-accent)" }} /> Refunds & voids by staff
          </div>
          <div className="space-y-1.5">
            {data.people.map((p) => (
              <div key={p.name} className="flex justify-between text-sm">
                <span className="truncate" style={{ color: "var(--pos-text)" }}>{p.name}</span>
                <span className="tabular-nums shrink-0" style={{ color: "var(--pos-muted)" }}>{p.count} · <b style={{ color: "var(--pos-text)" }}>{inr(p.amount)}</b></span>
              </div>
            ))}
          </div>
        </div>
      )}

      {logs && shown.length === 0 && !error ? (
        <EmptyState testid="refunds-empty" icon={Undo2} title="Nothing to show"
          description={`No ${tab === "all" ? "refunds, voids or discounts" : `${KIND[tab].label.toLowerCase()}s`} ${days === 1 ? "today" : "in the last 7 days"}.`} />
      ) : (
        <div className="space-y-2">
          {shown.map((e) => {
            const { label, icon: Icon, color } = KIND[e.kind];
            return (
              <div key={e.id} className="lg-card rounded-2xl p-3 flex items-start gap-3" data-testid={`refunds-entry-${e.kind}`}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: `${color}1f` }}>
                  <Icon className="w-4 h-4" style={{ color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between gap-2">
                    <span className="text-sm font-semibold" style={{ color: "var(--pos-text)" }}>{label} · #{e.order_number}</span>
                    <span className="text-sm font-bold tabular-nums shrink-0" style={{ color }}>−{inr(e.amount)}</span>
                  </div>
                  <div className="text-xs truncate" style={{ color: "var(--pos-text)" }}>{e.reason}{e.notes ? ` · ${e.notes}` : ""}</div>
                  <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>
                    {when(e.at, days)}{e.by_user_name ? ` · by ${e.by_user_name}` : ""}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
