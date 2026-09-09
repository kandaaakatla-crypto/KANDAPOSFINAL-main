import React, { useEffect, useMemo, useState } from "react";
import { reportsApi } from "../../api/client";
import { Flame, Loader2, RefreshCw } from "lucide-react";

/**
 * Peak-hours heatmap.
 *
 * Grid: 7 rows (Sun-Sat) × 24 columns (0-23 IST hour) with cell intensity
 * derived from summed revenue for that day-of-week × hour across the last
 * N days. Pulls from /api/reports/daily-rollup which is materialised each
 * night by the daily_rollup_cron_loop, so this is fast at any order volume.
 */
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function PeakHoursHeatmap({ days = 28 }) {
  const [rollups, setRollups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const r = await reportsApi.dailyRollup(days);
      setRollups(r.rollups || []);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load rollups");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [days]);

  const { grid, max, weekTotals, hourTotals, peak } = useMemo(() => {
    const g = Array.from({ length: 7 }, () => Array(24).fill(0));
    const weekT = Array(7).fill(0);
    const hourT = Array(24).fill(0);
    let mx = 0, peakVal = 0, peakDay = -1, peakHr = -1;
    for (const r of rollups) {
      const hourly = r.hourly_revenue || [];
      if (!hourly.length) continue;
      const dow = new Date(r.date + "T00:00:00Z").getUTCDay();
      for (let h = 0; h < 24; h++) {
        const v = Number(hourly[h] || 0);
        g[dow][h] += v;
        weekT[dow] += v;
        hourT[h] += v;
        if (v > mx) mx = v;
        if (g[dow][h] > peakVal) {
          peakVal = g[dow][h]; peakDay = dow; peakHr = h;
        }
      }
    }
    return { grid: g, max: mx, weekTotals: weekT, hourTotals: hourT, peak: { day: peakDay, hour: peakHr, value: peakVal } };
  }, [rollups]);

  const hasData = max > 0;

  return (
    <div className="rounded-xl overflow-hidden" data-testid="peak-hours-heatmap"
      style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
      <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--pos-border)" }}>
        <div>
          <div className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--pos-text)" }}>
            <Flame className="w-4 h-4" style={{ color: "#f97316" }} /> Peak hours
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: "var(--pos-muted)" }}>
            Revenue intensity across the last {days} days (IST). {hasData && peak.day >= 0 && (
              <>Busiest: <span className="font-bold" style={{ color: "var(--pos-text)" }}>{DOW[peak.day]} · {String(peak.hour).padStart(2, "0")}:00 IST</span></>
            )}
          </div>
        </div>
        <button data-testid="heatmap-refresh" onClick={load} disabled={loading}
          className="pos-btn text-[11px] px-2 py-1 rounded flex items-center gap-1"
          style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="p-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--pos-muted)" }}>
            <Loader2 className="w-4 h-4 animate-spin" /> Building heatmap…
          </div>
        )}
        {error && !loading && (
          <div className="text-sm p-2 rounded" style={{ background: "rgba(220,38,38,0.15)", color: "#fca5a5" }}>{error}</div>
        )}
        {!loading && !error && !hasData && (
          <div className="text-xs py-4" style={{ color: "var(--pos-muted)" }}>
            Not enough data yet. Once you take a few orders they&apos;ll appear here. The nightly rollup cron builds the history automatically.
          </div>
        )}
        {!loading && !error && hasData && (
          <>
            <div className="overflow-x-auto">
              <table className="text-[10px] tabular-nums" style={{ borderCollapse: "separate", borderSpacing: 2 }}>
                <thead>
                  <tr>
                    <th className="text-left pr-2" style={{ color: "var(--pos-muted)" }}></th>
                    {Array.from({ length: 24 }, (_, h) => (
                      <th key={h} className="w-6 text-center" style={{ color: "var(--pos-muted)" }}>
                        {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
                      </th>
                    ))}
                    <th className="pl-2 text-right" style={{ color: "var(--pos-muted)" }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {DOW.map((dow, di) => (
                    <tr key={dow}>
                      <td className="pr-2 font-bold" style={{ color: "var(--pos-muted)" }}>{dow}</td>
                      {grid[di].map((v, hi) => (
                        <td key={hi}
                          data-testid={`heatmap-cell-${di}-${hi}`}
                          className="w-6 h-6 rounded"
                          title={`${dow} ${String(hi).padStart(2, "0")}:00 IST — ₹${v.toFixed(0)}`}
                          style={{ background: cellColor(v, max), border: "1px solid rgba(255,255,255,0.02)" }} />
                      ))}
                      <td className="pl-2 text-right" style={{ color: "var(--pos-text)" }}>₹{weekTotals[di].toFixed(0)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="pr-2 pt-1 font-bold" style={{ color: "var(--pos-muted)" }}>Σ</td>
                    {hourTotals.map((v, hi) => (
                      <td key={hi} className="w-6 pt-1 text-center text-[9px]" style={{ color: "var(--pos-muted)" }}>
                        {hourTotals[hi] > 0 && hourTotals[hi] === Math.max(...hourTotals) ? "★" : ""}
                      </td>
                    ))}
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Legend */}
            <div className="flex items-center justify-end gap-2 mt-3 text-[10px]" style={{ color: "var(--pos-muted)" }}>
              <span>less</span>
              {[0.05, 0.25, 0.5, 0.75, 1].map((f) => (
                <span key={f} className="w-4 h-3 rounded" style={{ background: cellColor(f * max, max) }} />
              ))}
              <span>more</span>
            </div>

            {/* Callouts */}
            <div className="grid grid-cols-2 gap-2 mt-3">
              {(() => {
                const busiestDay = weekTotals.indexOf(Math.max(...weekTotals));
                const busiestHour = hourTotals.indexOf(Math.max(...hourTotals));
                return (
                  <>
                    <div className="p-2.5 rounded" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                      <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Best weekday</div>
                      <div className="text-sm font-bold mt-0.5" style={{ color: "var(--pos-text)" }}>{DOW[busiestDay]} · ₹{weekTotals[busiestDay].toFixed(0)}</div>
                    </div>
                    <div className="p-2.5 rounded" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                      <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Peak hour (IST)</div>
                      <div className="text-sm font-bold mt-0.5" style={{ color: "var(--pos-text)" }}>{String(busiestHour).padStart(2, "0")}:00 · ₹{hourTotals[busiestHour].toFixed(0)}</div>
                    </div>
                  </>
                );
              })()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function cellColor(v, max) {
  if (!max || v <= 0) return "rgba(255,255,255,0.03)";
  const t = Math.min(1, v / max);
  // Interpolate cool → warm (deep purple → orange → red)
  // Piece-wise for punchier steps than a pure lerp.
  if (t < 0.15) return `rgba(76, 29, 149, ${0.20 + t * 2})`;   // dim purple
  if (t < 0.35) return `rgba(147, 51, 234, ${0.55 + t * 0.6})`; // purple
  if (t < 0.55) return `rgba(219, 39, 119, ${0.65 + t * 0.4})`; // pink
  if (t < 0.75) return `rgba(249, 115, 22, ${0.75 + t * 0.3})`; // orange
  return `rgba(220, 38, 38, ${0.85 + t * 0.15})`;               // red
}
