import React, { useEffect, useMemo, useState } from "react";
import { CalendarCheck, Users, Phone } from "lucide-react";
import { toast } from "sonner";
import { useDash } from "../../store/DashContext";
import EmptyState from "../ui/empty-state";

// Today's table bookings for the owner's phone: who is coming, when, how
// many, and a one-tap way to mark a booking seated, a no-show or cancelled
// (same PATCH the POS floor plan uses). Booking new tables stays on the POS.

const STATUS = {
  booked: { label: "Booked", color: "#3b82f6" },
  seated: { label: "Seated", color: "#22c55e" },
  "no-show": { label: "No-show", color: "#d97706" },
  cancelled: { label: "Cancelled", color: "#93805f" },
};

const pad = (n) => String(n).padStart(2, "0");
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export default function DashReservations() {
  const { api } = useDash();
  const [rows, setRows] = useState(null);
  const [tables, setTables] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    // `at` is stored as an ISO string, so the date alone is a safe lower
    // bound for a string range; the exact "today" cut happens on Date below.
    const today = new Date();
    api.get("/reservations", { params: { from_at: localDate(new Date(today.getTime() - 86400000)) } })
      .then((r) => setRows(r.data || []))
      .catch((e) => setError(e?.response?.data?.detail || "Could not load reservations"));
    api.get("/tables").then((r) => setTables(Object.fromEntries((r.data || []).map((t) => [t.id, t.number])))).catch(() => {});
  }, [api]);

  const today = useMemo(() => {
    const key = localDate(new Date());
    return (rows || []).filter((r) => localDate(new Date(r.at)) === key);
  }, [rows]);
  const active = today.filter((r) => r.status === "booked" || r.status === "seated");
  const covers = active.reduce((s, r) => s + (r.party_size || 0), 0);

  const setStatus = async (r, status) => {
    setBusy(r.id);
    try {
      const res = await api.patch(`/reservations/${r.id}`, { status });
      setRows((list) => list.map((x) => (x.id === r.id ? res.data : x)));
      toast.success(`${r.customer_name}: ${STATUS[status].label.toLowerCase()}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update the booking");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-4 space-y-3" data-testid="dash-reservations">
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--pos-text)" }}>Reservations today</h1>
        <p className="text-xs" style={{ color: "var(--pos-muted)" }}>
          {rows ? `${active.length} ${active.length === 1 ? "booking" : "bookings"} · ${covers} guests expected` : "Loading…"}
        </p>
      </div>

      {error && <div className="text-sm rounded-xl p-3" style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626" }}>{error}</div>}

      {rows && today.length === 0 && !error ? (
        <EmptyState testid="reservations-empty" icon={CalendarCheck} title="No bookings today" description="Bookings made on the POS floor plan show here." />
      ) : (
        <div className="space-y-2">
          {today.map((r) => {
            const st = STATUS[r.status] || STATUS.booked;
            const time = new Date(r.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
            const open = r.status === "booked";
            return (
              <div key={r.id} className="lg-card rounded-2xl p-3" data-testid={`reservation-${r.id}`} style={{ opacity: open || r.status === "seated" ? 1 : 0.6 }}>
                <div className="flex items-start gap-3">
                  <div className="text-center shrink-0 w-14">
                    <div className="text-sm font-bold tabular-nums" style={{ color: "var(--pos-text)" }}>{time}</div>
                    {tables[r.table_id] != null && <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>Table {tables[r.table_id]}</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate" style={{ color: "var(--pos-text)" }}>{r.customer_name}</div>
                    <div className="text-[11px] flex items-center gap-2 flex-wrap" style={{ color: "var(--pos-muted)" }}>
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {r.party_size}</span>
                      {r.phone && <a href={`tel:${r.phone}`} className="flex items-center gap-1" style={{ color: "var(--pos-accent)" }}><Phone className="w-3 h-3" /> {r.phone}</a>}
                      <span className="font-semibold" style={{ color: st.color }}>{st.label}</span>
                    </div>
                    {r.notes && <div className="text-xs mt-1" style={{ color: "var(--pos-text)" }}>{r.notes}</div>}
                  </div>
                </div>
                {open && (
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    {[["seated", "Seated"], ["no-show", "No-show"], ["cancelled", "Cancel"]].map(([s, label]) => (
                      <button key={s} type="button" disabled={busy === r.id} onClick={() => setStatus(r, s)} data-testid={`reservation-${r.id}-${s}`}
                        className="lg-press h-9 rounded-full text-xs font-semibold"
                        style={s === "seated" ? { background: "var(--pos-accent)", color: "#fff" } : { background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
