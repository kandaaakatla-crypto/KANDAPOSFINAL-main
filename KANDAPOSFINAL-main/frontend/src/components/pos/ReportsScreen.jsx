import React, { useEffect, useState } from "react";
import { usePos } from "../../store/PosContext";
import { reportsApi, labourApi } from "../../api/client";
import { IndianRupee, ReceiptText, TrendingUp, Bike, Users, DollarSign, Coins, ChevronDown, ChevronUp } from "lucide-react";
import { CashDrawerPanel, TipPoolPanel } from "./OpsPanels";

export default function ReportsScreen() {
  const { orders, staffUser } = usePos();
  const [summary, setSummary] = useState(null);
  const [labour, setLabour] = useState(null);

  useEffect(() => {
    let cancel = false;
    reportsApi.summary().then((s) => { if (!cancel) setSummary(s); }).catch(() => {});
    if (staffUser?.role === "Manager") {
      labourApi.today().then((l) => { if (!cancel) setLabour(l); }).catch(() => {});
      const t = setInterval(() => {
        labourApi.today().then((l) => { if (!cancel) setLabour(l); }).catch(() => {});
      }, 60000);
      return () => { cancel = true; clearInterval(t); };
    }
    return () => { cancel = true; };
  }, [orders.length, staffUser?.role]);

  const todayOrders = orders;
  const todaySales = summary?.todaySales ?? 0;
  const avgOrder = summary?.avgOrder ?? 0;
  const deliveries = summary?.deliveriesToday ?? 0;
  const cashTotal = summary?.cashTotal ?? 0;
  const cardTotal = summary?.cardTotal ?? 0;
  const unpaidTotal = summary?.unpaidTotal ?? 0;
  const weekly = summary?.weeklySales ?? [];
  const topItems = summary?.topItems ?? [];

  const maxSales = weekly.length ? Math.max(...weekly.map((d) => d.sales)) : 1;
  const payTotal = cashTotal + cardTotal + unpaidTotal || 1;

  const STATS = [
    { label: "Today's Sales", value: `₹${todaySales.toFixed(2)}`, icon: IndianRupee, color: "#22c55e" },
    { label: "Orders Today", value: summary?.ordersToday ?? todayOrders.length, icon: ReceiptText, color: "#3b82f6" },
    { label: "Avg Order Value", value: `₹${avgOrder.toFixed(2)}`, icon: TrendingUp, color: "#f59e0b" },
    { label: "Deliveries", value: deliveries, icon: Bike, color: "#a855f7" },
  ];

  return (
    <div className="h-full overflow-y-auto pos-scroll p-4 space-y-4" data-testid="reports-screen">
      <h2 className="text-xl font-bold text-white">Sales Dashboard</h2>

      {/* Labour cost widget — Manager-only */}
      {staffUser?.role === "Manager" && labour && (
        <div className="rounded-xl p-4 flex items-center gap-4" data-testid="labour-widget"
          style={{ background: "linear-gradient(135deg, #1c2438 0%, #101a30 100%)", border: "1px solid var(--pos-border)" }}>
          <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#fcd34d22" }}>
            <Users className="w-6 h-6" style={{ color: "#fcd34d" }} />
          </div>
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Labour cost today</div>
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-bold text-white tabular-nums" data-testid="labour-today">₹{labour.today_cost.toFixed(2)}</span>
              <span className="text-xs" style={{ color: "var(--pos-muted)" }}>
                {labour.currently_in_count} on shift now
              </span>
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: "var(--pos-muted)" }}>
              30-day run-rate at this pace: <span className="text-white tabular-nums">₹{labour.monthly_run_rate.toFixed(2)}</span>
            </div>
          </div>
          {todaySales > 0 && (
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Labour vs sales</div>
              <div className="text-xl font-bold tabular-nums" style={{ color: labour.today_cost / todaySales > 0.4 ? "#fca5a5" : "#86efac" }}>
                {((labour.today_cost / todaySales) * 100).toFixed(1)}%
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {STATS.map((s) => (
          <div key={s.label} className="rounded-xl p-4 flex items-center gap-3" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }} data-testid={`stat-${s.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
            <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${s.color}22` }}>
              <s.icon className="w-5 h-5" style={{ color: s.color }} />
            </div>
            <div>
              <div className="text-xl font-bold text-white tabular-nums">{s.value}</div>
              <div className="text-xs" style={{ color: "var(--pos-muted)" }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Weekly chart */}
        <div className="lg:col-span-2 rounded-xl p-5" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }} data-testid="weekly-chart">
          <div className="font-semibold text-white mb-1">Weekly Sales</div>
          <div className="text-xs mb-5" style={{ color: "var(--pos-muted)" }}>Last 7 days · ₹{weekly.reduce((s, d) => s + d.sales, 0).toFixed(0)} total</div>
          <div className="flex items-end gap-3 h-44">
            {weekly.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1.5">
                <span className="text-[10px] tabular-nums" style={{ color: "var(--pos-muted)" }}>₹{d.sales.toFixed(0)}</span>
                <div className="w-full rounded-t-md" style={{ height: `${(d.sales / maxSales) * 100}%`, background: d.sales === maxSales ? "var(--pos-accent)" : "#2c3d61", minHeight: 8, transition: "height 0.4s ease" }} />
                <span className="text-xs font-medium" style={{ color: "var(--pos-muted)" }}>{d.day}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Payment split + top items */}
        <div className="space-y-4">
          <div className="rounded-xl p-5" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }} data-testid="payment-split">
            <div className="font-semibold text-white mb-3">Payment Methods (today)</div>
            {[{ label: "Card", val: cardTotal, color: "#3b82f6" }, { label: "Cash", val: cashTotal, color: "#22c55e" }, { label: "Unpaid / Open", val: unpaidTotal, color: "#f59e0b" }].map((p) => (
              <div key={p.label} className="mb-3">
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: "var(--pos-muted)" }}>{p.label}</span>
                  <span className="text-white tabular-nums font-semibold">₹{p.val.toFixed(2)}</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--pos-panel-2)" }}>
                  <div className="h-full rounded-full" style={{ width: `${(p.val / payTotal) * 100}%`, background: p.color, transition: "width 0.4s ease" }} />
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl p-5" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }} data-testid="top-items">
            <div className="font-semibold text-white mb-3">Top Sellers (this week)</div>
            {topItems.map((t, i) => (
              <div key={t.name} className="flex items-center justify-between py-2" style={{ borderBottom: i < topItems.length - 1 ? "1px solid var(--pos-border)" : "none" }}>
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold" style={{ background: "var(--pos-panel-2)", color: "var(--pos-accent)" }}>{i + 1}</span>
                  <div>
                    <div className="text-sm text-white font-medium">{t.name}</div>
                    <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>{t.sold} sold</div>
                  </div>
                </div>
                <span className="text-sm font-bold text-white tabular-nums">₹{t.revenue.toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {staffUser?.role === "Manager" && (
        <>
          <CollapsibleSection
            title="Z-Report · Cash Drawer"
            icon={DollarSign}
            testid="reports-zreport"
            defaultOpen={false}
          >
            <CashDrawerPanel />
          </CollapsibleSection>
          <CollapsibleSection
            title="Tip Pool"
            icon={Coins}
            testid="reports-tippool"
            defaultOpen={false}
          >
            <TipPoolPanel />
          </CollapsibleSection>
        </>
      )}
    </div>
  );
}

function CollapsibleSection({ title, icon: Icon, testid, defaultOpen, children }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="rounded-xl" data-testid={testid}
      style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
      <button onClick={() => setOpen((v) => !v)} data-testid={`${testid}-toggle`}
        className="pos-btn w-full flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Icon className="w-4 h-4" style={{ color: "var(--pos-accent)" }} />
          {title}
        </div>
        {open ? <ChevronUp className="w-4 h-4" style={{ color: "var(--pos-muted)" }} /> : <ChevronDown className="w-4 h-4" style={{ color: "var(--pos-muted)" }} />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}
