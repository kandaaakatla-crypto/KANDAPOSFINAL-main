import React, { useEffect, useMemo, useState } from "react";
import { payrollApi } from "../../api/client";
import { Input } from "../ui/input";
import { Download, Banknote } from "lucide-react";
import { toast } from "sonner";

function isoDate(d) { return d.toISOString().slice(0, 10); }
function startOfMonth(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }

export default function PayrollScreen() {
  const today = useMemo(() => new Date(), []);
  const [start, setStart] = useState(isoDate(startOfMonth(today)));
  const [end, setEnd] = useState(isoDate(today));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const apiBase = `${process.env.REACT_APP_BACKEND_URL}/api`;

  const load = () => {
    setLoading(true);
    // `end` from the endpoint's point of view is exclusive, so push it one
    // day forward to include the whole selected end date.
    const endExclusive = new Date(`${end}T00:00:00Z`);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    payrollApi.summary({ start: `${start}T00:00:00Z`, end: endExclusive.toISOString() })
      .then((d) => { setRows(d); setLoading(false); })
      .catch(() => { toast.error("Could not load payroll"); setLoading(false); });
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [start, end]);

  const totals = rows.reduce((acc, r) => ({
    hours: acc.hours + r.total_hours,
    overtime: acc.overtime + r.overtime_hours,
    wage: acc.wage + r.wage_pay,
    tips: acc.tips + r.tips,
    gross: acc.gross + r.gross_pay,
  }), { hours: 0, overtime: 0, wage: 0, tips: 0, gross: 0 });

  const downloadCsv = async () => {
    const token = localStorage.getItem("kanda_pos_token_v1");
    const endExclusive = new Date(`${end}T00:00:00Z`);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    const url = `${apiBase}/payroll/summary.csv?start=${encodeURIComponent(`${start}T00:00:00Z`)}&end=${encodeURIComponent(endExclusive.toISOString())}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) { toast.error("Download failed"); return; }
    const blob = await r.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl; a.download = `payroll-${start}-to-${end}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  };

  return (
    <div className="p-5" data-testid="payroll-screen">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2"><Banknote className="w-5 h-5" style={{ color: "var(--pos-accent)" }} /> Payroll</h1>
          <p className="text-sm" style={{ color: "var(--pos-muted)" }}>
            Wages from hours worked or salary, plus tips owed, for the selected period.
          </p>
        </div>
        <button data-testid="payroll-export-csv" onClick={downloadCsv}
          className="pos-btn h-10 px-4 rounded-md text-xs font-bold text-white flex items-center gap-2"
          style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      <div className="flex items-end gap-3 mt-4 mb-5 flex-wrap">
        <label className="block">
          <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--pos-muted)" }}>From</div>
          <Input data-testid="payroll-start" type="date" value={start} onChange={(e) => setStart(e.target.value)}
            className="h-10 text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
        </label>
        <label className="block">
          <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--pos-muted)" }}>To</div>
          <Input data-testid="payroll-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)}
            className="h-10 text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
        </label>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--pos-border)" }}>
        <table className="w-full text-sm hidden md:table">
          <thead>
            <tr style={{ background: "var(--pos-panel)" }}>
              {["Employee", "Role", "Pay type", "Hours", "Overtime", "Wage pay", "Tips", "Total payable"].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs uppercase tracking-wider font-semibold" style={{ color: "var(--pos-muted)", borderBottom: "1px solid var(--pos-border)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="text-center py-8" style={{ color: "var(--pos-muted)" }}>Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={8} className="text-center py-8" style={{ color: "var(--pos-muted)" }}>No staff found.</td></tr>}
            {rows.map((r) => (
              <tr key={r.user_id} data-testid={`payroll-row-${r.user_id}`} style={{ borderBottom: "1px solid var(--pos-border)" }}>
                <td className="px-4 py-3 font-medium text-white">{r.user_name}</td>
                <td className="px-4 py-3" style={{ color: "var(--pos-muted)" }}>{r.role}</td>
                <td className="px-4 py-3 capitalize" style={{ color: "var(--pos-muted)" }}>{r.pay_type}</td>
                <td className="px-4 py-3 tabular-nums">{r.pay_type === "hourly" ? r.total_hours.toFixed(2) : "—"}</td>
                <td className="px-4 py-3 tabular-nums" style={{ color: r.overtime_hours > 0 ? "#fcd34d" : "var(--pos-muted)" }}>{r.pay_type === "hourly" ? r.overtime_hours.toFixed(2) : "—"}</td>
                <td className="px-4 py-3 tabular-nums">₹{r.wage_pay.toFixed(2)}</td>
                <td className="px-4 py-3 tabular-nums" style={{ color: r.tips > 0 ? "#7ee2a8" : "var(--pos-muted)" }}>₹{r.tips.toFixed(2)}</td>
                <td className="px-4 py-3 tabular-nums font-bold" style={{ color: "var(--pos-accent)" }}>₹{r.gross_pay.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr style={{ background: "var(--pos-panel)" }}>
                <td className="px-4 py-3 font-bold text-white" colSpan={3}>Total</td>
                <td className="px-4 py-3 tabular-nums font-bold text-white">{totals.hours.toFixed(2)}</td>
                <td className="px-4 py-3 tabular-nums font-bold text-white">{totals.overtime.toFixed(2)}</td>
                <td className="px-4 py-3 tabular-nums font-bold text-white">₹{totals.wage.toFixed(2)}</td>
                <td className="px-4 py-3 tabular-nums font-bold text-white">₹{totals.tips.toFixed(2)}</td>
                <td className="px-4 py-3 tabular-nums font-bold" style={{ color: "var(--pos-accent)" }}>₹{totals.gross.toFixed(2)}</td>
              </tr>
            </tfoot>
          )}
        </table>

        {/* Mobile card list */}
        <div className="md:hidden divide-y" style={{ borderColor: "var(--pos-border)" }}>
          {loading && <div className="text-center py-8 text-sm" style={{ color: "var(--pos-muted)" }}>Loading…</div>}
          {!loading && rows.length === 0 && <div className="text-center py-8 text-sm" style={{ color: "var(--pos-muted)" }}>No staff found.</div>}
          {rows.map((r) => (
            <div key={r.user_id} data-testid={`payroll-row-${r.user_id}`} className="p-3 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <div className="font-medium text-white text-sm">{r.user_name}</div>
                <div className="text-xs" style={{ color: "var(--pos-muted)" }}>{r.role} · {r.pay_type}</div>
              </div>
              {r.pay_type === "hourly" && (
                <div className="text-xs" style={{ color: "var(--pos-muted)" }}>
                  {r.total_hours.toFixed(2)}h worked
                  {r.overtime_hours > 0 && <span style={{ color: "#fcd34d" }}> · {r.overtime_hours.toFixed(2)}h OT</span>}
                </div>
              )}
              <div className="flex items-center justify-between text-sm mt-1">
                <span style={{ color: "var(--pos-muted)" }}>Wage ₹{r.wage_pay.toFixed(2)} + Tips ₹{r.tips.toFixed(2)}</span>
                <span className="font-bold tabular-nums" style={{ color: "var(--pos-accent)" }}>₹{r.gross_pay.toFixed(2)}</span>
              </div>
            </div>
          ))}
          {rows.length > 0 && (
            <div className="p-3 flex items-center justify-between font-bold text-white" style={{ background: "var(--pos-panel)" }}>
              <span>Total</span>
              <span className="tabular-nums" style={{ color: "var(--pos-accent)" }}>₹{totals.gross.toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] mt-3" style={{ color: "var(--pos-muted)" }}>
        Hourly wages include a 0.5× premium on hours past 40/period. Monthly salaries are prorated to the selected date range. Tips are pulled from Tip Pool allocations (Reports → Tip Pool) whose date falls in range.
      </p>
    </div>
  );
}
