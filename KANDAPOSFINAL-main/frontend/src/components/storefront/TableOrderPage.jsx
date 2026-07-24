import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { storefrontApi } from "../../api/storefrontClient";
import StorefrontItemModal from "./StorefrontItemModal";
import { Pizza, Minus, Plus, X, ShoppingCart, CheckCircle2, Loader2 } from "lucide-react";

export default function TableOrderPage() {
  const { slug, number } = useParams();
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState("");
  const [activeCat, setActiveCat] = useState(null);
  const [cart, setCart] = useState([]);
  const [modalItem, setModalItem] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [name, setName] = useState("");
  const [placing, setPlacing] = useState(false);
  const [confirmed, setConfirmed] = useState(null);

  useEffect(() => {
    Promise.all([storefrontApi.menu(slug), storefrontApi.table(slug, number)])
      .then(([m]) => { setMenu(m); if (m.categories.length) setActiveCat(m.categories[0].id); })
      .catch((e) => setError(e?.response?.data?.detail || "This link isn't valid."));
  }, [slug, number]);

  const items = useMemo(() => (menu?.items || []).filter((m) => m.catId === activeCat), [menu, activeCat]);
  const total = useMemo(() => cart.reduce((s, l) => s + l.displayPrice * l.qty, 0), [cart]);

  const handleItemClick = (item) => {
    if (!item.available) return;
    if (item.isPizza || item.catId === "deals") { setModalItem(item); return; }
    setCart((prev) => [...prev, { lineId: `l_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, item_id: item.id, qty: 1, size: null, mods: [], displayName: item.name, displayPrice: item.price }]);
  };
  const addFromModal = (line) => setCart((prev) => [...prev, { ...line, lineId: `l_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }]);
  const updateQty = (lineId, delta) => setCart((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, qty: Math.max(1, l.qty + delta) } : l)));
  const removeLine = (lineId) => setCart((prev) => prev.filter((l) => l.lineId !== lineId));

  const placeOrder = async () => {
    if (cart.length === 0) return;
    setPlacing(true);
    try {
      const res = await storefrontApi.placeTableOrder(slug, number, {
        items: cart.map((l) => ({ item_id: l.item_id, qty: l.qty, size: l.size, mods: l.mods })),
        customer_name: name.trim() || undefined,
      });
      setConfirmed(res);
      setCart([]);
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not place your order — please try again.");
    } finally {
      setPlacing(false);
    }
  };

  if (error && !menu) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--pos-bg)" }}>
        <div className="text-center max-w-sm">
          <p className="text-white font-semibold mb-1">Can't load this menu</p>
          <p className="text-sm" style={{ color: "var(--pos-muted)" }}>{error}</p>
        </div>
      </div>
    );
  }

  if (confirmed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--pos-bg)" }}>
        <div className="text-center max-w-sm" data-testid="table-order-confirmed">
          <CheckCircle2 className="w-14 h-14 mx-auto mb-4" style={{ color: "#22c55e" }} />
          <div className="text-2xl font-bold text-white mb-1">Sent to the kitchen!</div>
          <div className="text-sm mb-4" style={{ color: "var(--pos-muted)" }}>Order #{confirmed.orderNumber} · ₹{confirmed.total.toFixed(2)}</div>
          <p className="text-xs" style={{ color: "var(--pos-muted)" }}>Your bill will be settled at the table when you're ready. Want to add more? Just scan the QR again.</p>
          <button onClick={() => setConfirmed(null)} className="mt-6 h-11 px-6 rounded-xl font-bold text-white" style={{ background: "var(--pos-accent)" }}>
            Order more
          </button>
        </div>
      </div>
    );
  }

  if (!menu) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--pos-bg)" }}>
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--pos-accent)" }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-28" style={{ background: "var(--pos-bg)" }} data-testid="table-order-page">
      <header className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between" style={{ background: "rgba(11,18,32,0.9)", backdropFilter: "blur(8px)", borderBottom: "1px solid var(--pos-border)" }}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-accent)" }}><Pizza className="w-4 h-4 text-white" /></div>
          <div>
            <div className="text-sm font-bold text-white">{menu.tenant.name}</div>
            <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>Table {number}</div>
          </div>
        </div>
        <button onClick={() => setCartOpen(true)} className="relative w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          <ShoppingCart className="w-4 h-4 text-white" />
          {cart.length > 0 && <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-white" style={{ background: "var(--pos-accent)" }}>{cart.length}</span>}
        </button>
      </header>

      <div className="flex gap-1.5 overflow-x-auto px-4 py-3">
        {menu.categories.map((c) => (
          <button key={c.id} onClick={() => setActiveCat(c.id)}
            className="shrink-0 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap"
            style={{ background: activeCat === c.id ? "var(--pos-panel-2)" : "var(--pos-panel)", color: activeCat === c.id ? "#fff" : "var(--pos-muted)", border: `1px solid ${activeCat === c.id ? c.color : "var(--pos-border)"}` }}>
            {c.name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 px-4">
        {items.map((item) => {
          const priceLabel = item.isPizza ? `₹${item.sizes.sm.toFixed(0)} – ₹${item.sizes.lg.toFixed(0)}` : `₹${(item.price || 0).toFixed(0)}`;
          return (
            <button key={item.id} data-testid={`sf-item-${item.id}`} onClick={() => handleItemClick(item)}
              className="rounded-xl p-3.5 text-left flex flex-col justify-between min-h-[100px]"
              style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
              <div>
                <div className="font-semibold text-white text-sm leading-snug">{item.name}</div>
                {item.desc && <div className="text-[11px] mt-1 leading-snug" style={{ color: "var(--pos-muted)" }}>{item.desc}</div>}
              </div>
              <div className="text-sm font-bold mt-2" style={{ color: "var(--pos-accent)" }}>{priceLabel}</div>
            </button>
          );
        })}
      </div>

      {cart.length > 0 && !cartOpen && (
        <button onClick={() => setCartOpen(true)} data-testid="sf-view-cart"
          className="fixed bottom-4 inset-x-4 h-14 rounded-xl font-bold text-white flex items-center justify-between px-5"
          style={{ background: "var(--pos-accent)" }}>
          <span>{cart.length} item{cart.length > 1 ? "s" : ""}</span>
          <span>₹{total.toFixed(2)} · View cart</span>
        </button>
      )}

      {cartOpen && (
        <div className="fixed inset-0 z-20 flex items-end sm:items-center sm:justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setCartOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-lg font-bold text-white">Your order</div>
              <button onClick={() => setCartOpen(false)}><X className="w-5 h-5" style={{ color: "var(--pos-muted)" }} /></button>
            </div>
            {cart.length === 0 ? (
              <p className="text-sm text-center py-8" style={{ color: "var(--pos-muted)" }}>Your cart is empty.</p>
            ) : (
              <div className="space-y-3 mb-4">
                {cart.map((l) => (
                  <div key={l.lineId} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm text-white truncate">{l.displayName}</div>
                      {l.mods?.length > 0 && <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>{l.mods.join(" · ")}</div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => updateQty(l.lineId, -1)} className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: "var(--pos-panel-2)" }}><Minus className="w-3 h-3 text-white" /></button>
                      <span className="text-sm text-white w-4 text-center">{l.qty}</span>
                      <button onClick={() => updateQty(l.lineId, 1)} className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: "var(--pos-panel-2)" }}><Plus className="w-3 h-3 text-white" /></button>
                      <button onClick={() => removeLine(l.lineId)} className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: "var(--pos-panel-2)" }}><X className="w-3 h-3 text-red-400" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <input placeholder="Your name (optional)" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full h-10 px-3 rounded-lg text-sm text-white mb-3" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} />
            <div className="flex items-center justify-between text-base font-bold text-white mb-4">
              <span>Total</span><span>₹{total.toFixed(2)}</span>
            </div>
            <button data-testid="sf-send-to-kitchen" onClick={placeOrder} disabled={cart.length === 0 || placing}
              className="w-full h-12 rounded-xl font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ background: "var(--pos-accent)" }}>
              {placing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send to Kitchen"}
            </button>
          </div>
        </div>
      )}

      <StorefrontItemModal item={modalItem} items={menu.items} onClose={() => setModalItem(null)} onAdd={addFromModal} />
    </div>
  );
}
