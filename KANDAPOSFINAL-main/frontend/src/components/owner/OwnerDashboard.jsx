import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ownerData } from "../../api/ownerClient";
import { Store, ShoppingCart, IndianRupee, TrendingUp, Loader2, ChevronRight } from "lucide-react";

const STAT_TILES = (k) => [
  { label: "Tenants", value: k.totalTenants, sub: `${k.activeTenants} active`, icon: Store, color: "#3b82f6" },
  { label: "Active today", value: k.activeToday, sub: "stores ringing orders", icon: TrendingUp, color: "#22c55e" },
  { label: "Orders today", value: k.ordersToday, sub: "across the platform", icon: ShoppingCart, color: "#a855f7" },
  { label: "GMV today", value: `₹${(k.gmvToday || 0).toFixed(2)}`, sub: `₹${(k.gmvMonth || 0).toFixed(2)} MTD`, icon: IndianRupee, color: "#f59e0b" },
];

export default function OwnerDashboard() {
  const [k, setK] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [busy, setBusy] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancel = false;
    Promise.all([ownerData.kpis(), ownerData.tenants()])
      .then(([kp, ts]) => { if (!cancel) { setK(kp); setTenants(ts); } })
      .finally(() => { if (!cancel) setBusy(false); });
    return () => { cancel = true; };
  }, []);

  if (busy) return <div className="flex items-center gap-2" style={{ color: "var(--pos-text)" }}><Loader2 className="w-5 h-5 animate-spin" /> Loading platform metrics…</div>;

  return (
    <div data-testid="owner-dashboard" className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: "var(--pos-text)" }}>Platform overview</h1>
        <div className="text-xs px-2 py-1 rounded-full" style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
          Live
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {STAT_TILES(k).map((t) => (
          <div key={t.label} className="rounded-xl p-4" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }} data-testid={`owner-kpi-${t.label.toLowerCase().replace(/\s/g, "-")}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>{t.label}</span>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: t.color + "22", color: t.color }}>
                <t.icon className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold tabular-nums mt-3" style={{ color: "var(--pos-text)" }}>{t.value}</div>
            <div className="text-[11px] mt-0.5" style={{ color: "var(--pos-muted)" }}>{t.sub}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--pos-border)" }}>
          <div className="text-sm font-semibold" style={{ color: "var(--pos-text)" }}>Tenants</div>
          <button onClick={() => navigate("/owner/tenants")} className="text-xs flex items-center gap-1" style={{ color: "var(--pos-accent)" }}>
            View all <ChevronRight className="w-3 h-3" />
          </button>
        </div>
        <div>
          {tenants.slice(0, 6).map((t) => (
            <button key={t.id} data-testid={`owner-tenant-row-${t.slug}`} onClick={() => navigate(`/owner/tenants/${t.id}`)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/[0.02] text-left"
              style={{ borderBottom: "1px solid var(--pos-border)" }}>
              <div>
                <div className="font-semibold" style={{ color: "var(--pos-text)" }}>{t.name}</div>
                <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>{t.slug} · {t.staffCount ?? 0} staff · {t.plan}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold tabular-nums" style={{ color: "var(--pos-text)" }}>{t.ordersToday ?? 0}</div>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>orders today</div>
              </div>
            </button>
          ))}
          {!tenants.length && (
            <div className="px-4 py-6 text-sm text-center" style={{ color: "var(--pos-muted)" }}>No tenants yet — provision your first one.</div>
          )}
        </div>
      </div>
    </div>
  );
}
