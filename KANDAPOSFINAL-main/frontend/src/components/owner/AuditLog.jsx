import React, { useEffect, useState } from "react";
import { ownerData } from "../../api/ownerClient";
import { ClipboardCheck, Loader2, RefreshCw, ShieldAlert } from "lucide-react";

const ACTOR_COLOR = { staff: "#22c55e", owner: "#3b82f6", impersonator: "#f59e0b", anon: "#a3a3a3" };
const METHOD_COLOR = { POST: "#22c55e", PUT: "#3b82f6", PATCH: "#a855f7", DELETE: "#ef4444" };

export default function AuditLog() {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(true);
  const [tenantFilter, setTenantFilter] = useState("");

  const load = () => {
    setBusy(true);
    ownerData.audit({ limit: 200, ...(tenantFilter ? { tenant_id: tenantFilter } : {}) })
      .then(setRows).finally(() => setBusy(false));
  };
  useEffect(() => { load(); }, [tenantFilter]); // eslint-disable-line

  return (
    <div data-testid="owner-audit-log" className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-5 h-5" style={{ color: "#22c55e" }} />
          <h1 className="text-2xl font-bold" style={{ color: "var(--pos-text)" }}>Audit log</h1>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>{rows.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <input data-testid="audit-tenant-filter" value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)}
            placeholder="Filter by tenant id" className="h-9 px-3 rounded-lg text-xs"
            style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
          <button data-testid="audit-refresh" onClick={load} className="pos-btn h-9 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5"
            style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {busy ? (
        <div className="flex items-center gap-2" style={{ color: "var(--pos-text)" }}><Loader2 className="w-5 h-5 animate-spin" /> Loading…</div>
      ) : !rows.length ? (
        <div className="rounded-xl p-8 text-center text-sm" style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
          No audit entries yet.
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)", background: "var(--pos-panel-2)" }}>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Tenant</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Method</th>
                <th className="px-3 py-2">Route</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`audit-row-${r.id}`} style={{ borderTop: "1px solid var(--pos-border)" }}>
                  <td className="px-3 py-2 text-[11px] tabular-nums" style={{ color: "var(--pos-muted)" }}>{new Date(r.at).toLocaleString()}</td>
                  <td className="px-3 py-2" style={{ color: "var(--pos-text)" }}>{r.tenant_id || "—"}</td>
                  <td className="px-3 py-2 text-[11px]" style={{ color: "var(--pos-text)" }}>
                    <span className="font-mono">{r.actor_id}</span>
                    <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px]" style={{ background: "var(--pos-panel-2)", color: ACTOR_COLOR[r.actor_type] || "#a3a3a3" }}>
                      {r.actor_type}{r.actor_role ? ` · ${r.actor_role}` : ""}
                    </span>
                    {r.imp_owner && (
                      <span className="ml-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(217,119,6,0.15)", color: "#d97706" }}>
                        <ShieldAlert className="w-2.5 h-2.5" /> by {r.imp_owner}{r.auditor_session ? " (auditor)" : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-bold text-[11px]" style={{ color: METHOD_COLOR[r.method] || "var(--pos-text)" }}>{r.method}</td>
                  <td className="px-3 py-2 font-mono text-[11px]" style={{ color: "var(--pos-text)" }}>{r.route}</td>
                  <td className="px-3 py-2 tabular-nums" style={{ color: r.status >= 400 ? "#d97706" : "var(--pos-muted)" }}>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
