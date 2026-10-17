import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users, Clock3, IndianRupee, Percent } from "lucide-react";
import { useDash, canManagePayroll, canViewReports } from "../../store/DashContext";
import EmptyState from "../ui/empty-state";

// Who is clocked in right now, how long they've been on, and — for people
// allowed to see pay — what today's labour has cost and what share of
// today's sales that is. Labour % is the number restaurant owners watch most
// after sales (Toast Now shows it next to net sales).

const inr = (n) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

function hoursSince(iso, now) {
  return Math.max(0, (now - new Date(iso)) / 3600000);
}
function fmtHours(h) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return hh ? `${hh}h ${mm}m` : `${mm}m`;
}

export default function DashOnShift() {
  const { api, user } = useDash();
  const showPay = canManagePayroll(user);
  const showSales = canViewReports(user);
  const [onShift, setOnShift] = useState(null);
  const [labour, setLabour] = useState(null);
  const [sales, setSales] = useState(null);
  const [error, setError] = useState("");
  const [now] = useState(() => new Date());

  useEffect(() => {
    api.get("/timeclock/current")
      .then((r) => setOnShift(r.data || []))
      .catch((e) => setError(e?.response?.data?.detail || "Could not load who's on shift"));
    if (showPay) api.get("/reports/labour").then((r) => setLabour(r.data)).catch(() => {});
    if (showPay && showSales) api.get("/reports/summary").then((r) => setSales(r.data?.todaySales ?? null)).catch(() => {});
  }, [api, showPay, showSales]);

  const costById = Object.fromEntries((labour?.currently_in || []).map((r) => [r.user_id, r]));
  const labourPct = labour && sales ? (labour.today_cost / sales) * 100 : null;

  return (
    <div className="p-4 space-y-3" data-testid="dash-on-shift">
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--pos-text)" }}>On shift now</h1>
        <p className="text-xs" style={{ color: "var(--pos-muted)" }}>
          {onShift ? `${onShift.length} clocked in` : "Loading…"}
        </p>
      </div>

      {showPay && labour && (
        <div className={`grid gap-2 ${labourPct != null ? "grid-cols-2" : "grid-cols-1"}`}>
          <div className="lg-card rounded-2xl p-3" data-testid="shift-labour-cost">
            <div className="flex items-center gap-1 text-[11px]" style={{ color: "var(--pos-muted)" }}><IndianRupee className="w-3.5 h-3.5" /> Labour cost today</div>
            <div className="text-lg font-bold tabular-nums" style={{ color: "var(--pos-text)" }}>{inr(labour.today_cost)}</div>
            <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>≈ {inr(labour.monthly_run_rate)} / month at this rate</div>
          </div>
          {labourPct != null && (
            <div className="lg-card rounded-2xl p-3" data-testid="shift-labour-pct">
              <div className="flex items-center gap-1 text-[11px]" style={{ color: "var(--pos-muted)" }}><Percent className="w-3.5 h-3.5" /> Labour % of sales</div>
              <div className="text-lg font-bold tabular-nums" style={{ color: labourPct > 35 ? "#dc2626" : labourPct > 30 ? "#d97706" : "var(--pos-text)" }}>{labourPct.toFixed(1)}%</div>
              <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>Sales {inr(sales)} so far</div>
            </div>
          )}
        </div>
      )}

      {error && <div className="text-sm rounded-xl p-3" style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626" }}>{error}</div>}

      {onShift && onShift.length === 0 && !error ? (
        <EmptyState testid="shift-empty" icon={Users} title="Nobody is clocked in" description="Staff show here when they clock in on the POS." />
      ) : (
        <div className="lg-card rounded-2xl overflow-hidden">
          {(onShift || []).map((s, idx) => {
            const cost = costById[s.user_id];
            const initials = (s.user_name || "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
            return (
              <div key={s.user_id} data-testid={`shift-${s.user_id}`} className="flex items-center gap-3 px-4 py-3"
                style={{ borderTop: idx ? "1px solid var(--pos-border)" : "none" }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: "rgba(249,115,22,0.14)", color: "var(--pos-accent)" }}>{initials}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate" style={{ color: "var(--pos-text)" }}>{s.user_name}</div>
                  <div className="text-[11px] flex items-center gap-1" style={{ color: "var(--pos-muted)" }}>
                    {s.role} · <Clock3 className="w-3 h-3" /> since {new Date(s.since).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold tabular-nums" style={{ color: "var(--pos-text)" }}>{fmtHours(hoursSince(s.since, now))}</div>
                  {showPay && cost && <div className="text-[11px] tabular-nums" style={{ color: "var(--pos-muted)" }}>{inr(cost.cost_today)}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Link to="/dashboard/workforce" className="block text-center text-xs font-semibold py-2" style={{ color: "var(--pos-accent)" }}>
        See the rota and timesheets
      </Link>
    </div>
  );
}
