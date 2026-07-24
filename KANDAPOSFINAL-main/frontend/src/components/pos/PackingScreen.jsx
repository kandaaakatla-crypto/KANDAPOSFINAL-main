import React, { useMemo, useState } from "react";
import { usePos } from "../../store/PosContext";
import { PackageCheck, Package, Bike, ShoppingBag, UtensilsCrossed, CheckCircle2 } from "lucide-react";
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
          <span className="font-bold text-white">#{order.number}</span>
          <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>{order.type}</span>
        </div>
        {order.table != null && <span className="text-xs" style={{ color: "var(--pos-muted)" }}>Table {order.table}</span>}
      </div>
      <div className="text-sm text-white mb-2">{order.customer?.name || "—"}</div>
      <div className="space-y-1.5 mb-3">
        {order.items.map((it, i) => (
          <label key={i} className="flex items-center gap-2 text-xs cursor-pointer select-none" data-testid={`pack-item-${order.number}-${i}`}>
            <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} className="w-3.5 h-3.5 accent-orange-500" />
            <span className={checked.has(i) ? "line-through" : ""} style={{ color: checked.has(i) ? "var(--pos-muted)" : "white" }}>
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

export default function PackingScreen() {
  const { orders, setOrderPacked } = usePos();

  const toPack = useMemo(() => orders.filter((o) => o.status === "ready" && !o.packed), [orders]);
  const packed = useMemo(() => orders.filter((o) => o.status === "ready" && o.packed), [orders]);

  const handlePacked = async (order) => {
    const updated = await setOrderPacked(order.id, true);
    if (updated) toast.success(`Order #${order.number} packed`);
  };
  const undoPacked = async (order) => {
    await setOrderPacked(order.id, false);
  };

  return (
    <div className="h-full overflow-y-auto pos-scroll p-4 space-y-6" data-testid="packing-screen">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Packing</h2>
        <div className="text-xs px-2 py-1 rounded-full" style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
          {toPack.length} to pack
        </div>
      </div>

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
                  <span className="font-bold text-white">#{o.number}</span>
                  <span className="text-xs ml-2" style={{ color: "var(--pos-muted)" }}>{o.customer?.name}</span>
                </div>
                <button data-testid={`pack-undo-${o.number}`} onClick={() => undoPacked(o)} className="text-[11px] font-bold" style={{ color: "var(--pos-muted)" }}>Undo</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
