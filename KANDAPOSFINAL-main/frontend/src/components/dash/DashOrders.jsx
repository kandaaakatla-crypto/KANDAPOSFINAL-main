import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, ChevronDown, ChevronUp, Utensils, ShoppingBag, Truck, Store, ClipboardList } from "lucide-react";
import { useDash } from "../../store/DashContext";
import EmptyState from "../ui/empty-state";

// Live orders for the owner's phone — a read-only view of what the store is
// working on right now (Toast Now's "orders" glance). Status changes stay on
// the POS/KDS; this screen is for watching, not driving, the line.

const REFRESH_MS = 30000;

const STATUS = {
  "new": { label: "New", color: "#3b82f6" },
  "in-kitchen": { label: "In kitchen", color: "#f97316" },
  "ready": { label: "Ready", color: "#22c55e" },
  "out-for-delivery": { label: "Out for delivery", color: "#a855f7" },
  "completed": { label: "Completed", color: "#93805f" },
};

const TYPES = [
  { key: "all", label: "All" },
  { key: "dine-in", label: "Dine-in", icon: Utensils },
  { key: "collection", label: "Takeaway", icon: ShoppingBag },
  { key: "delivery", label: "Delivery", icon: Truck },
  { key: "sale", label: "Counter", icon: Store },
];
const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.key, t.label]));

const SOURCE_LABEL = { phone: "Phone", swiggy: "Swiggy", zomato: "Zomato", qr: "QR", website: "Website", other: "Other" };

const inr = (n) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

