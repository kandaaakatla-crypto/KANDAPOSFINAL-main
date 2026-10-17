import React, { useEffect, useState } from "react";
import { Split } from "lucide-react";
import { useDash } from "../../store/DashContext";
import EmptyState from "../ui/empty-state";

// Where today's money comes from: counter vs phone vs Swiggy/Zomato vs QR vs
// website, and dine-in vs takeaway vs delivery (reports.report_channels).

const inr = (n) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

const SOURCES = {
  "in-store": { label: "Counter", color: "#78716c" },
  phone: { label: "Phone", color: "#0ea5e9" },
  swiggy: { label: "Swiggy", color: "#fc8019" },
  zomato: { label: "Zomato", color: "#e23744" },
  qr: { label: "Table QR", color: "#8b5cf6" },
  website: { label: "Website", color: "#16a34a" },
  other: { label: "Other", color: "#93805f" },
};
const TYPES = {
  "dine-in": { label: "Dine-in", color: "#f97316" },
  collection: { label: "Takeaway", color: "#0ea5e9" },
  delivery: { label: "Delivery", color: "#16a34a" },
  sale: { label: "Counter sale", color: "#8b5cf6" },
};
const PERIODS = [{ days: 1, label: "Today" }, { days: 7, label: "7 days" }, { days: 30, label: "30 days" }];

export default function DashChannels() {
  const { api } = useDash();
  const [days, setDays] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancel = false;
    setData(null);
    setError("");
    api.get("/reports/channels", { params: { days } })
      .then((r) => { if (!cancel) setData(r.data); })
      .catch((e) => { if (!cancel) setError(typeof e?.response?.data?.detail === "string" ? e.response.data.detail : "Could not load the channel split"); });
    return () => { cancel = true; };
  }, [api, days]);

  return (
    <div className="p-4 space-y-3" data-testid="dash-channels">
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--pos-text)" }}>Channels</h1>
        <p className="text-xs" style={{ color: "var(--pos-muted)" }}>{data ? `${inr(data.total)} · where orders came from` : "Loading…"}</p>
      </div>
      <div className="flex gap-2">
        {PERIODS.map((p) => (
          <button key={p.days} type="button" onClick={() => setDays(p.days)} data-testid={`channels-${p.days}`}
            className="lg-press h-8 px-3 rounded-full text-xs font-semibold"
            style={days === p.days ? { background: "var(--pos-accent)", color: "#fff" } : { background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>
            {p.label}
          </button>
        ))}
      </div>

      {error && <div className="text-sm rounded-xl p-3" style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626" }}>{error}</div>}

      {data && !data.total ? (
        <EmptyState testid="channels-empty" icon={Split} title="No sales yet" description="Orders show here as they come in." />
      ) : data && (
        <>
          <Breakdown title="By channel" rows={data.bySource} names={SOURCES} total={data.total} testid="channels-source" />
          <Breakdown title="By order type" rows={data.byType} names={TYPES} total={data.total} testid="channels-type" />
        </>
      )}
    </div>
  );
}

function Breakdown({ title, rows, names, total, testid }) {
  const meta = (key) => names[key] || { label: key, color: "#93805f" };
  return (
    <div className="lg-card rounded-2xl p-4" data-testid={testid}>
      <div className="text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: "var(--pos-muted)" }}>{title}</div>
      <div className="flex h-3 rounded-full overflow-hidden mt-3" style={{ background: "var(--pos-panel-2)" }} aria-hidden="true">
        {rows.filter((r) => r.sales > 0).map((r) => (
          <div key={r.key} style={{ width: `${(r.sales / total) * 100}%`, background: meta(r.key).color }} />
        ))}
      </div>
      <div className="mt-3 space-y-2">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2 text-sm" data-testid={`${testid}-${r.key}`}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: meta(r.key).color }} />
            <span className="flex-1 min-w-0 truncate" style={{ color: "var(--pos-text)" }}>{meta(r.key).label}</span>
            <span className="text-[11px]" style={{ color: "var(--pos-muted)" }}>{r.orders} · {total ? Math.round((r.sales / total) * 100) : 0}%</span>
            <span className="w-20 text-right font-semibold tabular-nums" style={{ color: "var(--pos-text)" }}>{inr(r.sales)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
