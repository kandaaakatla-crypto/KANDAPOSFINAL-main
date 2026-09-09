import React, { useEffect, useState } from "react";
import { ownerData } from "../../api/ownerClient";
import { AlertOctagon, Loader2, RefreshCw } from "lucide-react";

const STATUS_COLOR = (s) => (s >= 500 ? "#ef4444" : s >= 400 ? "#f59e0b" : "#a3a3a3");

export default function ErrorLog() {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(true);
  const [open, setOpen] = useState(null); // selected error row for traceback view
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancel = false;
    setBusy(true);
    ownerData.errors({ limit: 200 })
      .then((data) => { if (!cancel) setRows(data); })
      .finally(() => { if (!cancel) setBusy(false); });
    return () => { cancel = true; };
  }, [tick]);

  const load = () => setTick((t) => t + 1);

  return (
    <div data-testid="owner-error-log" className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertOctagon className="w-5 h-5" style={{ color: "#ef4444" }} />
          <h1 className="text-2xl font-bold" style={{ color: "var(--pos-text)" }}>Error log</h1>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>{rows.length}</span>
        </div>
        <button data-testid="errors-refresh" onClick={load} className="pos-btn h-9 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5"
          style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {busy ? (
        <div className="flex items-center gap-2" style={{ color: "var(--pos-text)" }}><Loader2 className="w-5 h-5 animate-spin" /> Loading…</div>
      ) : !rows.length ? (
        <div className="rounded-xl p-8 text-center text-sm" style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
          No errors captured. 🎉
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)", background: "var(--pos-panel-2)" }}>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Tenant</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Route</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Message</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`error-row-${r.id}`} onClick={() => setOpen(r)}
                  className="cursor-pointer hover:bg-white/[0.02]" style={{ borderTop: "1px solid var(--pos-border)" }}>
                  <td className="px-3 py-2 text-[11px] tabular-nums" style={{ color: "var(--pos-muted)" }}>{new Date(r.at).toLocaleString()}</td>
                  <td className="px-3 py-2" style={{ color: "var(--pos-text)" }}>{r.tenant_id || "—"}</td>
                  <td className="px-3 py-2" style={{ color: "var(--pos-text)" }}>{r.actor_id || "—"} <span className="text-[10px]" style={{ color: "var(--pos-muted)" }}>{r.actor_type}</span></td>
                  <td className="px-3 py-2 font-mono text-[11px]" style={{ color: "var(--pos-text)" }}>{r.method} {r.route}</td>
                  <td className="px-3 py-2 font-bold tabular-nums" style={{ color: STATUS_COLOR(r.status) }}>{r.status}</td>
                  <td className="px-3 py-2 truncate max-w-[280px]" style={{ color: "var(--pos-text)" }}>{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setOpen(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl rounded-xl p-5" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }} data-testid="error-detail">
            <div className="flex items-center justify-between mb-2">
              <div className="font-bold" style={{ color: "var(--pos-text)" }}>{open.method} {open.route}</div>
              <button onClick={() => setOpen(null)} className="text-xs" style={{ color: "var(--pos-muted)" }}>Close</button>
            </div>
            <div className="text-xs" style={{ color: "var(--pos-muted)" }}>{new Date(open.at).toLocaleString()} · status {open.status} · tenant {open.tenant_id || "—"} · actor {open.actor_id || "—"}</div>
            <div className="mt-3 text-sm" style={{ color: "var(--pos-text)" }}>{open.message}</div>
            {open.traceback && (
              <pre className="mt-3 max-h-[55vh] overflow-auto p-3 text-[11px] font-mono rounded-lg whitespace-pre-wrap"
                style={{ background: "var(--pos-panel-2)", color: "#fca5a5", border: "1px solid var(--pos-border)" }}>{open.traceback}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
