import React, { useEffect, useState } from "react";
import { reportsApi } from "../../api/client";
import { TrendingUp, Loader2 } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const ACCENT = "#f97316";
const MUTED = "#8b9bb8";
const BORDER = "#243352";
const PANEL_2 = "#16213a";

function fmtDay(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function fmtAxisCurrency(v) {
  return v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${v}`;
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg px-3 py-2 text-xs" style={{ background: PANEL_2, border: `1px solid ${BORDER}` }}>
      <div className="font-bold text-white mb-1">{fmtDay(p.date)}</div>
      <div style={{ color: MUTED }}>Sales <span className="text-white font-semibold tabular-nums">₹{(p.gross_sales || 0).toFixed(0)}</span></div>
      <div style={{ color: MUTED }}>Orders <span className="text-white font-semibold tabular-nums">{p.orders || 0}</span></div>
    </div>
  );
}

/**
 * Sales trend for the dashboard overview — a fixed-window at-a-glance
 * companion to the interactive 7/14/30d chart on the Reports page, not a
 * replacement for it (that one keeps its own range toggle + refunds detail).
 */
export default function SalesTrendChart({ days = 14 }) {
  const [rollups, setRollups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancel = false;
    setLoading(true); setError("");
    reportsApi.dailyRollup(days)
      .then((r) => { if (!cancel) setRollups(r.rollups || []); })
      .catch((e) => { if (!cancel) setError(e?.response?.data?.detail || "Failed to load sales trend"); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [days]);

  const total = rollups.reduce((s, d) => s + (d.gross_sales || 0), 0);
  const hasData = rollups.some((d) => (d.gross_sales || 0) > 0);

  return (
    <div className="rounded-xl p-4" data-testid="sales-trend-chart" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4" style={{ color: "var(--pos-accent)" }} />
          <h2 className="text-sm font-bold text-white">Sales trend</h2>
        </div>
        <div className="text-xs tabular-nums" style={{ color: "var(--pos-muted)" }}>
          Last {days} days · ₹{total.toFixed(0)}
        </div>
      </div>

      {loading ? (
        <div className="h-48 flex items-center justify-center gap-2 text-xs" style={{ color: "var(--pos-muted)" }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <div className="h-48 flex items-center justify-center text-xs" style={{ color: "#fca5a5" }}>{error}</div>
      ) : !hasData ? (
        <div className="h-48 flex items-center justify-center text-xs text-center px-6" style={{ color: "var(--pos-muted)" }}>
          Not enough sales yet to chart a trend — this fills in as orders come through.
        </div>
      ) : (
        <div className="h-48 -ml-2" data-testid="sales-trend-chart-svg">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rollups} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="salesTrendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={BORDER} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fill: MUTED, fontSize: 10 }} axisLine={{ stroke: BORDER }} tickLine={false} minTickGap={24} />
              <YAxis tickFormatter={fmtAxisCurrency} tick={{ fill: MUTED, fontSize: 10 }} axisLine={false} tickLine={false} width={44} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: ACCENT, strokeWidth: 1, strokeDasharray: "3 3" }} />
              <Area type="monotone" dataKey="gross_sales" stroke={ACCENT} strokeWidth={2} fill="url(#salesTrendFill)" activeDot={{ r: 4, fill: ACCENT, stroke: "#0b1220", strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
