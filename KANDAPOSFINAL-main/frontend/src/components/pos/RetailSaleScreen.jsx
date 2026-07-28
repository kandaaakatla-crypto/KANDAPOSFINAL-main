import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePos } from "../../store/PosContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import PaymentModal from "./PaymentModal";
import { ScanLine, Minus, Plus, X, ShoppingCart, Package } from "lucide-react";
import { toast } from "sonner";
import { effectiveTaxRate, computeLineTax, computeOrderTax } from "../../utils/tax";

/** Retail checkout — basket + barcode/SKU lookup. No order type, no tables,
 *  no kitchen routing. Products with variants (e.g. size/colour) get a quick
 *  picker; everything else adds straight to the basket. */
export default function RetailSaleScreen() {
  const { menuItems, categories, placeOrder } = usePos();
  const [activeCat, setActiveCat] = useState(null);
  const [cart, setCart] = useState([]);
  const [barcode, setBarcode] = useState("");
  const [variantItem, setVariantItem] = useState(null);
  const [discountPct, setDiscountPct] = useState(0);
  const [payOpen, setPayOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const barcodeRef = useRef(null);

  useEffect(() => {
    if (!activeCat && categories.length) setActiveCat(categories[0].id);
  }, [categories, activeCat]);

  useEffect(() => { barcodeRef.current?.focus(); }, []);

  const items = useMemo(() => menuItems.filter((m) => m.catId === activeCat), [menuItems, activeCat]);
  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.price * l.qty, 0), [cart]);
  const discountAmt = +(subtotal * (discountPct / 100)).toFixed(2);
  const total = +(subtotal - discountAmt).toFixed(2);

  // GST is already included in retail prices (MRP) by law — this just
  // discloses the breakdown for the receipt, it doesn't change the total.
  const gst = useMemo(() => {
    const lineAmounts = cart.map((l) => {
      const cat = categories.find((c) => c.id === l.catId);
      const rate = effectiveTaxRate({ tax_rate: l.taxRate }, cat);
      return computeLineTax(l.price, l.qty, rate, true);
    });
    return computeOrderTax(lineAmounts);
  }, [cart, categories]);

  const addLine = (name, price, sku, catId, taxRate) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.name === name && l.price === price);
      if (existing) return prev.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { lineId: `l_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name, price, qty: 1, sku: sku || null, catId, taxRate }];
    });
  };

  const handleItemClick = (item) => {
    if (!item.available) return;
    if (Array.isArray(item.variants) && item.variants.length > 0) { setVariantItem(item); return; }
    addLine(item.name, item.price || 0, item.barcode, item.catId, item.tax_rate);
  };

  const addVariant = (item, variant) => {
    addLine(`${item.name} — ${variant.label}`, variant.price, variant.sku, item.catId, item.tax_rate);
    setVariantItem(null);
  };

  const handleBarcodeSubmit = (e) => {
    e.preventDefault();
    const code = barcode.trim();
    if (!code) return;
    const match = menuItems.find((m) => m.barcode && m.barcode === code);
    if (match) {
      handleItemClick(match);
      toast.success(`${match.name} added`);
    } else {
      toast.error(`No product found for barcode "${code}"`);
    }
    setBarcode("");
  };

  const updateQty = (lineId, delta) => setCart((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, qty: Math.max(1, l.qty + delta) } : l)));
  const removeLine = (lineId) => setCart((prev) => prev.filter((l) => l.lineId !== lineId));
  const resetAll = () => { setCart([]); setDiscountPct(0); setCartOpen(false); };

  const buildOrder = (payment, splits = null) => ({
    type: "sale",
    status: "completed",
    customer: { id: null, name: "Walk-in", phone: null, address: null, postcode: null },
    table: undefined,
    items: cart.map((l) => ({ name: l.name, qty: l.qty, price: l.price, mods: [], size: null })),
    deliveryFee: 0,
    discount: discountAmt,
    total,
    payment,
    source: "in-store",
    tip: 0,
    splits,
  });

  const onCreateOrder = async (method, splits = null) => {
    try {
      return await placeOrder(buildOrder(method, splits));
    } catch {
      return null;
    }
  };

  const onPaid = (method, placed) => {
    setPayOpen(false);
    toast.success(`Sale #${placed.number} paid by ${method} — ₹${total.toFixed(2)}`);
    resetAll();
  };

  return (
    <div className="flex flex-col md:flex-row h-full overflow-y-auto md:overflow-hidden pos-scroll pb-24 md:pb-0" data-testid="retail-sale-screen">
      {/* Left: barcode + categories + product grid */}
      <div className="w-full md:flex-1 md:min-w-0 flex flex-col gap-3 p-3 overflow-visible md:overflow-y-auto pos-scroll">
        <form onSubmit={handleBarcodeSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <ScanLine className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--pos-muted)" }} />
            <Input ref={barcodeRef} data-testid="retail-barcode-input" value={barcode} onChange={(e) => setBarcode(e.target.value)}
              placeholder="Scan or type a barcode / SKU, then Enter"
              className="h-11 pl-9 text-white" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} />
          </div>
        </form>

        <div className="flex gap-1.5 overflow-x-auto pos-scroll pb-1">
          {categories.map((c) => (
            <button key={c.id} data-testid={`retail-cat-${c.id}`} onClick={() => setActiveCat(c.id)}
              className="shrink-0 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap"
              style={{ background: activeCat === c.id ? "var(--pos-panel-2)" : "var(--pos-panel)", color: activeCat === c.id ? "#fff" : "var(--pos-muted)", border: `1px solid ${activeCat === c.id ? c.color : "var(--pos-border)"}` }}>
              {c.name}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map((item) => (
            <button key={item.id} data-testid={`retail-item-${item.id}`} onClick={() => handleItemClick(item)} disabled={!item.available}
              className="rounded-xl text-left flex flex-col overflow-hidden" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)", opacity: item.available ? 1 : 0.5 }}>
              {item.imageUrl ? (
                <img src={item.imageUrl} alt="" className="w-full aspect-square object-cover" style={{ background: "var(--pos-panel-2)" }} />
              ) : (
                <div className="w-full aspect-square flex items-center justify-center" style={{ background: "var(--pos-panel-2)" }}>
                  <Package className="w-6 h-6" style={{ color: "var(--pos-muted)" }} />
                </div>
              )}
              <div className="p-2.5">
                <div className="font-semibold text-white text-sm leading-snug">{item.name}</div>
                <div className="text-sm font-bold mt-1" style={{ color: "var(--pos-accent)" }}>
                  {item.available ? (Array.isArray(item.variants) && item.variants.length ? `From ₹${Math.min(...item.variants.map(v => v.price)).toFixed(0)}` : `₹${(item.price || 0).toFixed(0)}`) : "Out of stock"}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Mobile floating "View Cart" bar */}
      {cart.length > 0 && !cartOpen && (
        <button data-testid="retail-open-cart-bar" onClick={() => setCartOpen(true)}
          className="md:hidden fixed bottom-16 inset-x-0 z-40 h-14 flex items-center justify-between px-5 font-bold text-white"
          style={{ background: "var(--pos-accent)" }}>
          <span className="flex items-center gap-2"><ShoppingCart className="w-4 h-4" /> {cart.length} item{cart.length === 1 ? "" : "s"}</span>
          <span>₹{total.toFixed(2)} · View Basket</span>
        </button>
      )}

      {/* Basket panel */}
      <div className={`${cartOpen ? "fixed inset-0 z-50 flex" : "hidden"} md:static md:z-auto md:flex md:w-[340px] md:shrink-0 flex-col h-full`} data-testid="retail-basket-panel">
        <div className="flex flex-col h-full w-full" style={{ background: "var(--pos-panel)", borderLeft: "1px solid var(--pos-border)" }}>
          <div className="flex items-center justify-between p-4 shrink-0" style={{ borderBottom: "1px solid var(--pos-border)" }}>
            <button data-testid="retail-cart-close-btn" onClick={() => setCartOpen(false)} className="pos-btn -ml-2 w-11 h-11 flex items-center justify-center rounded-lg md:hidden">
              <X className="w-5 h-5 text-white" />
            </button>
            <div className="font-bold text-white flex items-center gap-2"><ShoppingCart className="w-4 h-4" /> Basket</div>
            <div className="w-11 md:hidden" />
          </div>

          <div className="flex-1 overflow-y-auto pos-scroll p-4 space-y-3">
            {cart.length === 0 ? (
              <p className="text-sm text-center py-8" style={{ color: "var(--pos-muted)" }}>Scan or tap a product to start a sale.</p>
            ) : cart.map((l) => (
              <div key={l.lineId} data-testid={`retail-line-${l.lineId}`} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm text-white truncate">{l.name}</div>
                  <div className="text-xs" style={{ color: "var(--pos-muted)" }}>₹{l.price.toFixed(2)} each</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => updateQty(l.lineId, -1)} className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: "var(--pos-panel-2)" }}><Minus className="w-3.5 h-3.5 text-white" /></button>
                  <span className="text-sm text-white w-5 text-center">{l.qty}</span>
                  <button onClick={() => updateQty(l.lineId, 1)} className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: "var(--pos-panel-2)" }}><Plus className="w-3.5 h-3.5 text-white" /></button>
                  <button onClick={() => removeLine(l.lineId)} className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: "var(--pos-panel-2)" }}><X className="w-3.5 h-3.5 text-red-400" /></button>
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 space-y-3 shrink-0" style={{ borderTop: "1px solid var(--pos-border)" }}>
            <div>
              <div className="text-xs uppercase tracking-wider mb-1.5 font-semibold" style={{ color: "var(--pos-muted)" }}>Discount</div>
              <div className="grid grid-cols-3 gap-2">
                {[0, 10, 20].map((p) => (
                  <button key={p} data-testid={`retail-discount-${p}`} onClick={() => setDiscountPct(p)}
                    className="pos-btn h-9 rounded-md text-xs font-bold"
                    style={{ background: discountPct === p ? "var(--pos-accent)" : "var(--pos-panel-2)", color: discountPct === p ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                    {p === 0 ? "None" : `${p}%`}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between" style={{ color: "var(--pos-muted)" }}><span>Subtotal</span><span className="tabular-nums">₹{subtotal.toFixed(2)}</span></div>
              {discountAmt > 0 && <div className="flex justify-between" style={{ color: "var(--pos-muted)" }}><span>Discount</span><span className="tabular-nums">-₹{discountAmt.toFixed(2)}</span></div>}
              <div className="flex justify-between text-base font-bold text-white pt-1"><span>Total</span><span className="tabular-nums">₹{total.toFixed(2)}</span></div>
              {gst.taxTotal > 0 && (
                <div className="text-[11px] pt-1" style={{ color: "var(--pos-muted)" }}>
                  Includes GST ₹{gst.taxTotal.toFixed(2)} (CGST ₹{gst.cgst.toFixed(2)} + SGST ₹{gst.sgst.toFixed(2)})
                </div>
              )}
            </div>
            <button data-testid="retail-pay-btn" onClick={() => setPayOpen(true)} disabled={cart.length === 0}
              className="pos-btn w-full h-14 rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 text-white"
              style={{ background: "var(--pos-accent)" }}>
              Pay ₹{total.toFixed(2)}
            </button>
          </div>
        </div>
      </div>

      <PaymentModal open={payOpen} onClose={() => setPayOpen(false)} total={total} customerName="Walk-in" onCreateOrder={onCreateOrder} onPaid={onPaid} />

      <Dialog open={!!variantItem} onOpenChange={(o) => !o && setVariantItem(null)}>
        <DialogContent className="max-w-sm border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
          <DialogHeader><DialogTitle className="text-white">{variantItem?.name}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            {(variantItem?.variants || []).map((v, i) => (
              <button key={i} disabled={!v.available} onClick={() => addVariant(variantItem, v)}
                className="pos-btn w-full h-12 rounded-lg flex items-center justify-between px-4 disabled:opacity-40"
                style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                <span className="text-sm font-semibold text-white">{v.label}</span>
                <span className="text-sm font-bold" style={{ color: "var(--pos-accent)" }}>{v.available ? `₹${v.price.toFixed(2)}` : "Unavailable"}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
