import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ownerData } from "../../api/ownerClient";
import { Search, Plus, Loader2 } from "lucide-react";
import { Input } from "../ui/input";

export default function TenantsList() {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancel = false;
    ownerData.tenants().then((d) => { if (!cancel) setTenants(d); }).finally(() => { if (!cancel) setBusy(false); });
    return () => { cancel = true; };
  }, []);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return tenants;
    return tenants.filter((t) =>
      t.name.toLowerCase().includes(n) || t.slug.toLowerCase().includes(n) || (t.contact_email || "").toLowerCase().includes(n)
    );
  }, [q, tenants]);

  return (
    <div className="space-y-4" data-testid="tenants-list">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">Tenants</h1>
        <button data-testid="new-tenant-btn" onClick={() => navigate("/owner/tenants/new")}
          className="pos-btn h-10 px-4 rounded-lg text-sm font-bold text-white flex items-center gap-1.5"
          style={{ background: "var(--pos-accent)" }}>
          <Plus className="w-4 h-4" /> New tenant
        </button>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-3.5" style={{ color: "var(--pos-muted)" }} />
        <Input data-testid="tenants-search" placeholder="Search by name, slug, or contact email"
          value={q} onChange={(e) => setQ(e.target.value)}
          className="pl-9 h-11 text-white" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} />
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
        <div className="grid grid-cols-[1fr_120px_120px_120px_120px] gap-3 px-4 py-3 text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--pos-muted)", borderBottom: "1px solid var(--pos-border)" }}>
          <span>Tenant</span><span>Plan</span><span>Staff</span><span>Orders today</span><span className="text-right">Status</span>
        </div>
        {busy && <div className="px-4 py-6 flex items-center gap-2" style={{ color: "var(--pos-muted)" }}><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
        {!busy && filtered.map((t) => (
          <button key={t.id} data-testid={`tenants-row-${t.slug}`} onClick={() => navigate(`/owner/tenants/${t.id}`)}
            className="w-full grid grid-cols-[1fr_120px_120px_120px_120px] gap-3 px-4 py-3 items-center text-left hover:bg-white/[0.02]"
            style={{ borderBottom: "1px solid var(--pos-border)" }}>
            <div>
              <div className="font-semibold text-white">{t.name}</div>
              <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>{t.slug} · {t.contact_email || "—"}</div>
            </div>
            <div className="text-sm text-white capitalize">{t.plan}</div>
            <div className="text-sm tabular-nums text-white">{t.staffCount ?? 0}</div>
            <div className="text-sm tabular-nums text-white">{t.ordersToday ?? 0}</div>
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full"
                style={{ background: t.status === "active" ? "#13271a" : "#321519", color: t.status === "active" ? "#22c55e" : "#f87171" }}>
                {t.status}
              </span>
            </div>
          </button>
        ))}
        {!busy && !filtered.length && (
          <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--pos-muted)" }}>No tenants matched "{q}".</div>
        )}
      </div>
    </div>
  );
}
