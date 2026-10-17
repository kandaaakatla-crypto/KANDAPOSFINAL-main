import React, { useEffect, useState } from "react";
import { Trophy, TrendingUp, TrendingDown } from "lucide-react";
import { useDash } from "../../store/DashContext";
import { brandApi } from "../../api/client";
import EmptyState from "../ui/empty-state";

// Brand owners' store league: every store ranked by sales for the period,
// with the change against the period before (today vs the same time last
// week; 7/30 days vs the 7/30 days before). Uses the existing brand rollup
// (routes/brands.py), which already skips voided orders.

const inr = (n) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;
const DAY = 86400000;
const IST_OFFSET = 330 * 60000;

// placedAt is stored as an IST ISO string and the rollup compares strings,
// so the bounds must be written in IST too.
const istIso = (ms) => new Date(ms + IST_OFFSET).toISOString().slice(0, 19) + "+05:30";
const istMidnight = (ms) => { const d = new Date(ms + IST_OFFSET); d.setUTCHours(0, 0, 0, 0); return d.getTime() - IST_OFFSET; };

const PERIODS = [
  { key: "today", label: "Today", vs: "vs same time last week" },
  { key: "7", label: "7 days", vs: "vs the 7 days before" },
  { key: "30", label: "30 days", vs: "vs the 30 days before" },
];

function ranges(key) {
  const now = Date.now();
  if (key === "today") {
    const start = istMidnight(now);
    return [{ start, end: now }, { start: start - 7 * DAY, end: now - 7 * DAY }];
  }
  const days = Number(key);
  const start = istMidnight(now) - (days - 1) * DAY;
  return [{ start, end: now }, { start: start - days * DAY, end: start }];
}

export default function DashLeague() {
  const { user } = useDash();
  const [period, setPeriod] = useState("today");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.brand_id) return undefined;
    let cancel = false;
    setData(null);
    setError("");
    const [cur, prev] = ranges(period);
    const q = (r) => brandApi.rollup(user.brand_id, { start: istIso(r.start), end: istIso(r.end) });
    Promise.all([q(cur), q(prev)])
      .then(([a, b]) => {
        if (cancel) return;
        const before = Object.fromEntries((b.stores || []).map((s) => [s.tenant_id, s.sales]));
        setData({ totals: a.totals, prevTotal: b.totals?.sales || 0, stores: (a.stores || []).map((s) => ({ ...s, prev: before[s.tenant_id] || 0 })) });
      })
      .catch((e) => { if (!cancel) setError(e?.response?.data?.detail || "Could not load your stores"); });
    return () => { cancel = true; };
  }, [user?.brand_id, period]);

  if (!user?.brand_id) {
    return (
      <div className="p-4">
        <EmptyState testid="league-no-brand" icon={Trophy} title="One store so far" description="Once you add more stores to your brand, they're ranked here." />
      </div>
    );
  }

  const vs = PERIODS.find((p) => p.key === period).vs;
  const top = Math.max(1, ...(data?.stores || []).map((s) => s.sales));

  return (
    <div className="p-4 space-y-3" data-testid="dash-league">
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--pos-text)" }}>Store league</h1>
        <p className="text-xs" style={{ color: "var(--pos-muted)" }}>
          {data ? `${inr(data.totals?.sales)} across ${data.totals?.store_count} stores` : "Loading…"}
          {data && <Delta now={data.totals?.sales || 0} then={data.prevTotal} />}
        </p>
      </div>

      <div className="flex gap-2" role="tablist">
        {PERIODS.map((p) => (
          <button key={p.key} type="button" role="tab" aria-selected={period === p.key} onClick={() => setPeriod(p.key)} data-testid={`league-${p.key}`}
            className="lg-press h-8 px-3 rounded-full text-xs font-semibold"
            style={period === p.key ? { background: "var(--pos-accent)", color: "#fff" } : { background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>
            {p.label}
          </button>
        ))}
      </div>

      {error && <div className="text-sm rounded-xl p-3" style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626" }}>{error}</div>}

      <div className="space-y-2">
        {(data?.stores || []).map((s, i) => (
          <div key={s.tenant_id} className="lg-card rounded-2xl p-3" data-testid={`league-row-${s.tenant_id}`}>
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                style={i === 0 && s.sales > 0 ? { background: "rgba(234,179,8,0.18)", color: "#a16207" } : { background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate" style={{ color: "var(--pos-text)" }}>{s.store_name}</div>
                <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>
                  {s.orders} {s.orders === 1 ? "order" : "orders"}{s.orders ? ` · avg ${inr(s.sales / s.orders)}` : ""}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-bold tabular-nums" style={{ color: "var(--pos-text)" }}>{inr(s.sales)}</div>
                <div className="text-[11px]"><Delta now={s.sales} then={s.prev} /></div>
              </div>
            </div>
            <div className="h-1.5 rounded-full mt-2 overflow-hidden" style={{ background: "var(--pos-panel-2)" }}>
              <div className="h-full rounded-full" style={{ width: `${(s.sales / top) * 100}%`, background: "var(--pos-accent)" }} />
            </div>
          </div>
        ))}
      </div>
      {data && <p className="text-[11px] text-center" style={{ color: "var(--pos-muted)" }}>Change shown {vs}. Voided orders are left out.</p>}
    </div>
  );
}

function Delta({ now, then }) {
  if (!then) return now ? <span className="ml-1" style={{ color: "var(--pos-muted)" }}>new</span> : null;
  const pct = Math.round(((now - then) / then) * 100);
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className="ml-1 inline-flex items-center gap-0.5 font-semibold" style={{ color: up ? "#16a34a" : "#dc2626" }}>
      <Icon className="w-3 h-3" /> {up ? "+" : ""}{pct}%
    </span>
  );
}
