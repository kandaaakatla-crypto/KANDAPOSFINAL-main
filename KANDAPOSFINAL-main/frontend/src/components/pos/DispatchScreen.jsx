import React, { useEffect, useMemo, useState } from "react";
import { usePos } from "../../store/PosContext";
import { usersApi } from "../../api/client";
import { Bike, Clock, ExternalLink, MapPin, CheckCircle2, User } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { toast } from "sonner";
import { orderNo } from "../../utils/orderNumber";

// Naive ETA: target = placedAt + 30 min (15 prep + 15 ride). Display delta from now.
function etaMinutes(o) {
  const placed = new Date(o.placedAt).getTime();
  const target = placed + 30 * 60 * 1000;
  const diff = Math.round((target - Date.now()) / 60000);
  return diff;
}

function fullAddress(o) {
  const c = o.customer || {};
  return [c.address, c.postcode, "Hyderabad"].filter(Boolean).join(", ");
}

export default function DispatchScreen() {
  const { orders, assignDriver, updateOrderStatus } = usePos();
  const [drivers, setDrivers] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    usersApi.drivers().then(setDrivers).catch(() => {});
  }, []);

  const dispatchList = useMemo(() => (
    orders.filter((o) => o.type === "delivery" && ["ready", "out-for-delivery"].includes(o.status))
  ), [orders]);

  useEffect(() => {
    if (!selected && dispatchList.length) setSelected(dispatchList[0].id);
    if (selected && !dispatchList.find((o) => o.id === selected)) {
      setSelected(dispatchList[0]?.id || null);
    }
  }, [dispatchList, selected]);

  const current = dispatchList.find((o) => o.id === selected);
  const mapsEmbedSrc = current
    ? `https://maps.google.com/maps?q=${encodeURIComponent(fullAddress(current))}&z=14&output=embed`
    : null;
  const mapsOpenUrl = current
    ? `https://maps.google.com/?q=${encodeURIComponent(fullAddress(current))}`
    : null;

  const handleAssign = async (val) => {
    if (!current) return;
    const name = val === "__unassign__" ? null : val;
    await assignDriver(current.id, name);
    toast.success(name ? `Assigned to ${name}` : "Driver unassigned");
  };

  const handleDispatch = async () => {
    if (!current) return;
    if (!current.driver) { toast.error("Assign a driver first"); return; }
    await updateOrderStatus(current.id, "out-for-delivery");
    toast.success(`Order ${orderNo(current)} dispatched`);
  };

  const handleDelivered = async () => {
    if (!current) return;
    await updateOrderStatus(current.id, "completed");
    toast.success(`Order ${orderNo(current)} delivered`);
  };

  return (
    <div className="h-full flex flex-col gap-3 p-4" data-testid="dispatch-screen">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold" style={{ color: "var(--pos-text)" }}>Delivery Dispatch</h2>
        <div className="text-xs px-2 py-1 rounded-full" style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
          {dispatchList.length} active route{dispatchList.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[330px_1fr] gap-3">
        {/* Queue */}
        <div className="rounded-xl overflow-y-auto pos-scroll p-2 space-y-2" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          {dispatchList.length === 0 && (
            <div className="text-sm py-10 text-center" style={{ color: "var(--pos-muted)" }}>No deliveries pending dispatch.</div>
          )}
          {dispatchList.map((o) => {
            const mins = etaMinutes(o);
            const late = mins < 0;
            const active = o.id === selected;
            return (
              <button key={o.id} data-testid={`dispatch-item-${o.number}`} onClick={() => setSelected(o.id)}
                className="pos-btn w-full text-left rounded-lg p-3"
                style={{ background: active ? "var(--pos-panel-2)" : "transparent", border: `1px solid ${active ? "var(--pos-accent)" : "var(--pos-border)"}` }}>
                <div className="flex items-center justify-between">
                  <span className="font-bold" style={{ color: "var(--pos-text)" }}>{orderNo(o)}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide" style={{ background: o.status === "ready" ? "#13271a" : "#14233f", color: o.status === "ready" ? "#22c55e" : "#3b82f6" }}>
                    {o.status === "ready" ? "Ready" : "Out"}
                  </span>
                </div>
                <div className="text-sm mt-1" style={{ color: "var(--pos-text)" }}>{o.customer?.name}</div>
                <div className="text-xs flex items-center gap-1.5 mt-0.5" style={{ color: "var(--pos-muted)" }}>
                  <MapPin className="w-3 h-3" /> {o.customer?.address?.slice(0, 38) || "—"}
                </div>
                <div className="flex items-center justify-between mt-2 text-xs">
                  <span className="flex items-center gap-1" style={{ color: o.driver ? "#7ee2a8" : "var(--pos-muted)" }}>
                    <User className="w-3 h-3" /> {o.driver || "Unassigned"}
                  </span>
                  <span className="flex items-center gap-1 tabular-nums" style={{ color: late ? "#f87171" : "var(--pos-muted)" }}>
                    <Clock className="w-3 h-3" /> {late ? `${-mins}m late` : `${mins}m ETA`}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Detail + Map */}
        <div className="rounded-xl flex flex-col min-h-0" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          {!current ? (
            <div className="flex-1 flex items-center justify-center text-sm" style={{ color: "var(--pos-muted)" }}>Select a delivery from the queue.</div>
          ) : (
            <>
              <div className="p-4 border-b" style={{ borderColor: "var(--pos-border)" }}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2">
                      <Bike className="w-5 h-5" style={{ color: "var(--pos-accent)" }} />
                      <span className="text-lg font-bold" style={{ color: "var(--pos-text)" }}>Order {orderNo(current)}</span>
                      <span className="text-xs uppercase font-bold px-2 py-0.5 rounded-full" style={{ background: current.status === "ready" ? "#13271a" : "#14233f", color: current.status === "ready" ? "#22c55e" : "#3b82f6" }}>
                        {current.status}
                      </span>
                    </div>
                    <div className="text-sm mt-1" style={{ color: "var(--pos-text)" }}>{current.customer?.name} · {current.customer?.phone}</div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--pos-muted)" }}>{fullAddress(current)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold tabular-nums" style={{ color: "var(--pos-text)" }}>₹{current.total.toFixed(2)}</div>
                    <div className="text-[11px] uppercase" style={{ color: current.payment === "unpaid" ? "#f87171" : "#7ee2a8" }}>{current.payment}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
                  <Select value={current.driver || ""} onValueChange={handleAssign}>
                    <SelectTrigger data-testid="driver-select" className="h-10" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }}>
                      <SelectValue placeholder="Assign driver" />
                    </SelectTrigger>
                    <SelectContent>
                      {drivers.map((d) => (<SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>))}
                      <SelectItem value="__unassign__">— Unassign —</SelectItem>
                    </SelectContent>
                  </Select>
                  {current.status === "ready" ? (
                    <button data-testid="dispatch-btn" onClick={handleDispatch}
                      className="pos-btn h-10 rounded-lg text-sm font-bold text-white flex items-center justify-center gap-1.5"
                      style={{ background: "var(--pos-accent)" }}>
                      <Bike className="w-4 h-4" /> Dispatch
                    </button>
                  ) : (
                    <button data-testid="delivered-btn" onClick={handleDelivered}
                      className="pos-btn h-10 rounded-lg text-sm font-bold text-white flex items-center justify-center gap-1.5"
                      style={{ background: "#22c55e" }}>
                      <CheckCircle2 className="w-4 h-4" /> Mark Delivered
                    </button>
                  )}
                  <a data-testid="maps-open" href={mapsOpenUrl} target="_blank" rel="noreferrer"
                    className="pos-btn h-10 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5"
                    style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
                    <ExternalLink className="w-4 h-4" /> Open in Maps
                  </a>
                </div>
              </div>

              {/* Map */}
              <div className="flex-1 min-h-[280px] relative">
                <iframe
                  key={current.id}
                  title="route map"
                  src={mapsEmbedSrc}
                  className="w-full h-full"
                  style={{ border: 0, minHeight: 280 }}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>

              {/* Item summary */}
              <div className="px-4 py-3 border-t text-xs space-y-1 max-h-32 overflow-y-auto pos-scroll" style={{ borderColor: "var(--pos-border)", color: "var(--pos-muted)" }}>
                {current.items.map((it, i) => (
                  <div key={`${current.id}-it-${i}`} className="flex justify-between">
                    <span>{it.qty}× {it.name}{it.mods?.length ? ` · ${it.mods.join(", ")}` : ""}</span>
                    <span className="tabular-nums" style={{ color: "var(--pos-text)" }}>₹{(it.qty * it.price).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
