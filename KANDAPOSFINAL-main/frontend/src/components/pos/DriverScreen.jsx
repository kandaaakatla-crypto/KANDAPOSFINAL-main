import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { usePos } from "../../store/PosContext";
import { ordersApi } from "../../api/client";
import { toast } from "sonner";
import { Bike, Phone, MapPin, CheckCircle2, IndianRupee, Loader2, LogOut, Plus, RefreshCw, CalendarDays } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { MyRotaTab, startOfWeek } from "./WorkforceScreen";

const Card = ({ order, mine, busy, onClaim, onOnTheWay, onCash, onDelivered }) => {
  const c = order.customer || {};
  const mapsHref = c.address ? `https://www.google.com/maps?q=${encodeURIComponent((c.address || "") + " " + (c.postcode || ""))}` : null;
  const telHref = c.phone ? `tel:${c.phone}` : null;
  const isPaid = order.payment === "cash" || order.payment === "card";
  return (
    <div data-testid={`driver-order-${order.id}`} className="rounded-xl p-4 mb-3"
      style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-lg font-extrabold tabular-nums" style={{ color: "var(--pos-text)" }}>#{order.number}</div>
          <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>
            ₹{order.total} · {order.payment} · {order.source || "in-store"}
          </div>
        </div>
        <span className="text-[10px] uppercase font-bold px-2 py-1 rounded-full" style={{
          background: order.status === "ready" ? "#1c2a3a" : "#1c2a1c",
          color: order.status === "ready" ? "#7dd3fc" : "#7cc97c",
        }}>{order.status}</span>
      </div>

      <div className="text-base font-bold" style={{ color: "var(--pos-text)" }}>{c.name}</div>
      {telHref && (
        <a data-testid={`driver-tel-${order.id}`} href={telHref}
          className="mt-1 inline-flex items-center gap-1.5 text-sm" style={{ color: "var(--pos-accent)" }}>
          <Phone className="w-3.5 h-3.5" /> {c.phone}
        </a>
      )}
      {c.address && (
        <div className="text-sm mt-1 flex items-start gap-1.5" style={{ color: "var(--pos-muted)" }}>
          <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{c.address}{c.postcode ? `, ${c.postcode}` : ""}</span>
        </div>
      )}
      {mapsHref && (
        <a data-testid={`driver-maps-${order.id}`} href={mapsHref} target="_blank" rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-md"
          style={{ background: "var(--pos-panel-2)", color: "#7dd3fc", border: "1px solid var(--pos-border)" }}>
          <MapPin className="w-3 h-3" /> Open in Maps
        </a>
      )}

      <ul className="mt-3 space-y-0.5 text-xs" style={{ color: "var(--pos-muted)" }}>
        {(order.items || []).slice(0, 4).map((it, i) => (
          <li key={i}>×{it.qty} {it.name}</li>
        ))}
        {(order.items || []).length > 4 && <li>+ {order.items.length - 4} more</li>}
      </ul>

      <div className="flex flex-wrap gap-2 mt-4">
        {!mine && (
          <button data-testid={`driver-claim-${order.id}`} disabled={busy} onClick={() => onClaim(order)}
            className="pos-btn flex-1 h-10 rounded-md text-xs font-bold flex items-center justify-center gap-1.5 text-white"
            style={{ background: "var(--pos-accent)" }}>
            <Plus className="w-3.5 h-3.5" /> Claim delivery
          </button>
        )}
        {mine && order.status === "ready" && (
          <button data-testid={`driver-onway-${order.id}`} disabled={busy} onClick={() => onOnTheWay(order)}
            className="pos-btn flex-1 h-10 rounded-md text-xs font-bold flex items-center justify-center gap-1.5 text-white"
            style={{ background: "#3b82f6" }}>
            <Bike className="w-3.5 h-3.5" /> On the way
          </button>
        )}
        {mine && order.status === "out-for-delivery" && !isPaid && (
          <button data-testid={`driver-cash-${order.id}`} disabled={busy} onClick={() => onCash(order)}
            className="pos-btn h-10 px-3 rounded-md text-xs font-bold flex items-center justify-center gap-1.5"
            style={{ background: "var(--pos-panel-2)", color: "#22c55e", border: "1px solid #166534" }}>
            <IndianRupee className="w-3.5 h-3.5" /> Collected cash
          </button>
        )}
        {mine && order.status === "out-for-delivery" && (
          <button data-testid={`driver-delivered-${order.id}`} disabled={busy} onClick={() => onDelivered(order)}
            className="pos-btn flex-1 h-10 rounded-md text-xs font-bold flex items-center justify-center gap-1.5 text-white"
            style={{ background: "#22c55e" }}>
            <CheckCircle2 className="w-3.5 h-3.5" /> Mark delivered
          </button>
        )}
      </div>
    </div>
  );
};

/** Driver-only stripped POS view. Shows assigned + unassigned delivery orders.
 *  No menu / no tables / no settings — just what a driver needs to do their job. */
