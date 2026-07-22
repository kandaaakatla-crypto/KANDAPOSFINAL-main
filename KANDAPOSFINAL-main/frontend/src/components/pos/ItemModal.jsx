import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { PIZZA_SIZES, TOPPINGS, TOPPING_PRICE } from "../../data/mock";
import { Minus, Plus } from "lucide-react";
import { Input } from "../ui/input";

export default function ItemModal({ item, onClose, onAdd }) {
  const [size, setSize] = useState("md");
  const [toppings, setToppings] = useState([]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (item) { setSize("md"); setToppings([]); setQty(1); setNote(""); }
  }, [item]);

  if (!item) return null;

  const isPizza = !!item.isPizza;
  const basePrice = isPizza ? item.sizes[size] : item.price;
  const toppingCost = isPizza ? toppings.length * TOPPING_PRICE[size] : 0;
  const unitPrice = basePrice + toppingCost;

  const toggleTopping = (t) => {
    setToppings((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const add = () => {
    const sizeLabel = isPizza ? ` ${PIZZA_SIZES.find((s) => s.id === size).label.split(" ")[0]}` : "";
    onAdd({
      name: `${item.name}${sizeLabel}`,
      qty,
      price: Math.round(unitPrice * 100) / 100,
      mods: [...toppings.map((t) => `+ ${t}`), ...(note ? [`Note: ${note}`] : [])],
      note,
    });
    onClose();
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} data-testid="item-modal">
        <DialogHeader>
          <DialogTitle className="text-white">{item.name}</DialogTitle>
        </DialogHeader>
        {item.desc && <p className="text-sm -mt-2" style={{ color: "var(--pos-muted)" }}>{item.desc}</p>}

        {isPizza && (
          <>
            <div>
              <div className="text-xs uppercase tracking-wider mb-2 font-semibold" style={{ color: "var(--pos-muted)" }}>Size</div>
              <div className="grid grid-cols-3 gap-2">
                {PIZZA_SIZES.map((s) => (
                  <button key={s.id} data-testid={`size-${s.id}`} onClick={() => setSize(s.id)}
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
            className="h-10 text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-3">
            <button data-testid="qty-minus" onClick={() => setQty((q) => Math.max(1, q - 1))} className="pos-btn w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
              <Minus className="w-4 h-4 text-white" />
            </button>
            <span className="text-xl font-bold text-white w-8 text-center" data-testid="qty-value">{qty}</span>
            <button data-testid="qty-plus" onClick={() => setQty((q) => q + 1)} className="pos-btn w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
              <Plus className="w-4 h-4 text-white" />
            </button>
          </div>
          <button data-testid="add-to-order-btn" onClick={add} className="pos-btn px-6 h-12 rounded-xl font-bold text-white text-base" style={{ background: "var(--pos-accent)" }}>
            Add ₹{(unitPrice * qty).toFixed(2)}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
