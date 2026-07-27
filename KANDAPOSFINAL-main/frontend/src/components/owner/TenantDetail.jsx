import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ownerData } from "../../api/ownerClient";
import { ArrowLeft, IndianRupee, ShoppingCart, Boxes, Users, Loader2, LogIn } from "lucide-react";
import ImpersonateModal from "./ImpersonateModal";
import TenantBillingCard from "./TenantBillingCard";
import KdsTokenCard from "./KdsTokenCard";
import TenantFeaturesCard from "./TenantFeaturesCard";

export default function TenantDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [impOpen, setImpOpen] = useState(false);

  useEffect(() => {
    let cancel = false;
    ownerData.tenant(id).then((d) => { if (!cancel) setData(d); }).catch(() => {});
    return () => { cancel = true; };
  }, [id]);

  if (!data) {
    return <div className="flex items-center gap-2 text-white"><Loader2 className="w-5 h-5 animate-spin" /> Loading tenant…</div>;
  }
  const { tenant, kpis, staff } = data;

  const tiles = [
    { label: "Orders today",  value: kpis.ordersToday, icon: ShoppingCart, color: "#a855f7" },
    { label: "Orders MTD",    value: kpis.ordersMonth, icon: ShoppingCart, color: "#3b82f6" },
    { label: "GMV today",     value: `₹${kpis.gmvToday.toFixed(2)}`, icon: IndianRupee, color: "#22c55e" },
    { label: "GMV MTD",       value: `₹${kpis.gmvMonth.toFixed(2)}`, icon: IndianRupee, color: "#f59e0b" },
    { label: "Menu items",    value: kpis.menuItems, icon: Boxes, color: "#06b6d4" },
    { label: "Customers",     value: kpis.customers, icon: Users, color: "#ec4899" },
  ];

  return (
    <div className="space-y-5" data-testid="tenant-detail">
      <button onClick={() => navigate("/owner/tenants")} className="text-xs flex items-center gap-1" style={{ color: "var(--pos-muted)" }}>
        <ArrowLeft className="w-3 h-3" /> All tenants
      </button>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">{tenant.name}</h1>
          <div className="text-xs" style={{ color: "var(--pos-muted)" }}>
            <code>{tenant.slug}.kanda.app</code> · {tenant.contact_email || "—"} · {tenant.plan}
          </div>
          {tenant.store && (
            <div className="text-xs mt-1" style={{ color: "var(--pos-muted)" }}>
              {tenant.store.address}
              {tenant.store.phone ? ` · ${tenant.store.phone}` : ""}
              {tenant.store.tax_id ? ` · ${tenant.store.tax_id}` : ""}
            </div>
          )}
        </div>
        <button data-testid="impersonate-btn" onClick={() => setImpOpen(true)}
          className="pos-btn h-10 px-4 rounded-lg text-sm font-bold text-white flex items-center gap-1.5"
          style={{ background: "var(--pos-accent)" }}>
          <LogIn className="w-4 h-4" /> Open POS
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl p-3" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>{t.label}</span>
              <t.icon className="w-3.5 h-3.5" style={{ color: t.color }} />
            </div>
            <div className="text-lg font-bold text-white tabular-nums mt-2">{t.value}</div>
          </div>
        ))}
      </div>

      <TenantBillingCard tenantId={tenant.id} />
      <TenantFeaturesCard tenant={tenant} onChanged={(t) => setData((prev) => ({ ...prev, tenant: { ...prev.tenant, business_type: t.business_type ?? t.businessType ?? prev.tenant.business_type, features: t.features ?? prev.tenant.features } }))} />
      <KdsTokenCard tenantId={tenant.id} />

      <div className="rounded-xl" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
        <div className="px-4 py-3 text-sm font-semibold text-white" style={{ borderBottom: "1px solid var(--pos-border)" }}>Staff ({staff.length})</div>
        <div className="divide-y" style={{ borderColor: "var(--pos-border)" }}>
          {staff.map((s) => (
            <div key={s.id} className="px-4 py-2 flex items-center justify-between" style={{ borderBottom: "1px solid var(--pos-border)" }}>
              <div>
                <div className="text-sm font-semibold text-white">{s.name}</div>
                <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>{s.role} · {s.initials}</div>
              </div>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>{s.id}</div>
            </div>
          ))}
          {!staff.length && <div className="px-4 py-6 text-sm text-center" style={{ color: "var(--pos-muted)" }}>No staff seeded yet.</div>}
        </div>
      </div>

      <ImpersonateModal tenant={tenant} open={impOpen} onClose={() => setImpOpen(false)} />
    </div>
  );
}