export default function DriverScreen() {
  const { staffUser, logout } = usePos();
  const navigate = useNavigate();
  const { slug } = useParams();
  const [orders, setOrders] = useState([]);
  const [busy, setBusy] = useState(true);
  const [rotaOpen, setRotaOpen] = useState(false);
  const weekStart = useMemo(() => startOfWeek(new Date()), []);
  const weekEnd = useMemo(() => { const d = new Date(weekStart); d.setUTCDate(d.getUTCDate() + 7); return d; }, [weekStart]);

  // If a non-Driver lands here, send them home.
  useEffect(() => {
    if (staffUser && staffUser.role !== "Driver") navigate(`/${slug}/pos`, { replace: true });
  }, [staffUser, navigate, slug]);

  const load = useCallback(async () => {
    setBusy(true);
    try { setOrders(await ordersApi.list()); }
    catch { /* ignore */ }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); const id = setInterval(load, 8000); return () => clearInterval(id); }, [load]);

  const deliveries = orders.filter((o) => o.type === "delivery" && o.status !== "completed");
  const driverName = staffUser?.name;
  const mine = deliveries.filter((o) => o.driver === driverName);
  const open = deliveries.filter((o) => !o.driver && o.status === "ready");

  const claim = async (o) => {
    try { await ordersApi.claim(o.id); toast.success(`Claimed #${o.number}`); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Could not claim"); }
  };
  const onway = async (o) => {
    try { await ordersApi.setStatus(o.id, "out-for-delivery"); toast.success("On the way"); load(); }
    catch (e) { toast.error("Could not update"); }
  };
  const cash = async (o) => {
    try { await ordersApi.setPayment(o.id, "cash"); toast.success("Marked as cash paid"); load(); }
    catch (e) { toast.error("Could not update payment"); }
  };
  const delivered = async (o) => {
    try { await ordersApi.setStatus(o.id, "completed"); toast.success(`Delivered #${o.number}`); load(); }
    catch (e) { toast.error("Could not update"); }
  };

  if (!staffUser) return null;

  return (
    <div data-testid="driver-screen" className="min-h-screen flex flex-col" style={{ background: "var(--pos-bg)" }}>
      <header className="px-4 py-3 flex items-center justify-between sticky top-0 z-10"
        style={{ background: "var(--pos-panel)", borderBottom: "1px solid var(--pos-border)" }}>
        <div className="flex items-center gap-2">
          <Bike className="w-5 h-5" style={{ color: "var(--pos-accent)" }} />
          <div>
            <div className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>{driverName}</div>
            <div className="text-[10px]" style={{ color: "var(--pos-muted)" }}>Driver · {mine.length} active</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button data-testid="driver-rota-btn" onClick={() => setRotaOpen(true)}
            className="pos-btn h-9 px-3 rounded-md text-xs font-bold flex items-center gap-1.5"
            style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
            <CalendarDays className="w-3.5 h-3.5" /> My Rota
          </button>
          <button data-testid="driver-refresh" onClick={load} className="pos-btn h-9 w-9 rounded-md flex items-center justify-center"
            style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
            <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
          </button>
          <button data-testid="driver-logout" onClick={() => { logout(); window.location.assign(`/pos/${slug}/login`); }}
            className="pos-btn h-9 px-3 rounded-md text-xs font-bold flex items-center gap-1.5"
            style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 p-3 max-w-md mx-auto w-full">
        <h2 className="text-[11px] uppercase tracking-wider font-bold mb-2 mt-2" style={{ color: "var(--pos-muted)" }}>
          My deliveries · {mine.length}
        </h2>
        {mine.length === 0 ? (
          <div className="text-sm py-6 text-center rounded-xl" style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
            No active deliveries yet — claim one below.
          </div>
        ) : mine.map((o) => (
          <Card key={o.id} order={o} mine busy={busy} onClaim={claim} onOnTheWay={onway} onCash={cash} onDelivered={delivered} />
        ))}

        <h2 className="text-[11px] uppercase tracking-wider font-bold mb-2 mt-4" style={{ color: "var(--pos-muted)" }}>
          Available · {open.length}
        </h2>
        {open.length === 0 ? (
          <div className="text-sm py-6 text-center rounded-xl" style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
            Nothing waiting right now.
          </div>
        ) : open.map((o) => (
          <Card key={o.id} order={o} mine={false} busy={busy} onClaim={claim} />
        ))}
      </main>

      {busy && !orders.length && (
        <div className="fixed inset-0 flex items-center justify-center" style={{ color: "var(--pos-text)" }}>
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}

      <Dialog open={rotaOpen} onOpenChange={setRotaOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
          <DialogHeader><DialogTitle style={{ color: "var(--pos-text)" }}>My Rota</DialogTitle></DialogHeader>
          <MyRotaTab weekStart={weekStart} weekEnd={weekEnd} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
