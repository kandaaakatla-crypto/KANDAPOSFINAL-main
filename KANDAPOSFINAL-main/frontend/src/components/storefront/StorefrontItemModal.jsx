import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Minus, Plus, Check } from "lucide-react";

const SIZE_OPTS = [
  { id: "sm", label: "Small" },
  { id: "md", label: "Medium" },
  { id: "lg", label: "Large" },
];

/** Simplified picker for the customer-facing storefront — size for pizzas,
 *  pick-N-per-group for deals. No topping customization (kept for staff POS). */
export default function StorefrontItemModal({ item, items, onClose, onAdd }) {
  const [size, setSize] = useState("md");
  const [qty, setQty] = useState(1);
  const [dealPicks, setDealPicks] = useState({});

  useEffect(() => {
    if (item) { setSize("md"); setQty(1); setDealPicks({}); }
  }, [item]);

  if (!item) return null;

  const isDeal = item.catId === "deals" && Array.isArray(item.dealGroups) && item.dealGroups.length > 0;
  const unitPrice = isDeal ? item.price : (item.isPizza ? item.sizes[size] : item.price);
  const dealComplete = !isDeal || item.dealGroups.every((g, i) => (dealPicks[i] || []).length === g.count);

  const toggleDealPick = (gi, g, candidateId) => {
    setDealPicks((prev) => {
      const current = prev[gi] || [];
      if (current.includes(candidateId)) return { ...prev, [gi]: current.filter((id) => id !== candidateId) };
      if (current.length >= g.count) return prev;
      return { ...prev, [gi]: [...current, candidateId] };
    });
  };

  const add = () => {
    if (isDeal) {
      const mods = item.dealGroups.flatMap((g, gi) => {
        const candidates = items.filter((m) => m.catId === g.cat_id && m.available);
        return (dealPicks[gi] || []).map((id) => {
          const m = candidates.find((c) => c.id === id);
          const sizeTag = g.size ? ` (${SIZE_OPTS.find((s) => s.id === g.size)?.label[0]})` : "";
          return `${g.label.replace(/^Choose\s*/i, "")}: ${m ? m.name : "?"}${sizeTag}`;
        });
      });
      onAdd({ item_id: item.id, qty, mods, displayName: item.name, displayPrice: item.price });
    } else {
      onAdd({ item_id: item.id, qty, size: item.isPizza ? size : null, mods: [], displayName: item.isPizza ? `${item.name} (${SIZE_OPTS.find((s) => s.id === size).label})` : item.name, displayPrice: unitPrice });
    }
    onClose();
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} data-testid="storefront-item-modal">
        <DialogHeader><DialogTitle className="text-white">{item.name}</DialogTitle></DialogHeader>
        {item.desc && <p className="text-sm -mt-2" style={{ color: "var(--pos-muted)" }}>{item.desc}</p>}

        {isDeal && (
          <div className="space-y-4">
            {item.dealGroups.map((g, gi) => {
              const candidates = items.filter((m) => m.catId === g.cat_id && m.available);
              const picked = dealPicks[gi] || [];
              return (
                <div key={gi}>
                  <div className="text-xs uppercase tracking-wider mb-2 font-semibold flex items-center justify-between" style={{ color: "var(--pos-muted)" }}>
                    <span>{g.label}</span>
                    <span className={picked.length === g.count ? "text-green-400" : ""}>{picked.length}/{g.count}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {candidates.map((c) => {
                      const selected = picked.includes(c.id);
                      return (
                        <button key={c.id} onClick={() => toggleDealPick(gi, g, c.id)}
                          className="rounded-md px-2.5 py-2 text-xs font-medium text-left flex items-center gap-1.5"
                          style={{ background: selected ? "#1c3a2a" : "var(--pos-panel-2)", color: selected ? "#7ee2a8" : "var(--pos-muted)", border: `1px solid ${selected ? "#2e7d4f" : "var(--pos-border)"}` }}>
                          {selected && <Check className="w-3 h-3 shrink-0" />}
                          <span className="truncate">{c.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!isDeal && item.isPizza && (
          <div>
            <div className="text-xs uppercase tracking-wider mb-2 font-semibold" style={{ color: "var(--pos-muted)" }}>Size</div>
            <div className="grid grid-cols-3 gap-2">
              {SIZE_OPTS.map((s) => (
                <button key={s.id} onClick={() => setSize(s.id)}
                  className="rounded-lg py-2.5 text-sm font-semibold"
                  style={{ background: size === s.id ? "var(--pos-accent)" : "var(--pos-panel-2)", color: size === s.id ? "#fff" : "var(--pos-muted)", border: `1px solid ${size === s.id ? "var(--pos-accent)" : "var(--pos-border)"}` }}>
                  {s.label}<div className="text-xs font-normal mt-0.5">₹{item.sizes[s.id].toFixed(2)}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-3">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
              <Minus className="w-4 h-4 text-white" />
            </button>
            <span className="text-xl font-bold text-white w-8 text-center">{qty}</span>
            <button onClick={() => setQty((q) => q + 1)} className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
              <Plus className="w-4 h-4 text-white" />
            </button>
          </div>
          <button data-testid="storefront-add-btn" onClick={add} disabled={!dealComplete}
            className="px-6 h-12 rounded-xl font-bold text-white text-base disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "var(--pos-accent)" }}>
            {dealComplete ? `Add ₹${(unitPrice * qty).toFixed(2)}` : "Pick all items"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
