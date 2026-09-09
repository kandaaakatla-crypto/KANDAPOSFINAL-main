import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { kdsApi } from "../../api/kdsClient";
import { PackageCheck, Package, Bike, ShoppingBag, UtensilsCrossed, CheckCircle2, Pizza } from "lucide-react";
import { toast } from "sonner";

const TYPE_ICON = { delivery: Bike, collection: ShoppingBag, "dine-in": UtensilsCrossed };

function OrderCard({ order, onPacked }) {
  const [checked, setChecked] = useState(() => new Set());
  const Icon = TYPE_ICON[order.type] || Package;
  const allChecked = order.items.length > 0 && checked.size >= order.items.length;

  const toggle = (i) => setChecked((prev) => {
    const next = new Set(prev);
    next.has(i) ? next.delete(i) : next.add(i);
    return next;
  });

  return (
    <div data-testid={`pack-card-${order.number}`} className="rounded-xl p-4" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4" style={{ color: "var(--pos-accent)" }} />
          <span className="font-bold" style={{ color: "var(--pos-text)" }}>#{order.number}</span>
          <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>{order.type}</span>
        </div>
        {order.table != null && <span className="text-xs" style={{ color: "var(--pos-muted)" }}>Table {order.table}</span>}
      </div>
      <div className="text-sm mb-2" style={{ color: "var(--pos-text)" }}>{order.customer?.name || "—"}</div>
      <div className="space-y-1.5 mb-3">
        {order.items.map((it, i) => (
          <label key={i} className="flex items-center gap-2 text-xs cursor-pointer select-none" data-testid={`pack-item-${order.number}-${i}`}>
            <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} className="w-3.5 h-3.5 accent-orange-500" />
            <span className={checked.has(i) ? "line-through" : ""} style={{ color: checked.has(i) ? "var(--pos-muted)" : "var(--pos-text)" }}>
              {it.qty}× {it.name}{it.mods?.length ? ` · ${it.mods.join(", ")}` : ""}
            </span>
          </label>
        ))}
      </div>
      <button data-testid={`pack-mark-${order.number}`} onClick={() => onPacked(order)} disabled={!allChecked}
        className="pos-btn w-full h-9 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: "#22c55e" }}>
        <CheckCircle2 className="w-3.5 h-3.5" /> {allChecked ? "Mark Packed" : `Check all ${order.items.length} items`}
      </button>
    </div>
  );
}

/** Public, no-auth packing station screen — put it on a tablet by the pass.
 *  /packing?token=<kds_token>  (same long-lived kiosk token as the KDS tablet
 *  and customer display).
 */
export default function PackingScreen() {
  const [search] = useSearchParams();
  const token = search.get("token") || "";
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!token) { setError("Missing ?token= in the URL"); return; }
    try {
      const d = await kdsApi.packing(token);
      setData(d);
      setError("");
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not load orders");
    }
  }, [token]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const orders = data?.orders || [];
  const toPack = useMemo(() => orders.filter((o) => !o.packed), [orders]);
  const packed = useMemo(() => orders.filter((o) => o.packed), [orders]);

  const handlePacked = async (order) => {
    try {
      await kdsApi.setPacked(token, order.id, true);
      toast.success(`Order #${order.number} packed`);
      refresh();
    } catch {
      toast.error("Could not update — check the connection");
    }
  };
  const undoPacked = async (order) => {
    try { await kdsApi.setPacked(token, order.id, false); refresh(); }
    catch { toast.error("Could not update"); }
  };

  return (
    <div className="min-h-screen p-4" style={{ background: "var(--pos-bg)" }} data-testid="packing-screen">
      <div className="flex items-center justify-between mb-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-accent)" }}>
            <Pizza className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-lg font-bold" style={{ color: "var(--pos-text)" }}>{data?.tenant?.name || "Kanda POS"}</div>
            <div className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Packing station</div>
          </div>
        </div>
        <div className="text-xs px-2 py-1 rounded-full" style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
          {toPack.length} to pack
        </div>
      </div>

      {error && (
        <div className="max-w-md mx-auto text-center text-sm p-4 rounded-xl" style={{ background: "rgba(220,38,38,0.15)", color: "#fca5a5" }}>{error}</div>
      )}

      {!error && (
        <div className="max-w-5xl mx-auto space-y-6">
          <div>
            <div className="text-xs uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--pos-muted)" }}>To pack</div>
            {toPack.length === 0 ? (
              <div className="rounded-xl p-8 text-center text-sm" style={{ background: "var(--pos-panel)", border: "1px dashed var(--pos-border)", color: "var(--pos-muted)" }}>
                Nothing waiting to be packed. Orders show up here once the kitchen marks them ready.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {toPack.map((o) => <OrderCard key={o.id} order={o} onPacked={handlePacked} />)}
              </div>
            )}
          </div>

          {packed.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5" style={{ color: "var(--pos-muted)" }}>
                <PackageCheck className="w-3.5 h-3.5" /> Packed &amp; ready
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {packed.map((o) => (
                  <div key={o.id} data-testid={`packed-card-${o.number}`} className="rounded-xl p-3 flex items-center justify-between" style={{ background: "var(--pos-panel)", border: "1px solid #2e7d4f" }}>
                    <div>
                      <span className="font-bold" style={{ color: "var(--pos-text)" }}>#{o.number}</span>
                      <span className="text-xs ml-2" style={{ color: "var(--pos-muted)" }}>{o.customer?.name}</span>
                    </div>
                    <button data-testid={`pack-undo-${o.number}`} onClick={() => undoPacked(o)} className="text-[11px] font-bold" style={{ color: "var(--pos-muted)" }}>Undo</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
