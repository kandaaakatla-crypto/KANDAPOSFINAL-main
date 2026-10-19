import React, { useEffect, useState } from "react";
import { usePos } from "../../store/PosContext";
import { useDash } from "../../store/DashContext";
import { reportsApi, labourApi } from "../../api/client";
import { IndianRupee, ReceiptText, TrendingUp, Bike, Users, RefreshCcw, ChefHat } from "lucide-react";
import PeakHoursHeatmap from "../dash/PeakHoursHeatmap";
import MenuEngineeringTab from "./MenuEngineeringTab";

const RANGE_OPTIONS = [7, 14, 30];

export default function ReportsScreen() {
  const { orders, staffUser } = usePos();
  // Rendered only at /dashboard/reports in practice, but still reads
  // usePos() (see CustomersScreen.jsx's comment for the same situation) —
  // a dashboard-only session never has a staffUser, so the labour-cost
  // widget needs its own manager check that also recognises a dashboard
  // login instead of requiring a POS PIN "Manager" role specifically.
  const { user: dashUser } = useDash();
  const canSeeLabour = dashUser ? true : staffUser?.role === "Manager";
  const [tab, setTab] = useState("sales");
  const [summary, setSummary] = useState(null);
  const [labour, setLabour] = useState(null);
  const [range, setRange] = useState(7);
  const [rollups, setRollups] = useState([]);
  const [rollupsLoading, setRollupsLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    reportsApi.summary().then((s) => { if (!cancel) setSummary(s); }).catch(() => {});
    if (canSeeLabour) {
      labourApi.today().then((l) => { if (!cancel) setLabour(l); }).catch(() => {});
      const t = setInterval(() => {
        labourApi.today().then((l) => { if (!cancel) setLabour(l); }).catch(() => {});
      }, 60000);
      return () => { cancel = true; clearInterval(t); };
    }
    return () => { cancel = true; };
  }, [orders.length, canSeeLabour]);

  useEffect(() => {
    let cancel = false;
    setRollupsLoading(true);
    reportsApi.dailyRollup(range).then((r) => { if (!cancel) setRollups(r.rollups || []); }).finally(() => { if (!cancel) setRollupsLoading(false); });
    return () => { cancel = true; };
  }, [range, orders.length]);

  const todayOrders = orders;
  const todaySales = summary?.todaySales ?? 0;
  const avgOrder = summary?.avgOrder ?? 0;
  const deliveries = summary?.deliveriesToday ?? 0;
  const cashTotal = summary?.cashTotal ?? 0;
  const cardTotal = summary?.cardTotal ?? 0;
  const upiTotal = summary?.upiTotal ?? 0;
  const otherTotal = summary?.otherTotal ?? 0;
  const unpaidTotal = summary?.unpaidTotal ?? 0;
  const topItems = summary?.topItems ?? [];

  const refundedInRange = rollups.reduce((s, r) => s + (r.refunded || 0), 0);
  const maxSales = rollups.length ? Math.max(...rollups.map((d) => d.net_sales || 0), 1) : 1;
  const payTotal = cashTotal + upiTotal + cardTotal + otherTotal + unpaidTotal || 1;
  const fmtLabel = (dateStr) => {
    const d = new Date(dateStr + "T00:00:00Z");
    return range <= 7
      ? d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })
      : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  };

  const STATS = [
    { label: "Today's Sales", value: `₹${todaySales.toFixed(2)}`, icon: IndianRupee, color: "#22c55e" },
    { label: "Orders Today", value: summary?.ordersToday ?? todayOrders.length, icon: ReceiptText, color: "#3b82f6" },
    { label: "Avg Order Value", value: `₹${avgOrder.toFixed(2)}`, icon: TrendingUp, color: "#f59e0b" },
    { label: "Deliveries", value: deliveries, icon: Bike, color: "#3b82f6" },
    { label: `Refunds (${range}d)`, value: `₹${refundedInRange.toFixed(2)}`, icon: RefreshCcw, color: "#f87171" },
  ];

  return (
    <div className="h-full overflow-y-auto pos-scroll p-4 space-y-4" data-testid="reports-screen">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold" style={{ color: "var(--pos-text)" }}>Sales Dashboard</h2>
        <div className="flex gap-1.5">
          <button data-testid="reports-tab-sales" onClick={() => setTab("sales")}
            className="pos-btn h-9 px-3 rounded-md text-xs font-bold flex items-center gap-1.5"
            style={{ background: tab === "sales" ? "var(--pos-accent)" : "var(--pos-panel)", color: tab === "sales" ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
            <TrendingUp className="w-3.5 h-3.5" /> Sales
          </button>
          <button data-testid="reports-tab-menu-engineering" onClick={() => setTab("menu")}
            className="pos-btn h-9 px-3 rounded-md text-xs font-bold flex items-center gap-1.5"
            style={{ background: tab === "menu" ? "var(--pos-accent)" : "var(--pos-panel)", color: tab === "menu" ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
            <ChefHat className="w-3.5 h-3.5" /> Menu Engineering
          </button>
        </div>
      </div>

      {tab === "menu" ? <MenuEngineeringTab /> : <>

      {/* Labour cost widget — Manager-only */}
      {canSeeLabour && labour && (
        <div className="rounded-xl p-4 flex items-center gap-4" data-testid="labour-widget"
          style={{ background: "linear-gradient(135deg, var(--pos-panel) 0%, var(--pos-panel-2) 100%)", border: "1px solid var(--pos-border)" }}>
          <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#fcd34d22" }}>
            <Users className="w-6 h-6" style={{ color: "#fcd34d" }} />
          </div>
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Labour cost today</div>
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-bold tabular-nums" style={{ color: "var(--pos-text)" }} data-testid="labour-today">₹{labour.today_cost.toFixed(2)}</span>
              <span className="text-xs" style={{ color: "var(--pos-muted)" }}>
                {labour.currently_in_count} on shift now
              </span>
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: "var(--pos-muted)" }}>
              30-day run-rate at this pace: <span className="tabular-nums" style={{ color: "var(--pos-text)" }}>₹{labour.monthly_run_rate.toFixed(2)}</span>
            </div>
          </div>
          {todaySales > 0 && (
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Labour vs sales</div>
              <div className="text-xl font-bold tabular-nums" style={{ color: labour.today_cost / todaySales > 0.4 ? "#dc2626" : "#16a34a" }}>
                {((labour.today_cost / todaySales) * 100).toFixed(1)}%
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {STATS.map((s) => (
          <div key={s.label} className="dash-card rounded-xl p-4 flex items-center gap-3" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }} data-testid={`stat-${s.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
            <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${s.color}22` }}>
              <s.icon className="w-5 h-5" style={{ color: s.color }} />
            </div>
            <div>
              <div className="text-xl font-bold tabular-nums" style={{ color: "var(--pos-text)" }}>{s.value}</div>
              <div className="text-xs" style={{ color: "var(--pos-muted)" }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Sales trend — adjustable range */}
        <div className="lg:col-span-2 rounded-xl p-5" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }} data-testid="weekly-chart">
          <div className="flex items-center justify-between mb-1">
            <div className="font-semibold" style={{ color: "var(--pos-text)" }}>Sales Trend</div>
            <div className="flex gap-1">
              {RANGE_OPTIONS.map((r) => (
                <button key={r} data-testid={`range-${r}d`} onClick={() => setRange(r)}
                  className="pos-btn h-7 px-2.5 rounded-md text-[11px] font-bold"
                  style={{ background: range === r ? "var(--pos-accent)" : "var(--pos-panel-2)", color: range === r ? "#fff" : "var(--pos-muted)" }}>
                  {r}d
                </button>
              ))}
            </div>
          </div>
          <div className="text-xs mb-5" style={{ color: "var(--pos-muted)" }}>
            Last {range} days · ₹{rollups.reduce((s, d) => s + (d.net_sales || 0), 0).toFixed(0)} total
          </div>
          {rollupsLoading ? (
            <div className="h-44 flex items-center justify-center text-xs" style={{ color: "var(--pos-muted)" }}>Loading…</div>
          ) : (
            <div className="flex items-end gap-[3px] h-44 overflow-x-auto pos-scroll">
              {rollups.map((d) => (
                <div key={d.date} className="flex-1 min-w-[18px] flex flex-col items-center gap-1.5" title={`${d.date} · ₹${(d.net_sales || 0).toFixed(2)}`}>
                  {range <= 7 && <span className="text-[10px] tabular-nums" style={{ color: "var(--pos-muted)" }}>₹{(d.net_sales || 0).toFixed(0)}</span>}
                  <div className="w-full rounded-t-md" style={{ height: `${((d.net_sales || 0) / maxSales) * 100}%`, background: (d.net_sales || 0) === maxSales ? "var(--pos-accent)" : "var(--pos-border)", minHeight: 4, transition: "height 0.4s ease" }} />
                  <span className="text-[10px] font-medium whitespace-nowrap" style={{ color: "var(--pos-muted)" }}>{fmtLabel(d.date)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Payment split + top items */}
        <div className="space-y-4">
          <div className="rounded-xl p-5" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }} data-testid="payment-split">
            <div className="font-semibold mb-3" style={{ color: "var(--pos-text)" }}>Payment Methods (today)</div>
            {[{ label: "Cash", val: cashTotal, color: "#22c55e" }, { label: "UPI", val: upiTotal, color: "#8b5cf6" }, { label: "Card", val: cardTotal, color: "#3b82f6" }, { label: "Other", val: otherTotal, color: "#64748b" }, { label: "Unpaid / Open", val: unpaidTotal, color: "#f59e0b" }].map((p) => (
              <div key={p.label} className="mb-3">
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: "var(--pos-muted)" }}>{p.label}</span>
                  <span className="tabular-nums font-semibold" style={{ color: "var(--pos-text)" }}>₹{p.val.toFixed(2)}</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--pos-panel-2)" }}>
                  <div className="h-full rounded-full" style={{ width: `${(p.val / payTotal) * 100}%`, background: p.color, transition: "width 0.4s ease" }} />
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl p-5" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }} data-testid="top-items">
            <div className="font-semibold mb-3" style={{ color: "var(--pos-text)" }}>Top Sellers (this week)</div>
            {topItems.map((t, i) => (
              <div key={t.name} className="flex items-center justify-between py-2" style={{ borderBottom: i < topItems.length - 1 ? "1px solid var(--pos-border)" : "none" }}>
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold" style={{ background: "var(--pos-panel-2)", color: "var(--pos-accent)" }}>{i + 1}</span>
                  <div>
                    <div className="text-sm font-medium" style={{ color: "var(--pos-text)" }}>{t.name}</div>
                    <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>{t.sold} sold</div>
                  </div>
                </div>
                <span className="text-sm font-bold tabular-nums" style={{ color: "var(--pos-text)" }}>₹{t.revenue.toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Peak hours — busiest weekday × hour buckets */}
      <PeakHoursHeatmap days={28} />
      </>}
    </div>
  );
}
