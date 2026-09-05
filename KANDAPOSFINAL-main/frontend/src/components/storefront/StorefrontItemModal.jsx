import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Minus, Plus, Check, UtensilsCrossed } from "lucide-react";

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
  const [variant, setVariant] = useState(null);

  useEffect(() => {
    if (item) {
      setSize("md"); setQty(1); setDealPicks({});
      setVariant(Array.isArray(item.variants) && item.variants.length ? item.variants[0] : null);
    }
  }, [item]);

  if (!item) return null;

  const isDeal = item.catId === "deals" && Array.isArray(item.dealGroups) && item.dealGroups.length > 0;
  const hasVariants = !isDeal && !item.isPizza && Array.isArray(item.variants) && item.variants.length > 0;
  const unitPrice = isDeal ? item.price : (item.isPizza ? item.sizes[size] : (hasVariants ? (variant?.price ?? 0) : item.price));
  const dealComplete = !isDeal || item.dealGroups.every((g, i) => (dealPicks[i] || []).length === g.count);
  const variantComplete = !hasVariants || (variant && variant.available !== false);

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
    } else if (hasVariants) {
      onAdd({ item_id: item.id, qty, variant: variant.label, mods: [], displayName: `${item.name} (${variant.label})`, displayPrice: unitPrice });
    } else {
      onAdd({ item_id: item.id, qty, size: item.isPizza ? size : null, mods: [], displayName: item.isPizza ? `${item.name} (${SIZE_OPTS.find((s) => s.id === size).label})` : item.name, displayPrice: unitPrice });
    }
    onClose();
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sf max-w-lg max-h-[85vh] overflow-y-auto p-0 overflow-hidden" style={{ background: "var(--sf-bg-elevated)", borderColor: "var(--sf-border)", color: "var(--sf-text)" }} data-testid="storefront-item-modal">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.name} className="w-full h-44 object-cover sf-item-img" />
        ) : (
          <div className="w-full h-28 flex items-center justify-center sf-item-img">
            <UtensilsCrossed className="w-8 h-8" style={{ color: "var(--sf-text-muted)" }} />
          </div>
        )}
        <div className="p-5 pt-3 space-y-4">
          <DialogHeader className="p-0"><DialogTitle style={{ color: "var(--sf-text)" }}>{item.name}</DialogTitle></DialogHeader>
          {item.desc && <p className="text-sm -mt-3" style={{ color: "var(--sf-text-muted)" }}>{item.desc}</p>}

          {isDeal && (
            <div className="space-y-4">
              {item.dealGroups.map((g, gi) => {
                const candidates = items.filter((m) => m.catId === g.cat_id && m.available);
                const picked = dealPicks[gi] || [];
                return (
                  <div key={gi}>
                    <div className="text-xs uppercase tracking-wider mb-2 font-semibold flex items-center justify-between" style={{ color: "var(--sf-text-muted)" }}>
                      <span>{g.label}</span>
                      <span style={{ color: picked.length === g.count ? "var(--sf-success)" : "var(--sf-text-muted)" }}>{picked.length}/{g.count}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {candidates.map((c) => {
                        const selected = picked.includes(c.id);
                        return (
                          <button key={c.id} onClick={() => toggleDealPick(gi, g, c.id)}
                            className="rounded-lg px-2.5 py-2 text-xs font-medium text-left flex items-center gap-1.5 sf-input"
                            style={selected ? { background: "var(--sf-success-bg)", color: "var(--sf-success)", borderColor: "var(--sf-success)" } : undefined}>
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

          {hasVariants && (
            <div>
              <div className="text-xs uppercase tracking-wider mb-2 font-semibold" style={{ color: "var(--sf-text-muted)" }}>Options</div>
              <div className="grid grid-cols-2 gap-2">
                {item.variants.map((v, i) => (
                  <button key={i} disabled={v.available === false} onClick={() => setVariant(v)}
                    className="rounded-xl py-2.5 text-sm font-semibold sf-input disabled:opacity-40"
                    style={variant?.label === v.label ? { background: "var(--sf-accent)", color: "var(--sf-accent-text)", borderColor: "var(--sf-accent)" } : undefined}>
                    {v.label}<div className="text-xs font-normal mt-0.5 opacity-80">{v.available === false ? "Unavailable" : `₹${v.price.toFixed(2)}`}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!isDeal && item.isPizza && (
            <div>
              <div className="text-xs uppercase tracking-wider mb-2 font-semibold" style={{ color: "var(--sf-text-muted)" }}>Size</div>
              <div className="grid grid-cols-3 gap-2">
                {SIZE_OPTS.map((s) => (
                  <button key={s.id} onClick={() => setSize(s.id)}
                    className="rounded-xl py-2.5 text-sm font-semibold sf-input"
                    style={size === s.id ? { background: "var(--sf-accent)", color: "var(--sf-accent-text)", borderColor: "var(--sf-accent)" } : undefined}>
                    {s.label}<div className="text-xs font-normal mt-0.5 opacity-80">₹{item.sizes[s.id].toFixed(2)}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-3">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="w-10 h-10 rounded-full flex items-center justify-center sf-input">
                <Minus className="w-4 h-4" />
              </button>
              <span className="text-xl font-bold w-8 text-center">{qty}</span>
              <button onClick={() => setQty((q) => q + 1)} className="w-10 h-10 rounded-full flex items-center justify-center sf-input">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <button data-testid="storefront-add-btn" onClick={add} disabled={!dealComplete || !variantComplete}
              className="px-6 h-12 rounded-full font-bold text-base disabled:opacity-40 disabled:cursor-not-allowed sf-btn-accent">
              {!dealComplete ? "Pick all items" : !variantComplete ? "Choose an option" : `Add ₹${(unitPrice * qty).toFixed(2)}`}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
