import React, { useEffect, useMemo, useState } from "react";
import { usePos } from "../../store/PosContext";
import { useDash } from "../../store/DashContext";
import { timeclockApi, shiftsApi, staffApi, authToken, authHeaders } from "../../api/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { ChevronLeft, ChevronRight, Download, PlusCircle, Trash2, CheckCircle2, Clock, FileText, CopyPlus } from "lucide-react";
import { toast } from "sonner";

export function startOfWeek(d) {
  const r = new Date(d);
  const day = (r.getUTCDay() + 6) % 7; // Mon=0
  r.setUTCDate(r.getUTCDate() - day);
  r.setUTCHours(0, 0, 0, 0);
  return r;
}
function isoDate(d) { return d.toISOString().slice(0, 10); }
function fmtDay(d) { return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }); }
function fmtTime(iso) { return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); }

export default function WorkforceScreen() {
  const { staffUser } = usePos();
  // Rendered both at /:slug/workforce (POS, staff-PIN session) and at
  // /dashboard/workforce (Dashboard, no staff PIN — email/password login
  // only). A dash session with no POS session gets the full manager view:
  // every dashboard role can see workforce (canManageWorkforce in
  // DashContext.jsx), scoped server-side by location_ids the same as
  // everything else on the dashboard.
  const { user: dashUser } = useDash();
  const inDashboard = !staffUser && !!dashUser;
  const isManager = inDashboard ? true : staffUser?.role === "Manager";
  const [tab, setTab] = useState(isManager ? "timesheet" : "myrota");
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date()));
  const weekEnd = useMemo(() => { const d = new Date(weekStart); d.setUTCDate(d.getUTCDate() + 7); return d; }, [weekStart]);
  const apiBase = `${process.env.REACT_APP_BACKEND_URL}/api`;

  const shiftWeek = (delta) => { const d = new Date(weekStart); d.setUTCDate(d.getUTCDate() + delta * 7); setWeekStart(d); };

  const tabs = isManager
    ? [["timesheet", "Timesheets"], ["rota", "Rota"], ["live", "Currently In"]]
    : [["myrota", "My Rota"]];

  return (
    <div className="h-full flex flex-col" data-testid="workforce-screen">
      <div className="p-5 pb-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "var(--pos-text)" }}>{isManager ? "Workforce" : "My Schedule"}</h1>
            <p className="text-sm" style={{ color: "var(--pos-muted)" }}>
              {isManager
                ? "Timesheets, rota and currently-clocked-in staff."
                : `${staffUser?.name} · ${staffUser?.role} — your published shifts for the week.`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button data-testid="wf-prev-week" onClick={() => shiftWeek(-1)} className="pos-btn p-2 rounded-md" style={{ background: "var(--pos-panel-2)" }}>
              <ChevronLeft className="w-4 h-4" style={{ color: "var(--pos-text)" }} />
            </button>
            <div className="text-sm tabular-nums px-3" style={{ color: "var(--pos-text)" }} data-testid="wf-week-label">
              {weekStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – {new Date(weekEnd.getTime() - 86400000).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </div>
            <button data-testid="wf-next-week" onClick={() => shiftWeek(1)} className="pos-btn p-2 rounded-md" style={{ background: "var(--pos-panel-2)" }}>
              <ChevronRight className="w-4 h-4" style={{ color: "var(--pos-text)" }} />
            </button>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          {tabs.map(([key, label]) => (
            <button key={key} data-testid={`wf-tab-${key}`} onClick={() => setTab(key)}
              className="pos-btn h-9 px-4 rounded-md text-xs font-bold"
              style={{ background: tab === key ? "var(--pos-accent)" : "var(--pos-panel-2)", color: tab === key ? "#fff" : "var(--pos-text)" }}>{label}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-5 pb-5">
        {tab === "timesheet" && <TimesheetTab weekStart={weekStart} weekEnd={weekEnd} apiBase={apiBase} />}
        {tab === "rota" && <RotaTab weekStart={weekStart} apiBase={apiBase} />}
        {tab === "live" && <LiveTab />}
        {tab === "myrota" && <MyRotaTab weekStart={weekStart} weekEnd={weekEnd} />}
      </div>
    </div>
  );
}

function TimesheetTab({ weekStart, weekEnd, apiBase }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    timeclockApi.timesheet({ start: weekStart.toISOString(), end: weekEnd.toISOString() })
      .then((d) => { setRows(d); setLoading(false); }).catch(() => setLoading(false));
  }, [weekStart, weekEnd]);

  const downloadCsv = async () => {
    const token = authToken();
    const r = await fetch(`${apiBase}/timeclock/timesheet.csv?start=${encodeURIComponent(weekStart.toISOString())}&end=${encodeURIComponent(weekEnd.toISOString())}`,
      { headers: authHeaders(token) });
    if (!r.ok) { toast.error("Download failed"); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `timesheet-${isoDate(weekStart)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button data-testid="ts-export-csv" onClick={downloadCsv} className="pos-btn h-9 px-4 rounded-md text-xs font-bold flex items-center gap-2"
          style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>
      <table className="w-full text-sm hidden md:table">
        <thead style={{ color: "var(--pos-muted)" }}>
          <tr style={{ borderBottom: "1px solid var(--pos-border)" }}>
            <th className="text-left py-2 px-3 uppercase text-[11px] tracking-wider">Employee</th>
            <th className="text-left py-2 px-3 uppercase text-[11px] tracking-wider">Role</th>
            <th className="text-right py-2 px-3 uppercase text-[11px] tracking-wider">Days</th>
            <th className="text-right py-2 px-3 uppercase text-[11px] tracking-wider">Total hrs</th>
            <th className="text-right py-2 px-3 uppercase text-[11px] tracking-wider">Overtime</th>
            <th className="text-right py-2 px-3 uppercase text-[11px] tracking-wider">Rate</th>
            <th className="text-right py-2 px-3 uppercase text-[11px] tracking-wider">Gross pay</th>
          </tr>
        </thead>
        <tbody style={{ color: "var(--pos-text)" }}>
          {loading && <tr><td colSpan={7} className="text-center py-8" style={{ color: "var(--pos-muted)" }}>Loading…</td></tr>}
          {!loading && rows.length === 0 && <tr><td colSpan={7} className="text-center py-8" style={{ color: "var(--pos-muted)" }}>No data for this week.</td></tr>}
          {rows.map((r) => (
            <tr key={r.user_id} data-testid={`ts-row-${r.user_id}`} style={{ borderTop: "1px solid var(--pos-border)" }}>
              <td className="py-3 px-3">{r.user_name}</td>
              <td className="py-3 px-3" style={{ color: "var(--pos-muted)" }}>{r.role}</td>
              <td className="py-3 px-3 text-right tabular-nums">{r.days_worked}</td>
              <td className="py-3 px-3 text-right tabular-nums">{r.total_hours.toFixed(2)}</td>
              <td className="py-3 px-3 text-right tabular-nums" style={{ color: r.overtime_hours > 0 ? "#fcd34d" : "var(--pos-muted)" }}>{r.overtime_hours.toFixed(2)}</td>
              <td className="py-3 px-3 text-right tabular-nums">₹{r.hourly_rate.toFixed(2)}</td>
              <td className="py-3 px-3 text-right tabular-nums font-bold">₹{r.gross_pay.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile card list */}
      <div className="md:hidden">
        {loading && <div className="text-center py-8 text-sm" style={{ color: "var(--pos-muted)" }}>Loading…</div>}
        {!loading && rows.length === 0 && <div className="text-center py-8 text-sm" style={{ color: "var(--pos-muted)" }}>No data for this week.</div>}
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.user_id} data-testid={`ts-row-${r.user_id}`} className="rounded-lg p-3" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
              <div className="flex items-center justify-between">
                <div className="font-medium">{r.user_name}</div>
                <div className="text-xs" style={{ color: "var(--pos-muted)" }}>{r.role}</div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mt-2" style={{ color: "var(--pos-muted)" }}>
                <span>Days: <b style={{ color: "var(--pos-text)" }}>{r.days_worked}</b></span>
                <span>Hours: <b style={{ color: "var(--pos-text)" }}>{r.total_hours.toFixed(2)}</b></span>
                <span>Overtime: <b style={{ color: r.overtime_hours > 0 ? "#fcd34d" : "var(--pos-muted)" }}>{r.overtime_hours.toFixed(2)}</b></span>
                <span>Rate: <b style={{ color: "var(--pos-text)" }}>₹{r.hourly_rate.toFixed(2)}</b></span>
              </div>
              <div className="text-right font-bold tabular-nums mt-2">₹{r.gross_pay.toFixed(2)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RotaTab({ weekStart, apiBase }) {
  const [staff, setStaff] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [editing, setEditing] = useState(null);
  const [confirmState, setConfirmState] = useState(null); // { message, onConfirm }

  const weekEnd = useMemo(() => { const d = new Date(weekStart); d.setUTCDate(d.getUTCDate() + 7); return d; }, [weekStart]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setUTCDate(d.getUTCDate() + i); return d; }), [weekStart]);

  const load = () => {
    Promise.all([
      staffApi.list().then((s) => s.filter((x) => x.active)),
      shiftsApi.list({ start: weekStart.toISOString(), end: weekEnd.toISOString() }),
    ]).then(([s, sh]) => { setStaff(s); setShifts(sh); });
  };
  useEffect(() => { load(); }, [weekStart]); // eslint-disable-line

  const newShift = (userId, day) => {
    const start = new Date(day); start.setUTCHours(9, 0, 0, 0);
    const end = new Date(day); end.setUTCHours(17, 0, 0, 0);
    setEditing({ user_id: userId, start: start.toISOString().slice(0, 16), end: end.toISOString().slice(0, 16), notes: "", station: "", published: false });
  };

  const save = async () => {
    if (!editing.user_id) { toast.error("Pick an employee"); return; }
    try {
      const payload = { ...editing, start: new Date(editing.start).toISOString(), end: new Date(editing.end).toISOString() };
      if (editing.id) await shiftsApi.update(editing.id, payload);
      else await shiftsApi.create(payload);
      toast.success("Shift saved");
      setEditing(null); load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    }
  };

  const del = async () => {
    if (!editing?.id) return;
    setConfirmState({
      message: "Delete this shift?",
      onConfirm: async () => {
        await shiftsApi.remove(editing.id);
        setEditing(null); load();
        toast.success("Shift deleted");
      },
    });
  };

  const publishWeek = () => {
    setConfirmState({
      message: "Publish all shifts this week to employees?",
      onConfirm: async () => {
        const r = await shiftsApi.publish(weekStart.toISOString(), weekEnd.toISOString());
        toast.success(`Published ${r.published} shifts`);
        load();
      },
    });
  };

  const copyLastWeek = () => {
    setConfirmState({
      message: "Copy last week's rota into this week as drafts? You can edit before publishing.",
      onConfirm: async () => {
        const sourceStart = new Date(weekStart);
        sourceStart.setUTCDate(sourceStart.getUTCDate() - 7);
        try {
          const r = await shiftsApi.copyWeek(sourceStart.toISOString(), weekStart.toISOString());
          if (r.copied === 0) toast.info(r.skipped ? "Those shifts already exist this week" : "No shifts to copy from last week");
          else toast.success(`Copied ${r.copied} shift${r.copied === 1 ? "" : "s"} as drafts${r.skipped ? ` (${r.skipped} already existed)` : ""}`);
          load();
        } catch (e) {
          toast.error(e?.response?.data?.detail || "Copy failed");
        }
      },
    });
  };

  const downloadPdf = async () => {
    const token = authToken();
    if (!token) { toast.error("Sign in again to download"); return; }
    try {
      const url = `${apiBase}/shifts.pdf?start=${encodeURIComponent(weekStart.toISOString())}&end=${encodeURIComponent(weekEnd.toISOString())}`;
      const r = await fetch(url, { headers: authHeaders(token) });
      if (!r.ok) {
        const detail = await r.text().catch(() => "");
        toast.error(`Could not generate PDF (${r.status})${detail ? ` — ${detail.slice(0, 80)}` : ""}`);
        return;
      }
      const blob = await r.blob();
      // Firefox requires the anchor to be in the DOM before .click() will fire
      // the download; Chromium tolerates either but the safer pattern is the
      // append/click/remove sequence with a delayed revokeObjectURL so the
      // browser has finished reading the blob URL before we release it.
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `rota-${weekStart.toISOString().slice(0, 10)}.pdf`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
      toast.success("Rota PDF downloaded");
    } catch (e) {
      toast.error(e?.message || "Download failed");
    }
  };

  return (
    <div>
      <div className="flex justify-end gap-2 mb-3">
        <button data-testid="rota-copy-week-btn" onClick={copyLastWeek} className="pos-btn h-9 px-4 rounded-md text-xs font-bold flex items-center gap-2"
          style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
          <CopyPlus className="w-4 h-4" /> Copy last week
        </button>
        <button data-testid="rota-pdf-btn" onClick={downloadPdf} className="pos-btn h-9 px-4 rounded-md text-xs font-bold flex items-center gap-2"
          style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
          <FileText className="w-4 h-4" /> Download PDF
        </button>
        <button data-testid="rota-publish-btn" onClick={publishWeek} className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white flex items-center gap-2"
          style={{ background: "var(--pos-accent)" }}>
          <CheckCircle2 className="w-4 h-4" /> Publish week
        </button>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-xs">
          <thead style={{ color: "var(--pos-muted)" }}>
            <tr style={{ borderBottom: "1px solid var(--pos-border)" }}>
              <th className="text-left py-2 px-2 uppercase text-[10px] tracking-wider sticky left-0" style={{ background: "var(--pos-bg)" }}>Employee</th>
              {days.map((d, i) => <th key={i} className="text-left py-2 px-2 uppercase text-[10px] tracking-wider">{fmtDay(d)}</th>)}
            </tr>
          </thead>
          <tbody style={{ color: "var(--pos-text)" }}>
            {staff.map((s) => (
              <tr key={s.id} data-testid={`rota-row-${s.id}`} style={{ borderTop: "1px solid var(--pos-border)" }}>
                <td className="py-2 px-2 sticky left-0 font-medium" style={{ background: "var(--pos-bg)" }}>
                  {s.name}
                  <div className="text-[10px]" style={{ color: "var(--pos-muted)" }}>{s.role}</div>
                </td>
                {days.map((d, i) => {
                  const dayStart = isoDate(d);
                  const ofDay = shifts.filter((sh) => sh.user_id === s.id && sh.start.slice(0, 10) === dayStart);
                  return (
                    <td key={i} className="py-2 px-2 align-top" style={{ minWidth: 120 }}>
                      {ofDay.map((sh) => (
                        <button key={sh.id} data-testid={`rota-shift-${sh.id}`} onClick={() => setEditing({ ...sh, start: sh.start.slice(0, 16), end: sh.end.slice(0, 16) })}
                          className="pos-btn block w-full text-left rounded-md px-2 py-1 mb-1"
                          style={{ background: sh.published ? "#0e2515" : "#1c2438", border: "1px solid var(--pos-border)", color: "#fff" }}>
                          <div className="font-bold">{fmtTime(sh.start)}–{fmtTime(sh.end)}</div>
                          {sh.station && <div className="text-[10px]" style={{ color: "var(--pos-muted)" }}>{sh.station}</div>}
                        </button>
                      ))}
                      <button data-testid={`rota-add-${s.id}-${i}`} onClick={() => newShift(s.id, d)}
                        className="pos-btn w-full text-left rounded-md px-2 py-1 text-[10px]"
                        style={{ color: "var(--pos-muted)", border: "1px dashed var(--pos-border)" }}>+ shift</button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
          <DialogHeader><DialogTitle style={{ color: "var(--pos-text)" }}>{editing?.id ? "Edit shift" : "New shift"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <Select value={editing.user_id} onValueChange={(v) => setEditing({ ...editing, user_id: v })}>
                <SelectTrigger style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }}>
                  <SelectValue placeholder="Employee" />
                </SelectTrigger>
                <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} · {s.role}</SelectItem>)}</SelectContent>
              </Select>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Start</label>
                  <Input type="datetime-local" value={editing.start.slice(0, 16)} onChange={(e) => setEditing({ ...editing, start: e.target.value })}
                    style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>End</label>
                  <Input type="datetime-local" value={editing.end.slice(0, 16)} onChange={(e) => setEditing({ ...editing, end: e.target.value })}
                    style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
                </div>
              </div>
              <Input placeholder="Station (optional)" value={editing.station || ""} onChange={(e) => setEditing({ ...editing, station: e.target.value })}
                style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
              <Input placeholder="Notes" value={editing.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
              <div className="flex justify-between pt-2">
                {editing.id ? (
                  <button onClick={del} className="pos-btn h-9 px-4 rounded-md text-xs flex items-center gap-1" style={{ background: "#2b1212", color: "#fca5a5" }}>
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                ) : <span />}
                <div className="flex gap-2">
                  <button onClick={() => setEditing(null)} className="pos-btn h-9 px-4 rounded-md text-xs" style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)" }}>Cancel</button>
                  <button onClick={save} className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white" style={{ background: "var(--pos-accent)" }}>Save</button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmState} onOpenChange={(o) => !o && setConfirmState(null)}>
        <DialogContent className="max-w-sm border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
          <DialogHeader><DialogTitle style={{ color: "var(--pos-text)" }}>Are you sure?</DialogTitle></DialogHeader>
          {confirmState && (
            <div className="space-y-4">
              <p className="text-sm" style={{ color: "var(--pos-muted)" }}>{confirmState.message}</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setConfirmState(null)} className="pos-btn h-9 px-4 rounded-md text-xs" style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)" }}>Cancel</button>
                <button
                  onClick={async () => { const fn = confirmState.onConfirm; setConfirmState(null); await fn(); }}
                  className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white" style={{ background: "var(--pos-accent)" }}>Confirm</button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LiveTab() {
  const [list, setList] = useState([]);
  useEffect(() => {
    let dead = false;
    const tick = () => timeclockApi.current().then((d) => { if (!dead) setList(d); }).catch(() => {});
    tick();
    const t = setInterval(tick, 10000);
    return () => { dead = true; clearInterval(t); };
  }, []);
  return (
    <div className="space-y-3 max-w-2xl">
      {list.length === 0 && <p className="text-sm text-center py-12" style={{ color: "var(--pos-muted)" }}>No-one is clocked in right now.</p>}
      {list.map((p) => (
        <div key={p.punch_id} data-testid={`live-row-${p.user_id}`} className="flex items-center gap-4 rounded-lg p-3"
          style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          {p.selfie_b64 ? (
            <img src={p.selfie_b64} alt={p.user_name} className="w-12 h-12 rounded-full object-cover" />
          ) : (
            <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "var(--pos-blue)" }}>
              <Clock className="w-5 h-5 text-white" />
            </div>
          )}
          <div className="flex-1">
            <div className="font-bold" style={{ color: "var(--pos-text)" }}>{p.user_name}</div>
            <div className="text-xs" style={{ color: "var(--pos-muted)" }}>{p.role} · since {fmtTime(p.since)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function MyRotaTab({ weekStart, weekEnd }) {
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    shiftsApi.list({ start: weekStart.toISOString(), end: weekEnd.toISOString(), mine: true })
      .then((d) => { setShifts(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [weekStart, weekEnd]);

  // Group by day-of-week
  const byDay = useMemo(() => {
    const map = {};
    for (const sh of shifts) {
      const key = sh.start.slice(0, 10);
      (map[key] = map[key] || []).push(sh);
    }
    return map;
  }, [shifts]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setUTCDate(d.getUTCDate() + i); return d;
  }), [weekStart]);

  const totalHours = shifts.reduce((s, sh) => {
    try {
      const a = new Date(sh.start); const b = new Date(sh.end);
      return s + (b - a) / 3600000;
    } catch { return s; }
  }, 0);

  return (
    <div className="max-w-3xl mx-auto" data-testid="myrota-tab">
      <div className="rounded-xl p-4 mb-4 flex items-center justify-between"
        style={{ background: "linear-gradient(135deg, #262626 0%, #0a0a0a 100%)", border: "1px solid #333333" }}>
        <div>
          <div className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>This week</div>
          <div className="text-2xl font-bold text-white tabular-nums" data-testid="myrota-total-hours">{totalHours.toFixed(2)}h scheduled</div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Shifts</div>
          <div className="text-2xl font-bold text-white tabular-nums">{shifts.length}</div>
        </div>
      </div>

      {loading && <p className="text-sm text-center py-8" style={{ color: "var(--pos-muted)" }}>Loading…</p>}
      {!loading && shifts.length === 0 && (
        <p className="text-sm text-center py-12" style={{ color: "var(--pos-muted)" }} data-testid="myrota-empty">
          No published shifts for you this week.<br />Your manager will publish the rota when it's ready.
        </p>
      )}

      <div className="space-y-2">
        {days.map((d, i) => {
          const key = isoDate(d);
          const todays = byDay[key] || [];
          if (todays.length === 0) return null;
          return (
            <div key={i} className="rounded-lg p-3" data-testid={`myrota-day-${key}`}
              style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
              <div className="text-xs uppercase tracking-wider mb-2" style={{ color: "var(--pos-muted)" }}>{fmtDay(d)}</div>
              {todays.map((sh) => (
                <div key={sh.id} className="flex items-center justify-between rounded-md px-3 py-2 mb-1"
                  style={{ background: "var(--pos-panel-2)" }}>
                  <div className="font-bold tabular-nums" style={{ color: "var(--pos-text)" }}>{fmtTime(sh.start)} – {fmtTime(sh.end)}</div>
                  <div className="text-xs text-right" style={{ color: "var(--pos-muted)" }}>
                    {sh.station ? <span>{sh.station} · </span> : null}
                    {sh.role}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
