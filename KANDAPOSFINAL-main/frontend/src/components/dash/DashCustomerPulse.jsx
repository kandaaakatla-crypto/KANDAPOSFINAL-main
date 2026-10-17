import React, { useEffect, useState } from "react";
import { HeartPulse, Phone } from "lucide-react";
import { useDash } from "../../store/DashContext";

// Customer pulse (reports.report_customers): new vs returning customers,
// walk-ins, best customers this period, and regulars who've gone quiet,
// each with a tap-to-call number.

const inr = (n) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;
const ago = (iso) => {
  const d = Math.floor((Date.now() - new Date(iso)) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};

export default function DashCustomerPulse() {
  const { api } = useDash();
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancel = false;
    setData(null);
    setError("");
    api.get("/reports/customers", { params: { days } })
      .then((r) => { if (!cancel) setData(r.data); })
      .catch((e) => { if (!cancel) setError(typeof e?.response?.data?.detail === "string" ? e.response.data.detail : "Could not load customer pulse"); });
    return () => { cancel = true; };
  }, [api, days]);

  const known = data ? data.newCustomers + data.returningCustomers : 0;

  return (
    <div className="p-4 space-y-3" data-testid="dash-customer-pulse">
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--pos-text)" }}>Customer pulse</h1>
        <p className="text-xs" style={{ color: "var(--pos-muted)" }}>{days === 7 ? "This week" : "Last 30 days"}, from orders with a customer attached</p>
      </div>
      <div className="flex gap-2">
        {[7, 30].map((d) => (
          <button key={d} type="button" onClick={() => setDays(d)} data-testid={`pulse-days-${d}`}
            className="lg-press h-8 px-3 rounded-full text-xs font-semibold"
            style={days === d ? { background: "var(--pos-accent)", color: "#fff" } : { background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>
            {d} days
          </button>
        ))}
      </div>

      {error && <div className="text-sm rounded-xl p-3" style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626" }}>{error}</div>}
      {!data && !error && <div className="text-sm" style={{ color: "var(--pos-muted)" }}>Loading…</div>}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-2" data-testid="pulse-counts">
            <Stat label="New" value={data.newCustomers} color="#16a34a" />
            <Stat label="Returning" value={data.returningCustomers} color="var(--pos-accent)" />
            <Stat label="Walk-in orders" value={data.walkInOrders} color="var(--pos-muted)" />
          </div>
          {known > 0 && (
            <p className="text-[11px]" style={{ color: "var(--pos-muted)" }} data-testid="pulse-repeat">
              {Math.round((data.returningCustomers / known) * 100)}% of named customers had been before.
            </p>
          )}

          <People title="Best customers" rows={data.topCustomers} testid="pulse-top" empty="No named customers yet in this period."
            sub={(c) => `${c.orders} ${c.orders === 1 ? "order" : "orders"} · ${inr(c.spend)}`} />
          <People title="Regulars gone quiet" rows={data.lapsedRegulars} testid="pulse-lapsed"
            hint="Ordered 3+ times in the last 90 days, nothing in the last 3 weeks. Worth a call or an offer."
            empty="No regulars have gone quiet."
            sub={(c) => `Last order ${ago(c.lastOrderAt)} · ${c.orders} orders · ${inr(c.spend)}`} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div className="lg-card rounded-2xl p-3 text-center">
      <div className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</div>
      <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>{label}</div>
    </div>
  );
}

function People({ title, rows, sub, hint, empty, testid }) {
  return (
    <div className="lg-card rounded-2xl p-4" data-testid={testid}>
      <div className="text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: "var(--pos-muted)" }}>{title}</div>
      {hint && <p className="text-[11px] mt-1" style={{ color: "var(--pos-muted)" }}>{hint}</p>}
      {rows.length === 0 ? (
        <p className="text-xs mt-2 flex items-center gap-1.5" style={{ color: "var(--pos-muted)" }}><HeartPulse className="w-3.5 h-3.5" /> {empty}</p>
      ) : (
        <div className="mt-2 space-y-2.5">
          {rows.map((c) => (
            <div key={c.id} className="flex items-center gap-3" data-testid={`${testid}-${c.id}`}>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate" style={{ color: "var(--pos-text)" }}>{c.name || c.phone}</div>
                <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>{sub(c)}</div>
              </div>
              {c.phone && (
                <a href={`tel:${c.phone}`} aria-label={`Call ${c.name || c.phone}`}
                  className="lg-press w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--pos-panel-2)", color: "var(--pos-accent)" }}>
                  <Phone className="w-4 h-4" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
