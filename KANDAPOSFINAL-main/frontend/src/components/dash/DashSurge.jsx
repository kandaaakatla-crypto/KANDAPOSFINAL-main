import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { surgeRulesApi } from "../../api/client";
import { AGGREGATORS, activeSurge, isSurgeRuleActive } from "../../utils/surge";
import { TrendingUp, Plus, Trash2, Loader2, Pencil } from "lucide-react";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "../ui/alert-dialog";

const DAY_LABELS = [
  { n: 1, l: "Mon" }, { n: 2, l: "Tue" }, { n: 3, l: "Wed" }, { n: 4, l: "Thu" },
  { n: 5, l: "Fri" }, { n: 6, l: "Sat" }, { n: 7, l: "Sun" },
];

const EMPTY = { name: "", channels: [], pct: "", days: [], allDay: true, start_time: "19:00", end_time: "23:00", active: true };

const inputStyle = { background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" };

/**
 * Restaurant Dashboard → Surge Pricing. Markups for aggregator orders, set
 * per aggregator (e.g. Swiggy +10% always) or combined across several (e.g.
 * Swiggy + Zomato +5% Fri–Sun dinner). Every active rule matching an order's
 * source stacks; the POS applies the total when the cashier picks that source.
 */
export default function DashSurge() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    surgeRulesApi.list()
      .then(setRules)
      .catch(() => toast.error("Could not load surge rules"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const now = new Date();
  const liveNow = AGGREGATORS.map((a) => ({ ...a, ...activeSurge(rules, a.id, now) }));

  const startNew = () => { setEditingId(null); setForm(EMPTY); };
  const startEdit = (r) => {
    setEditingId(r.id);
    setForm({
      name: r.name, channels: r.channels || [], pct: r.pct, days: r.days || [],
      allDay: !r.start_time, start_time: r.start_time || "19:00", end_time: r.end_time || "23:00", active: r.active,
    });
  };

  const toggleDay = (day) => setForm((f) => ({ ...f, days: f.days.includes(day) ? f.days.filter((d) => d !== day) : [...f.days, day].sort((a, b) => a - b) }));
  const toggleChannel = (id) => setForm((f) => ({ ...f, channels: f.channels.includes(id) ? f.channels.filter((c) => c !== id) : [...f.channels, id] }));
  const allChannels = form.channels.length === AGGREGATORS.length;

  const save = async () => {
    const pct = parseFloat(form.pct);
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    if (!form.channels.length) { toast.error("Pick at least one aggregator"); return; }
    if (!(pct > 0 && pct <= 100)) { toast.error("Markup must be between 0 and 100%"); return; }
    if (!form.allDay && form.start_time === form.end_time) { toast.error("Start and end time can't be the same"); return; }
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), channels: form.channels, pct, days: form.days, active: form.active };
      if (editingId) {
        await surgeRulesApi.update(editingId, form.allDay ? { ...payload, all_day: true } : { ...payload, start_time: form.start_time, end_time: form.end_time });
        toast.success("Surge rule updated");
      } else {
        await surgeRulesApi.create(form.allDay ? payload : { ...payload, start_time: form.start_time, end_time: form.end_time });
        toast.success("Surge rule created");
      }
      startNew();
      load();
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Could not save surge rule");
    } finally { setSaving(false); }
  };

  const remove = async (r) => {
    try {
      await surgeRulesApi.remove(r.id);
      toast.success("Surge rule deleted");
      if (editingId === r.id) startNew();
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not delete surge rule");
    }
  };

  const daysLabel = (days) => (days && days.length ? days.map((d) => DAY_LABELS.find((x) => x.n === d)?.l).join(", ") : "Every day");
  const channelsLabel = (ch) => (ch.length === AGGREGATORS.length ? "All aggregators" : ch.map((c) => AGGREGATORS.find((a) => a.id === c)?.label || c).join(" + "));

  return (
    <div className="p-6 space-y-6" data-testid="dash-surge">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: "var(--pos-text)" }}>
          <TrendingUp className="w-6 h-6" style={{ color: "#f59e0b" }} />
          Surge Pricing
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>
          Mark up prices on aggregator orders, for one aggregator (e.g. Swiggy +10%, always) or several combined (e.g. Swiggy + Zomato +5%, Fri–Sun 7–11pm).
          Rules that overlap add up. The POS applies them when the cashier picks Swiggy, Zomato or Other as the order source; prices round to the whole rupee and GST is charged on the marked-up price.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="surge-live">
        {liveNow.map((a) => (
          <div key={a.id} className="rounded-xl px-4 py-3" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
            <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: a.color || "var(--pos-muted)" }}>{a.label} right now</div>
            <div className="text-2xl font-bold mt-1 tabular-nums" style={{ color: "var(--pos-text)" }}>{a.pct > 0 ? `+${a.pct}%` : "No surge"}</div>
            <div className="text-[11px] mt-0.5 truncate" style={{ color: "var(--pos-muted)" }}>{a.rules.map((r) => r.name).join(" + ") || "Menu price"}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-xl overflow-hidden" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--pos-border)" }}>
            <div className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>All surge rules</div>
          </div>
          <div className="p-5">
            {loading && <div className="text-sm" style={{ color: "var(--pos-muted)" }}>Loading…</div>}
            {!loading && rules.length === 0 && (
              <div className="text-sm text-center py-8" style={{ color: "var(--pos-muted)" }}>No surge rules yet. Create one on the right.</div>
            )}
            <div className="space-y-1.5">
              {rules.map((r) => (
                <div key={r.id} data-testid={`surge-row-${r.id}`} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 flex-wrap"
                  style={{ background: editingId === r.id ? "var(--pos-bg)" : "var(--pos-panel-2)", border: editingId === r.id ? "1px solid var(--pos-accent)" : "1px solid transparent" }}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold" style={{ color: "var(--pos-text)" }}>{r.name}</span>
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: "#2a1e0a", color: "#fcd34d" }}>+{r.pct}%</span>
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: "var(--pos-panel)", color: "var(--pos-muted)" }}>
                        {r.start_time ? `${r.start_time}–${r.end_time}` : "All day"}
                      </span>
                      {isSurgeRuleActive(r, now) && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: "#0f2a1a", color: "#4ade80" }}>Live</span>}
                      {!r.active && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: "#3a1515", color: "#f87171" }}>Off</span>}
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: "var(--pos-muted)" }}>
                      {channelsLabel(r.channels || [])} · {daysLabel(r.days)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button data-testid={`surge-edit-${r.id}`} onClick={() => startEdit(r)}
                      className="pos-btn h-7 w-7 rounded-md flex items-center justify-center" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
                      <Pencil className="w-3.5 h-3.5" style={{ color: "var(--pos-muted)" }} />
                    </button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button data-testid={`surge-delete-${r.id}`}
                          className="pos-btn w-7 h-7 rounded-md flex items-center justify-center" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete surge rule?</AlertDialogTitle>
                          <AlertDialogDescription>Delete "{r.name}"? Orders already placed keep their prices.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction data-testid={`surge-delete-confirm-${r.id}`} onClick={() => remove(r)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl overflow-hidden h-fit" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--pos-border)" }}>
            <div className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>{editingId ? "Edit surge rule" : "New surge rule"}</div>
            {editingId && <button onClick={startNew} className="text-[11px]" style={{ color: "var(--pos-accent)" }}>+ New instead</button>}
          </div>
          <div className="p-5 space-y-3">
            <Field label="Name">
              <input data-testid="surge-form-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Weekend dinner peak" maxLength={60} className="w-full rounded px-2 py-1.5 text-sm outline-none" style={inputStyle} />
            </Field>

            <Field label="Aggregators">
              <div className="grid grid-cols-2 gap-1.5">
                {AGGREGATORS.map((a) => (
                  <button key={a.id} type="button" data-testid={`surge-form-channel-${a.id}`} onClick={() => toggleChannel(a.id)}
                    className="pos-btn h-8 rounded text-[11px] font-bold"
                    style={{ background: form.channels.includes(a.id) ? (a.color || "var(--pos-accent)") : "var(--pos-panel-2)", color: form.channels.includes(a.id) ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                    {a.label}
                  </button>
                ))}
                <button type="button" data-testid="surge-form-channel-all"
                  onClick={() => setForm((f) => ({ ...f, channels: allChannels ? [] : AGGREGATORS.map((a) => a.id) }))}
                  className="pos-btn h-8 rounded text-[11px] font-bold"
                  style={{ background: allChannels ? "var(--pos-accent)" : "var(--pos-panel-2)", color: allChannels ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                  All (combined)
                </button>
              </div>
            </Field>

            <Field label="Markup %">
              <input data-testid="surge-form-pct" type="number" min={0} max={100} step="0.5" value={form.pct} onChange={(e) => setForm({ ...form, pct: e.target.value })}
                placeholder="e.g. 10" className="w-full rounded px-2 py-1.5 text-sm outline-none" style={inputStyle} />
            </Field>

            <Field label="Days">
              <div className="flex items-center gap-1">
                {DAY_LABELS.map((d) => (
                  <button key={d.n} type="button" data-testid={`surge-form-day-${d.n}`} onClick={() => toggleDay(d.n)}
                    className="pos-btn flex-1 h-8 rounded text-[10px] font-bold"
                    style={{ background: form.days.includes(d.n) ? "var(--pos-accent)" : "var(--pos-panel-2)", color: form.days.includes(d.n) ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                    {d.l}
                  </button>
                ))}
              </div>
              <div className="text-[10px] mt-1" style={{ color: "var(--pos-muted)" }}>None selected = every day</div>
            </Field>

            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--pos-text)" }}>
              <input type="checkbox" data-testid="surge-form-allday" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} />
              All day
            </label>
            {!form.allDay && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start"><input data-testid="surge-form-start" type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                  className="w-full rounded px-2 py-1.5 text-sm outline-none" style={inputStyle} /></Field>
                <Field label="End"><input data-testid="surge-form-end" type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                  className="w-full rounded px-2 py-1.5 text-sm outline-none" style={inputStyle} /></Field>
              </div>
            )}

            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--pos-text)" }}>
              <input type="checkbox" data-testid="surge-form-active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Active
            </label>

            <button data-testid="surge-save-btn" onClick={save} disabled={saving}
              className="pos-btn w-full mt-1 px-3 py-2 rounded-lg text-xs text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
              style={{ background: "var(--pos-accent)" }}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} {editingId ? "Save changes" : "Create surge rule"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
