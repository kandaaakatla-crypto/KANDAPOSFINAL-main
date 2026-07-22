import React, { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { CalendarClock, Plus, Loader2, Phone, X, Check } from "lucide-react";
import { toast } from "sonner";
import { reservationsApi, tablesApi } from "../../api/client";

const STATUS_COLOR = {
  booked: "#3b82f6", seated: "#22c55e", cancelled: "#6b7280", "no-show": "#ef4444",
};

function fmt(at) {
  try { return new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
  catch { return at; }
}

/** Reservation calendar modal — pick a date, see the day's bookings + create new. */
export default function ReservationModal({ open, onClose }) {
  const [tables, setTables] = useState([]);
  const [list, setList] = useState([]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ table_id: "", customer_name: "", phone: "", party_size: 2, at: "", duration_min: 90, notes: "" });

  useEffect(() => {
    if (!open) return;
    tablesApi.list().then(setTables).catch(() => {});
  }, [open]);

  const load = () => {
    const from_at = `${date}T00:00:00`;
    const to_at = `${date}T23:59:59`;
    setBusy(true);
    reservationsApi.list({ from_at, to_at })
      .then(setList)
      .catch(() => {})
      .finally(() => setBusy(false));
  };
  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open, date]);

  const tableById = useMemo(() => Object.fromEntries(tables.map((t) => [t.id, t])), [tables]);

  const create = async () => {
    if (!form.table_id || !form.customer_name || !form.at) {
      toast.error("Pick a table, name and time");
      return;
    }
    setBusy(true);
    try {
      await reservationsApi.create({
        table_id: form.table_id,
        customer_name: form.customer_name.trim(),
        phone: form.phone.trim() || null,
        party_size: Number(form.party_size) || 2,
        at: new Date(form.at).toISOString(),
        duration_min: Number(form.duration_min) || 90,
        notes: form.notes,
      });
      toast.success("Reservation booked");
      setForm({ ...form, customer_name: "", phone: "", at: "", notes: "" });
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not book");
    } finally { setBusy(false); }
  };

  const setStatus = async (id, status) => {
    try {
      await reservationsApi.update(id, { status });
      toast.success(`Reservation ${status}`);
      load();
    } catch (e) { toast.error("Could not update"); }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this reservation?")) return;
    try { await reservationsApi.remove(id); load(); } catch { toast.error("Could not delete"); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} data-testid="reservation-modal">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2"><CalendarClock className="w-4 h-4" /> Reservations</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input data-testid="reservation-date" type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="h-10 w-44 text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
          <span className="text-xs" style={{ color: "var(--pos-muted)" }}>
            {busy ? "Loading…" : `${list.length} reservation${list.length === 1 ? "" : "s"}`}
          </span>
        </div>

        <div className="space-y-1.5 max-h-[34vh] overflow-y-auto pr-1">
          {list.length === 0 ? (
            <div className="text-center text-xs py-6" style={{ color: "var(--pos-muted)" }}>No reservations on this date.</div>
          ) : list.map((r) => (
            <div key={r.id} data-testid={`reservation-row-${r.id}`} className="flex items-center gap-2 rounded-md p-2"
              style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white truncate">{r.customer_name}</span>
                  <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.05)", color: STATUS_COLOR[r.status] }}>{r.status}</span>
                </div>
                <div className="text-[11px] mt-0.5 flex flex-wrap gap-2" style={{ color: "var(--pos-muted)" }}>
                  <span>T{tableById[r.table_id]?.number || "?"}</span>
                  <span>·</span>
                  <span>{fmt(r.at)} · {r.duration_min}m</span>
                  <span>·</span>
                  <span>{r.party_size} guests</span>
                  {r.phone && <><span>·</span><a href={`tel:${r.phone}`} className="inline-flex items-center gap-1" style={{ color: "var(--pos-accent)" }}><Phone className="w-3 h-3" /> {r.phone}</a></>}
                </div>
              </div>
              {r.status === "booked" && (
                <>
                  <button data-testid={`reservation-seat-${r.id}`} onClick={() => setStatus(r.id, "seated")} className="pos-btn h-8 px-2 rounded text-[10px] font-bold"
                    style={{ background: "rgba(34,197,94,0.15)", color: "#86efac" }}><Check className="w-3 h-3 inline" /> Seat</button>
                  <button data-testid={`reservation-noshow-${r.id}`} onClick={() => setStatus(r.id, "no-show")} className="pos-btn h-8 px-2 rounded text-[10px] font-bold"
                    style={{ background: "rgba(239,68,68,0.15)", color: "#fca5a5" }}><X className="w-3 h-3 inline" /> No-show</button>
                </>
              )}
              <button data-testid={`reservation-delete-${r.id}`} onClick={() => remove(r.id)} className="pos-btn h-8 w-8 rounded flex items-center justify-center"
                style={{ background: "var(--pos-panel)", color: "#fca5a5" }}><X className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>

        <div className="pt-3 grid grid-cols-2 gap-2" style={{ borderTop: "1px solid var(--pos-border)" }}>
          <select data-testid="reservation-table" value={form.table_id} onChange={(e) => setForm({ ...form, table_id: e.target.value })}
            className="h-10 px-3 rounded-md text-sm text-white" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
            <option value="">Table…</option>
            {tables.map((t) => <option key={t.id} value={t.id}>T{t.number} · {t.seats} seats</option>)}
          </select>
          <Input data-testid="reservation-customer" placeholder="Customer name" value={form.customer_name}
            onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
            className="h-10 text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
          <Input data-testid="reservation-phone" placeholder="Phone (optional)" value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="h-10 text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
          <Input data-testid="reservation-party" type="number" placeholder="Party size" value={form.party_size}
            onChange={(e) => setForm({ ...form, party_size: e.target.value })}
            className="h-10 text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
          <Input data-testid="reservation-at" type="datetime-local" value={form.at}
            onChange={(e) => setForm({ ...form, at: e.target.value })}
            className="h-10 text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
          <Input data-testid="reservation-duration" type="number" placeholder="Duration (min)" value={form.duration_min}
            onChange={(e) => setForm({ ...form, duration_min: e.target.value })}
            className="h-10 text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
        </div>
        <button data-testid="reservation-create" onClick={create} disabled={busy}
          className="pos-btn w-full h-10 rounded-md text-xs font-bold text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
          style={{ background: "var(--pos-accent)" }}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Book reservation
        </button>
      </DialogContent>
    </Dialog>
  );
}
