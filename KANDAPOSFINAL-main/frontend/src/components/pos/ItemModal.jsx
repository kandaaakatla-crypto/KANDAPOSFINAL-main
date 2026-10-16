import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { PIZZA_SIZES, TOPPINGS, TOPPING_PRICE } from "../../data/mock";
import { Minus, Plus, Check } from "lucide-react";
import { Input } from "../ui/input";

export default function ItemModal({ item, menuItems = [], onClose, onAdd }) {
  const [size, setSize] = useState("md");
  const [toppings, setToppings] = useState([]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [dealPicks, setDealPicks] = useState({}); // { [groupIdx]: itemId[] }

  useEffect(() => {
    if (item) { setSize("md"); setToppings([]); setQty(1); setNote(""); setDealPicks({}); }
  }, [item]);

  if (!item) return null;

  const isPizza = !!item.isPizza;
  const isDeal = item.catId === "deals" && Array.isArray(item.dealGroups) && item.dealGroups.length > 0;
  const basePrice = isPizza ? item.sizes[size] : item.price;
  const toppingCost = isPizza ? toppings.length * TOPPING_PRICE[size] : 0;
  const unitPrice = isDeal ? item.price : basePrice + toppingCost;

  const toggleTopping = (t) => {
    setToppings((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const toggleDealPick = (groupIdx, group, candidate) => {
    setDealPicks((prev) => {
      const current = prev[groupIdx] || [];
      if (current.includes(candidate.id)) {
        return { ...prev, [groupIdx]: current.filter((id) => id !== candidate.id) };
      }
      if (current.length >= group.count) return prev; // full — deselect one first
      return { ...prev, [groupIdx]: [...current, candidate.id] };
    });
  };

  const dealComplete = !isDeal || item.dealGroups.every((g, i) => (dealPicks[i] || []).length === g.count);

  const add = () => {
    if (isDeal) {
      const mods = item.dealGroups.flatMap((g, i) => {
        const candidates = menuItems.filter((m) => m.catId === g.cat_id && m.available);
        return (dealPicks[i] || []).map((id) => {
          const m = candidates.find((c) => c.id === id);
          const sizeTag = g.size ? ` (${PIZZA_SIZES.find((s) => s.id === g.size)?.short || g.size})` : "";
          return `${g.label.replace(/^Choose\s*/i, "")}: ${m ? m.name : "?"}${sizeTag}`;
        });
      });
      onAdd({ name: item.name, qty, price: item.price, mods, note: note ? `${note}` : "", catId: item.catId, taxRate: item.tax_rate });
      onClose();
      return;
    }
    const sizeLabel = isPizza ? ` ${PIZZA_SIZES.find((s) => s.id === size).label.split(" ")[0]}` : "";
    onAdd({
      name: `${item.name}${sizeLabel}`,
      qty,
      price: Math.round(unitPrice * 100) / 100,
      mods: [...toppings.map((t) => `+ ${t}`), ...(note ? [`Note: ${note}`] : [])],
      note,
      catId: item.catId,
      taxRate: item.tax_rate,
    });
    onClose();
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto pos-scroll border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} data-testid="item-modal">
        <DialogHeader>
          <DialogTitle style={{ color: "var(--pos-text)" }}>{item.name}</DialogTitle>
        </DialogHeader>
        {item.desc && <p className="text-sm -mt-2" style={{ color: "var(--pos-muted)" }}>{item.desc}</p>}

        {isDeal && (
          <div className="space-y-4">
            {item.dealGroups.map((g, gi) => {
              const candidates = menuItems.filter((m) => m.catId === g.cat_id && m.available);
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
                      const hint = g.size ? (c.sizes ? `₹${c.sizes[g.size]?.toFixed(0)}` : "") : (c.price != null ? `₹${c.price.toFixed(0)}` : "");
                      return (
                        <button key={c.id} data-testid={`deal-pick-${gi}-${c.id}`} onClick={() => toggleDealPick(gi, g, c)}
                          className="pos-btn rounded-md px-2.5 py-2 text-xs font-medium text-left flex items-center justify-between gap-1"
                          style={{ background: selected ? "#1c3a2a" : "var(--pos-panel-2)", color: selected ? "#7ee2a8" : "var(--pos-muted)", border: `1px solid ${selected ? "#2e7d4f" : "var(--pos-border)"}` }}>
                          <span className="flex items-center gap-1.5 min-w-0">
                            {selected && <Check className="w-3 h-3 shrink-0" />}
                            <span className="truncate">{c.name}</span>
                          </span>
                          {hint && <span className="shrink-0 opacity-70">{hint}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!isDeal && isPizza && (
          <>
            <div>
              <div className="text-xs uppercase tracking-wider mb-2 font-semibold" style={{ color: "var(--pos-muted)" }}>Size</div>
              <div className="grid grid-cols-3 gap-2">
                {PIZZA_SIZES.map((s) => (
                  <button key={s.id} data-testid={`size-${s.id}`} aria-pressed={size === s.id} onClick={() => setSize(s.id)}
                    className="pos-btn rounded-lg py-2.5 text-sm font-semibold"
                    style={{ background: size === s.id ? "var(--pos-accent)" : "var(--pos-panel-2)", color: size === s.id ? "#fff" : "var(--pos-muted)", border: `1px solid ${size === s.id ? "var(--pos-accent)" : "var(--pos-border)"}` }}>
                    {s.label}<div className="text-xs font-normal mt-0.5">₹{item.sizes[s.id].toFixed(2)}</div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider mb-2 font-semibold" style={{ color: "var(--pos-muted)" }}>
                Extra Toppings <span className="normal-case">(+₹{TOPPING_PRICE[size].toFixed(2)} each)</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 max-h-44 overflow-y-auto pos-scroll pr-1">
                {TOPPINGS.map((t) => (
                  <button key={t} data-testid={`topping-${t.toLowerCase().replace(/\s/g, "-")}`} onClick={() => toggleTopping(t)}
                    className="pos-btn rounded-md px-2 py-2 text-xs font-medium"
                    style={{ background: toppings.includes(t) ? "#1c3a2a" : "var(--pos-panel-2)", color: toppings.includes(t) ? "#7ee2a8" : "var(--pos-muted)", border: `1px solid ${toppings.includes(t) ? "#2e7d4f" : "var(--pos-border)"}` }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <div>
          <div className="text-xs uppercase tracking-wider mb-2 font-semibold" style={{ color: "var(--pos-muted)" }}>Special Instructions</div>
          <Input data-testid="item-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. well done, cut in squares, allergy info..."
            className="h-10" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-3">
            <button data-testid="qty-minus" onClick={() => setQty((q) => Math.max(1, q - 1))} className="pos-btn w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
              <Minus className="w-4 h-4" style={{ color: "var(--pos-text)" }} />
            </button>
            <span className="text-xl font-bold w-8 text-center" style={{ color: "var(--pos-text)" }} data-testid="qty-value">{qty}</span>
            <button data-testid="qty-plus" onClick={() => setQty((q) => q + 1)} className="pos-btn w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
              <Plus className="w-4 h-4" style={{ color: "var(--pos-text)" }} />
            </button>
          </div>
          <button data-testid="add-to-order-btn" onClick={add} disabled={!dealComplete}
            className="pos-btn px-6 h-12 rounded-xl font-bold text-white text-base disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "var(--pos-accent)" }}>
            {dealComplete ? `Add ₹${(unitPrice * qty).toFixed(2)}` : "Pick all items"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
