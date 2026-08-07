import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { menuSchedulesApi, menuApi } from "../../api/client";
import { Clock, Plus, Trash2, Loader2, Pencil } from "lucide-react";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "../ui/alert-dialog";

const DAY_LABELS = [
  { n: 1, l: "Mon" }, { n: 2, l: "Tue" }, { n: 3, l: "Wed" }, { n: 4, l: "Thu" },
  { n: 5, l: "Fri" }, { n: 6, l: "Sat" }, { n: 7, l: "Sun" },
];

const EMPTY = {
  name: "", days: [], start_time: "09:00", end_time: "17:00", active: true,
  restrict_availability: false, pricing_mode: "none", discount_pct: "", fixed_price: "", category_ids: [], item_ids: [],
};

const PRICING_MODES = [
  { v: "none", l: "No price change" },
  { v: "percent", l: "Percent off" },
  { v: "fixed", l: "Fixed price" },
];

/**
 * Restaurant Dashboard → Schedules. Day-part menus (e.g. "Breakfast" only
 * served 07:00-11:00) and time-based pricing (e.g. "Happy Hour" -20% off
 * drinks 17:00-19:00) — each schedule owns its own category/item membership,
 * assigned right here rather than by editing every menu item.
 */
export default function DashSchedules() {
  const [schedules, setSchedules] = useState([]);
  const [cats, setCats] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([menuSchedulesApi.list(), menuApi.categories(), menuApi.items()])
      .then(([s, c, i]) => { setSchedules(s); setCats(c); setItems(i); })
      .catch(() => toast.error("Could not load schedules"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const startNew = () => { setEditingId(null); setForm(EMPTY); };
  const startEdit = (s) => {
    setEditingId(s.id);
    setForm({
      name: s.name, days: s.days || [], start_time: s.start_time, end_time: s.end_time, active: s.active,
      restrict_availability: !!s.restrict_availability, pricing_mode: s.pricing_mode || "none",
      discount_pct: s.discount_pct ?? "", fixed_price: s.fixed_price ?? "",
      category_ids: s.category_ids || [], item_ids: s.item_ids || [],
    });
  };

  const toggleDay = (day) => setForm((f) => ({ ...f, days: f.days.includes(day) ? f.days.filter((d) => d !== day) : [...f.days, day].sort((a, b) => a - b) }));
  const toggleCategory = (catId) => setForm((f) => ({
    ...f,
    category_ids: f.category_ids.includes(catId) ? f.category_ids.filter((c) => c !== catId) : [...f.category_ids, catId],
    // Dropping individual items that are now covered by the whole category keeps the two lists non-redundant.
    item_ids: f.category_ids.includes(catId) ? f.item_ids : f.item_ids.filter((id) => items.find((it) => it.id === id)?.catId !== catId),
  }));
  const toggleItem = (itemId) => setForm((f) => ({ ...f, item_ids: f.item_ids.includes(itemId) ? f.item_ids.filter((i) => i !== itemId) : [...f.item_ids, itemId] }));

  const save = async () => {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    if (!form.category_ids.length && !form.item_ids.length) { toast.error("Select at least one category or item"); return; }
    if (form.pricing_mode === "percent" && form.discount_pct === "") { toast.error("Enter a discount %"); return; }
    if (form.pricing_mode === "fixed" && form.fixed_price === "") { toast.error("Enter a fixed price"); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(), days: form.days, start_time: form.start_time, end_time: form.end_time, active: form.active,
        restrict_availability: form.restrict_availability,
        pricing_mode: form.pricing_mode,
        discount_pct: form.pricing_mode === "percent" && form.discount_pct !== "" ? parseFloat(form.discount_pct) : null,
        fixed_price: form.pricing_mode === "fixed" && form.fixed_price !== "" ? parseFloat(form.fixed_price) : null,
        category_ids: form.category_ids, item_ids: form.item_ids,
      };
      if (editingId) {
        await menuSchedulesApi.update(editingId, payload);
        toast.success("Schedule updated");
      } else {
        await menuSchedulesApi.create(payload);
        toast.success("Schedule created");
      }
      startNew();
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save schedule");
    } finally { setSaving(false); }
  };

  const remove = async (s) => {
    try {
      await menuSchedulesApi.remove(s.id);
      toast.success("Schedule deleted");
      if (editingId === s.id) startNew();
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not delete schedule");
    }
  };

  const memberSummary = (s) => {
    const catNames = (s.category_ids || []).map((id) => cats.find((c) => c.id === id)?.name).filter(Boolean);
    const n = (s.item_ids || []).length;
    const parts = [];
    if (catNames.length) parts.push(catNames.join(", "));
    if (n) parts.push(`${n} item${n === 1 ? "" : "s"}`);
    return parts.length ? parts.join(" + ") : "No items assigned";
  };

  const daysLabel = (days) => (days && days.length ? days.map((d) => DAY_LABELS.find((x) => x.n === d)?.l).join(", ") : "Every day");

  return (
    <div className="p-6 space-y-6" data-testid="dash-schedules">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Clock className="w-6 h-6" style={{ color: "#7dd3fc" }} />
          Schedules
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>
          Day-part menus (e.g. a Breakfast menu only served 7–11am) and time-based pricing — percent off (e.g. Happy Hour −20% on drinks) or a flat price (e.g. Lunch Special ₹99 pizzas). Assign categories or individual items to a schedule right here.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* List */}
        <div className="lg:col-span-2 rounded-xl overflow-hidden" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--pos-border)" }}>
            <div className="text-sm font-bold text-white">All schedules</div>
          </div>
          <div className="p-5">
            {loading && <div className="text-sm" style={{ color: "var(--pos-muted)" }}>Loading…</div>}
            {!loading && schedules.length === 0 && (
              <div className="text-sm text-center py-8" style={{ color: "var(--pos-muted)" }}>No schedules yet — create one on the right.</div>
            )}
            <div className="space-y-1.5">
              {schedules.map((s) => (
                <div key={s.id} data-testid={`schedule-row-${s.id}`} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 flex-wrap"
                  style={{ background: editingId === s.id ? "var(--pos-bg)" : "var(--pos-panel-2)", border: editingId === s.id ? "1px solid var(--pos-accent)" : "1px solid transparent" }}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-bold">{s.name}</span>
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: "var(--pos-panel)", color: "var(--pos-muted)" }}>
                        {s.start_time}–{s.end_time}
                      </span>
                      {s.restrict_availability && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: "#1e2a4a", color: "#93c5fd" }}>Day-part menu</span>}
                      {s.pricing_mode === "percent" && s.discount_pct ? <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: "#2a1e0a", color: "#fcd34d" }}>−{s.discount_pct}%</span> : null}
                      {s.pricing_mode === "fixed" && s.fixed_price != null ? <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: "#2a1e0a", color: "#fcd34d" }}>₹{s.fixed_price} flat</span> : null}
                      {!s.active && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: "#3a1515", color: "#f87171" }}>Inactive</span>}
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: "var(--pos-muted)" }}>
                      {daysLabel(s.days)} · {memberSummary(s)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button data-testid={`schedule-edit-${s.id}`} onClick={() => startEdit(s)}
                      className="pos-btn h-7 w-7 rounded-md flex items-center justify-center" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
                      <Pencil className="w-3.5 h-3.5" style={{ color: "var(--pos-muted)" }} />
                    </button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button data-testid={`schedule-delete-${s.id}`}
                          className="pos-btn w-7 h-7 rounded-md flex items-center justify-center" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete schedule?</AlertDialogTitle>
                          <AlertDialogDescription>Delete schedule "{s.name}"?</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction data-testid={`schedule-delete-confirm-${s.id}`} onClick={() => remove(s)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Create / edit */}
        <div className="rounded-xl overflow-hidden h-fit" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--pos-border)" }}>
            <div className="text-sm font-bold text-white">{editingId ? "Edit schedule" : "New schedule"}</div>
            {editingId && <button onClick={startNew} className="text-[11px]" style={{ color: "var(--pos-accent)" }}>+ New instead</button>}
          </div>
          <div className="p-5 space-y-3">
            <Field label="Name">
              <input data-testid="schedule-form-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Happy Hour" className="w-full rounded px-2 py-1.5 text-sm text-white outline-none" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} />
            </Field>

            <Field label="Days">
              <div className="flex items-center gap-1">
                {DAY_LABELS.map((d) => (
                  <button key={d.n} type="button" data-testid={`schedule-form-day-${d.n}`} onClick={() => toggleDay(d.n)}
                    className="pos-btn flex-1 h-8 rounded text-[10px] font-bold"
                    style={{ background: form.days.includes(d.n) ? "var(--pos-accent)" : "var(--pos-panel-2)", color: form.days.includes(d.n) ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                    {d.l}
                  </button>
                ))}
              </div>
              <div className="text-[10px] mt-1" style={{ color: "var(--pos-muted)" }}>None selected = every day</div>
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Start"><input data-testid="schedule-form-start" type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                className="w-full rounded px-2 py-1.5 text-sm text-white outline-none" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} /></Field>
              <Field label="End"><input data-testid="schedule-form-end" type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                className="w-full rounded px-2 py-1.5 text-sm text-white outline-none" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} /></Field>
            </div>

            <label className="flex items-center gap-2 text-xs text-white">
              <input type="checkbox" data-testid="schedule-form-active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Active
            </label>

            <label className="flex items-center gap-2 text-xs text-white">
              <input type="checkbox" data-testid="schedule-form-restrict" checked={form.restrict_availability} onChange={(e) => setForm({ ...form, restrict_availability: e.target.checked })} />
              Day-part menu — hide members outside the window
            </label>

            <Field label="Pricing while active">
              <div className="grid grid-cols-3 gap-1.5">
                {PRICING_MODES.map((m) => (
                  <button key={m.v} type="button" data-testid={`schedule-form-mode-${m.v}`} onClick={() => setForm({ ...form, pricing_mode: m.v })}
                    className="pos-btn h-9 rounded text-[11px] font-bold"
                    style={{ background: form.pricing_mode === m.v ? "var(--pos-accent)" : "var(--pos-panel-2)", color: form.pricing_mode === m.v ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                    {m.l}
                  </button>
                ))}
              </div>
              {form.pricing_mode === "percent" && (
                <input data-testid="schedule-form-discount" type="number" min={0} max={100} value={form.discount_pct} onChange={(e) => setForm({ ...form, discount_pct: e.target.value })}
                  placeholder="Discount % — e.g. 20" className="w-full mt-2 rounded px-2 py-1.5 text-sm text-white outline-none" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} />
              )}
              {form.pricing_mode === "fixed" && (
                <input data-testid="schedule-form-fixed-price" type="number" min={0} value={form.fixed_price} onChange={(e) => setForm({ ...form, fixed_price: e.target.value })}
                  placeholder="Flat ₹ price — e.g. 99" className="w-full mt-2 rounded px-2 py-1.5 text-sm text-white outline-none" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} />
              )}
              {form.pricing_mode === "fixed" && (
                <div className="text-[10px] mt-1" style={{ color: "var(--pos-muted)" }}>Applied to every member item (and every pizza size / variant) — replaces the price outright, not a discount off it.</div>
              )}
            </Field>

            <Field label="Categories included">
              <div className="max-h-32 overflow-y-auto pos-scroll space-y-1 rounded p-2" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                {cats.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-xs text-white" data-testid={`schedule-form-cat-${c.id}`}>
                    <input type="checkbox" checked={form.category_ids.includes(c.id)} onChange={() => toggleCategory(c.id)} />
                    {c.name}
                  </label>
                ))}
              </div>
            </Field>

            <Field label="Individual items included">
              <div className="max-h-40 overflow-y-auto pos-scroll space-y-1 rounded p-2" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                {items.filter((it) => !form.category_ids.includes(it.catId)).map((it) => (
                  <label key={it.id} className="flex items-center gap-2 text-xs text-white" data-testid={`schedule-form-item-${it.id}`}>
                    <input type="checkbox" checked={form.item_ids.includes(it.id)} onChange={() => toggleItem(it.id)} />
                    {it.name}
                  </label>
                ))}
                {items.filter((it) => !form.category_ids.includes(it.catId)).length === 0 && (
                  <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>All items already covered by the selected categories.</div>
                )}
              </div>
            </Field>

            <button data-testid="schedule-save-btn" onClick={save} disabled={saving}
              className="pos-btn w-full mt-1 px-3 py-2 rounded-lg text-xs text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
              style={{ background: "var(--pos-accent)" }}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} {editingId ? "Save changes" : "Create schedule"}
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