function isToday(iso, now) {
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

// Minutes since the order was placed; open orders past 20/30 min are flagged
// so a slow ticket stands out without reading every row.
function ageMinutes(iso, now) {
  return Math.max(0, Math.floor((now - new Date(iso)) / 60000));
}
function ageLabel(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
}
function ageColor(min, open) {
  if (!open) return "var(--pos-muted)";
  if (min >= 30) return "#dc2626";
  if (min >= 20) return "#d97706";
  return "var(--pos-muted)";
}

export default function DashOrders() {
  const { api } = useDash();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState("");
  const [view, setView] = useState("open");
  const [type, setType] = useState("all");
  const [expanded, setExpanded] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await api.get("/orders");
      setOrders(r.data || []);
      setError("");
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not load orders");
    } finally {
      setRefreshing(false);
      setNow(new Date());
    }
  }, [api]);

  // Poll while the screen is visible; a backgrounded phone app stops polling
  // and catches up the moment it comes back.
  useEffect(() => {
    load();
    const tick = () => { if (document.visibilityState === "visible") load(); };
    const id = setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [load]);

  const today = useMemo(() => (orders || []).filter((o) => !o.voided && isToday(o.placedAt, now)), [orders, now]);
  const open = useMemo(() => today.filter((o) => o.status !== "completed"), [today]);
  const list = (view === "open" ? open : today).filter((o) => type === "all" || o.type === type);
  const late = open.filter((o) => ageMinutes(o.placedAt, now) >= 20).length;

  return (
    <div className="p-4 space-y-3" data-testid="dash-orders">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--pos-text)" }}>Orders</h1>
          <p className="text-xs" style={{ color: "var(--pos-muted)" }}>
            {open.length} open · {today.length} today{late > 0 && <span style={{ color: "#d97706" }}> · {late} waiting 20+ min</span>}
          </p>
        </div>
        <button type="button" onClick={load} disabled={refreshing} data-testid="orders-refresh" aria-label="Refresh orders"
          className="lg-card lg-press w-10 h-10 rounded-full flex items-center justify-center" style={{ color: "var(--pos-muted)" }}>
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="lg-card rounded-full p-1 grid grid-cols-2 text-sm font-semibold" role="tablist">
        {[["open", `Open (${open.length})`], ["today", `All today (${today.length})`]].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} data-testid={`orders-view-${k}`} onClick={() => setView(k)}
            className="h-9 rounded-full" style={{ background: view === k ? "var(--pos-accent)" : "transparent", color: view === k ? "#fff" : "var(--pos-muted)" }}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {TYPES.map(({ key, label }) => (
          <button key={key} type="button" data-testid={`orders-type-${key}`} onClick={() => setType(key)}
            className="lg-press shrink-0 h-8 px-3 rounded-full text-xs font-semibold"
            style={{ background: type === key ? "rgba(249,115,22,0.14)" : "var(--lg-card)", color: type === key ? "var(--pos-accent)" : "var(--pos-muted)", border: `1px solid ${type === key ? "rgba(249,115,22,0.4)" : "var(--pos-border)"}` }}>
            {label}
          </button>
        ))}
      </div>

      {error && <div className="text-sm rounded-xl p-3" style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626" }}>{error}</div>}

      {orders === null && !error ? (
        <div className="text-sm text-center py-10" style={{ color: "var(--pos-muted)" }}>Loading orders…</div>
      ) : list.length === 0 && !error ? (
        <EmptyState testid="orders-empty" icon={ClipboardList}
          title={view === "open" ? "No open orders" : "No orders yet today"}
          description={view === "open" ? "Everything placed today has been completed." : "Orders show here as soon as they're placed."} />
      ) : (
        <div className="space-y-2">
          {list.map((o) => {
            const st = STATUS[o.status] || STATUS.new;
            const age = ageMinutes(o.placedAt, now);
            const isOpen = o.status !== "completed";
            const itemCount = (o.items || []).reduce((s, i) => s + (i.qty || 0), 0);
            const who = o.type === "dine-in" && o.table != null ? `Table ${o.table}` : (o.customer?.name || TYPE_LABEL[o.type] || "Walk-in");
            const showItems = expanded === o.id;
            return (
              <div key={o.id} className="lg-card rounded-2xl" data-testid={`order-${o.number}`}>
                <button type="button" className="w-full text-left p-3 flex items-center gap-3" aria-expanded={showItems}
                  onClick={() => setExpanded(showItems ? null : o.id)}>
                  <div className="w-1.5 self-stretch rounded-full shrink-0" style={{ background: st.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>#{o.number}</span>
                      <span className="text-sm truncate" style={{ color: "var(--pos-text)" }}>{who}</span>
                    </div>
                    <div className="text-[11px] mt-0.5 flex items-center gap-1.5 flex-wrap" style={{ color: "var(--pos-muted)" }}>
                      <span className="font-semibold" style={{ color: st.color }}>{st.label}</span>
                      <span>· {TYPE_LABEL[o.type] || o.type}</span>
                      {SOURCE_LABEL[o.source] && <span>· {SOURCE_LABEL[o.source]}</span>}
                      <span>· {itemCount} {itemCount === 1 ? "item" : "items"}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold tabular-nums" style={{ color: "var(--pos-text)" }}>{inr(o.total)}</div>
                    <div className="text-[11px] tabular-nums" style={{ color: ageColor(age, isOpen) }}>{ageLabel(age)}</div>
                  </div>
                  {showItems ? <ChevronUp className="w-4 h-4 shrink-0" style={{ color: "var(--pos-muted)" }} /> : <ChevronDown className="w-4 h-4 shrink-0" style={{ color: "var(--pos-muted)" }} />}
                </button>
                {showItems && (
                  <div className="px-4 pb-3 pt-1 space-y-1.5" style={{ borderTop: "1px solid var(--pos-border)" }} data-testid={`order-items-${o.number}`}>
                    {(o.items || []).map((it, idx) => (
                      <div key={idx} className="flex justify-between gap-3 text-sm">
                        <div className="min-w-0" style={{ color: "var(--pos-text)" }}>
                          <span className="tabular-nums" style={{ color: "var(--pos-muted)" }}>{it.qty}×</span> {it.name}{it.size ? ` (${it.size})` : ""}
                          {it.mods?.length > 0 && <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>{it.mods.join(", ")}</div>}
                        </div>
                        <span className="tabular-nums shrink-0" style={{ color: "var(--pos-muted)" }}>{inr(it.qty * it.price)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-xs pt-1" style={{ color: "var(--pos-muted)" }}>
                      <span>{new Date(o.placedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} · {o.payment === "unpaid" ? "Not paid yet" : `Paid by ${o.payment}`}</span>
                      {o.driver && <span>Driver: {o.driver}</span>}
                    </div>
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
