import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { storefrontApi } from "../../api/storefrontClient";
import { useStorefrontTheme } from "./useStorefrontTheme";
import { effectiveTaxRate, computeLineTax, computeOrderTax } from "../../utils/tax";
import StorefrontItemModal from "./StorefrontItemModal";
import FoodMark from "./FoodMark";
import { filterStorefrontItems } from "../../utils/foodType";
import "./storefront.css";
import {
  UtensilsCrossed, Minus, Plus, X, ShoppingCart, CheckCircle2, Loader2,
  Sun, Moon, Search, ChevronLeft, Wallet, CreditCard, Clock,
} from "lucide-react";

const STEP = { CART: "cart", PAYMENT: "payment", PLACING: "placing" };

async function runOnlinePayment({ slug, orderId, amount, customerName }) {
  if (typeof window.Razorpay !== "function") {
    return { ok: false, reason: "Online payment isn't available for this store. Your order is saved, pay at the table." };
  }
  let rzpOrder;
  try {
    rzpOrder = await storefrontApi.createPaymentOrder(slug, orderId, amount);
  } catch (e) {
    return { ok: false, reason: e?.response?.data?.detail || "Online payment isn't available for this store. Your order is saved, pay at the table." };
  }
  return new Promise((resolve) => {
    const rzp = new window.Razorpay({
      key: rzpOrder.razorpayKeyId, amount: rzpOrder.amount, currency: rzpOrder.currency,
      order_id: rzpOrder.razorpayOrderId, name: "Order payment", description: `Order`,
      prefill: { name: customerName || "" }, theme: { color: "#d9480f" },
      modal: { ondismiss: () => resolve({ ok: false, reason: "Payment cancelled. Your order is saved, pay at the table." }) },
      handler: async (resp) => {
        try {
          const result = await storefrontApi.verifyPayment(slug, {
            order_id: orderId, razorpay_order_id: resp.razorpay_order_id,
            razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature,
          });
          resolve({ ok: true, order: result.order });
        } catch (e) {
          resolve({ ok: false, reason: e?.response?.data?.detail || "Payment verification failed. Your order is saved, pay at the table." });
        }
      },
    });
    rzp.open();
  });
}

export default function TableOrderPage() {
  const { slug, number } = useParams();
  const [theme, toggleTheme] = useStorefrontTheme();
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState("");
  const [activeCat, setActiveCat] = useState(null);
  const [query, setQuery] = useState("");
  const [vegOnly, setVegOnly] = useState(false);
  const [cart, setCart] = useState([]);
  const [modalItem, setModalItem] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [sheetStep, setSheetStep] = useState(STEP.CART);
  const [name, setName] = useState("");
  const [placing, setPlacing] = useState(false);
  const [confirmed, setConfirmed] = useState(null);

  useEffect(() => {
    Promise.all([storefrontApi.menu(slug), storefrontApi.table(slug, number)])
      .then(([m]) => { setMenu(m); if (m.categories.length) setActiveCat(m.categories[0].id); })
      .catch((e) => setError(e?.response?.data?.detail || "This link isn't valid."));
  }, [slug, number]);

  const items = useMemo(() => filterStorefrontItems(menu?.items, { catId: activeCat, query, vegOnly }), [menu, activeCat, query, vegOnly]);
  const hasVegMarks = useMemo(() => (menu?.items || []).some((i) => i.foodType), [menu]);
  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.displayPrice * l.qty, 0), [cart]);
  // GST is added on top of restaurant menu pricing (exclusive) — preview only;
  // the backend recomputes and charges the authoritative amount at checkout.
  const gst = useMemo(() => {
    const lineAmounts = cart.map((l) => {
      const item = menu?.items?.find((i) => i.id === l.item_id);
      const cat = menu?.categories?.find((c) => c.id === item?.catId);
      return computeLineTax(l.displayPrice, l.qty, effectiveTaxRate(item, cat), false);
    });
    return computeOrderTax(lineAmounts);
  }, [cart, menu]);
  const total = +(subtotal + gst.taxTotal).toFixed(2);

  const handleItemClick = (item) => {
    if (!item.available) return;
    if (item.isPizza || item.catId === "deals" || (Array.isArray(item.variants) && item.variants.length)) { setModalItem(item); return; }
    setCart((prev) => [...prev, { lineId: `l_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, item_id: item.id, qty: 1, size: null, mods: [], displayName: item.name, displayPrice: item.price }]);
  };
  const addFromModal = (line) => setCart((prev) => [...prev, { ...line, lineId: `l_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }]);
  const updateQty = (lineId, delta) => setCart((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, qty: Math.max(1, l.qty + delta) } : l)));
  const removeLine = (lineId) => setCart((prev) => prev.filter((l) => l.lineId !== lineId));

  const openCart = () => { setSheetStep(STEP.CART); setCartOpen(true); };

  const finalizeOrder = async (payOnline) => {
    setPlacing(true); setSheetStep(STEP.PLACING);
    try {
      const res = await storefrontApi.placeTableOrder(slug, number, {
        items: cart.map((l) => ({ item_id: l.item_id, qty: l.qty, size: l.size, variant: l.variant, mods: l.mods })),
        customer_name: name.trim() || undefined,
      });

      let paid = false;
      if (payOnline) {
        const result = await runOnlinePayment({ slug, orderId: res.orderId, amount: res.total, customerName: name });
        if (result.ok) paid = true; else toast.info(result.reason);
      }
      setConfirmed({ ...res, paid });
      setCart([]);
      setCartOpen(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not place your order, please try again.");
      setSheetStep(STEP.PAYMENT);
    } finally { setPlacing(false); }
  };

  const goToPayment = () => {
    if (cart.length === 0) return;
    setSheetStep(STEP.PAYMENT);
  };

  const themeClass = `sf ${theme === "dark" ? "sf-dark" : ""}`;

  if (error && !menu) {
    return (
      <div className={themeClass} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div className="text-center max-w-sm">
          <p className="font-semibold mb-1">Can't load this menu</p>
          <p className="text-sm" style={{ color: "var(--sf-text-muted)" }}>{error}</p>
        </div>
      </div>
    );
  }

  if (confirmed) {
    return (
      <div className={themeClass} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div className="text-center max-w-sm" data-testid="table-order-confirmed">
          <CheckCircle2 className="w-14 h-14 mx-auto mb-4" style={{ color: "var(--sf-success)" }} />
          <div className="text-2xl font-bold mb-1">Sent to the kitchen!</div>
          <div className="text-sm mb-1" style={{ color: "var(--sf-text-muted)" }}>Order #{confirmed.orderNumber} · ₹{confirmed.total.toFixed(2)}</div>
          <div className="text-xs mb-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: confirmed.paid ? "var(--sf-success-bg)" : "var(--sf-bg-sunken)", color: confirmed.paid ? "var(--sf-success)" : "var(--sf-text-muted)" }}>
            {confirmed.paid ? <><CheckCircle2 className="w-3.5 h-3.5" /> Paid online</> : <><Clock className="w-3.5 h-3.5" /> Pay at the table</>}
          </div>
          <p className="text-xs" style={{ color: "var(--sf-text-muted)" }}>Want to add more? Just scan the QR again.</p>
          <button onClick={() => setConfirmed(null)} className="mt-6 h-11 px-6 rounded-full font-bold sf-btn-accent">
            Order more
          </button>
        </div>
      </div>
    );
  }

  if (!menu) {
    return (
      <div className={themeClass} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--sf-accent)" }} />
      </div>
    );
  }

  const bgImage = menu.tenant.backgroundImageUrl;

  return (
    <div className={`${themeClass} ${bgImage ? "sf-bg-image" : ""}`}
      style={{ paddingBottom: 112, ...(bgImage ? { backgroundImage: `linear-gradient(var(--sf-bg-scrim), var(--sf-bg-scrim)), url(${bgImage})` } : {}) }}
      data-testid="table-order-page">
      <header className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between sf-card" style={{ backdropFilter: "blur(10px)", borderLeft: "none", borderRight: "none", borderTop: "none" }}>
        <div className="flex items-center gap-2.5 min-w-0">
          {menu.tenant.logoUrl ? (
            <img src={menu.tenant.logoUrl} alt={menu.tenant.name} className="w-9 h-9 rounded-xl object-cover shrink-0" />
          ) : (
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 sf-btn-accent"><UtensilsCrossed className="w-4 h-4" /></div>
          )}
          <div className="min-w-0">
            <div className="text-sm font-bold truncate">{menu.tenant.name}</div>
            <div className="text-[11px]" style={{ color: "var(--sf-text-muted)" }}>Table {number}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={toggleTheme} className="w-9 h-9 rounded-full flex items-center justify-center sf-input" aria-label="Toggle theme">
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button onClick={openCart} className="relative w-9 h-9 rounded-full flex items-center justify-center sf-input">
            <ShoppingCart className="w-4 h-4" />
            {cart.length > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center sf-btn-accent">{cart.length}</span>}
          </button>
        </div>
      </header>

      <div className="flex items-center gap-2 px-4 pt-3">
        <label className="flex-1 flex items-center gap-2 h-10 px-3 rounded-xl sf-input">
          <Search className="w-4 h-4 shrink-0" style={{ color: "var(--sf-text-muted)" }} />
          <input data-testid="sf-search" type="search" placeholder="Search the menu" value={query} onChange={(e) => setQuery(e.target.value)}
            className="flex-1 min-w-0 bg-transparent outline-none text-sm" />
        </label>
        {hasVegMarks && (
          <button data-testid="sf-veg-only" onClick={() => setVegOnly((v) => !v)} aria-pressed={vegOnly}
            className="shrink-0 h-10 px-3 rounded-xl flex items-center gap-1.5 text-xs font-semibold sf-input"
            style={vegOnly ? { borderColor: "#16a34a", color: "#16a34a" } : undefined}>
            <FoodMark type="veg" size={12} /> Veg only
          </button>
        )}
      </div>

      <div className="flex gap-1.5 overflow-x-auto sf-scroll px-4 py-3" style={query.trim() ? { opacity: 0.5 } : undefined}>
        {menu.categories.map((c) => (
          <button key={c.id} onClick={() => { setActiveCat(c.id); setQuery(""); }}
            className="shrink-0 px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap sf-input"
            style={activeCat === c.id ? { background: "var(--sf-accent)", color: "var(--sf-accent-text)", borderColor: "var(--sf-accent)" } : undefined}>
            {c.name}
          </button>
        ))}
      </div>

      {items.length === 0 && (
        <p className="text-sm text-center px-4 py-10" style={{ color: "var(--sf-text-muted)" }} data-testid="sf-no-results">
          {query.trim() ? `Nothing on the menu matches "${query.trim()}".` : "No dishes here."}
        </p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5 px-4">
        {items.map((item) => {
          const priceLabel = item.isPizza ? `₹${item.sizes.sm.toFixed(0)} – ₹${item.sizes.lg.toFixed(0)}`
            : (Array.isArray(item.variants) && item.variants.length ? `From ₹${Math.min(...item.variants.map((v) => v.price)).toFixed(0)}` : `₹${(item.price || 0).toFixed(0)}`);
          return (
            <button key={item.id} data-testid={`sf-item-${item.id}`} onClick={() => handleItemClick(item)}
              className="rounded-2xl text-left flex flex-col overflow-hidden sf-card" style={{ opacity: item.available ? 1 : 0.5 }} disabled={!item.available}>
              {item.imageUrl ? (
                <img src={item.imageUrl} alt={item.name} className="w-full aspect-square object-cover sf-item-img" loading="lazy" />
              ) : (
                <div className="w-full aspect-square flex items-center justify-center sf-item-img">
                  <UtensilsCrossed className="w-7 h-7" style={{ color: "var(--sf-text-muted)" }} />
                </div>
              )}
              <div className="p-2.5 flex flex-col gap-1 flex-1">
                <div className="font-semibold text-sm leading-snug flex items-start gap-1.5">
                  {item.foodType && <span className="mt-0.5"><FoodMark type={item.foodType} size={12} /></span>}
                  <span>{item.name}</span>
                </div>
                {item.desc && <div className="text-[11px] leading-snug line-clamp-2" style={{ color: "var(--sf-text-muted)" }}>{item.desc}</div>}
                <div className="text-sm font-bold mt-auto pt-1" style={{ color: "var(--sf-accent)" }}>
                  {item.available ? priceLabel : "Sold out"}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {cart.length > 0 && !cartOpen && (
        <button onClick={openCart} data-testid="sf-view-cart"
          className="fixed bottom-4 inset-x-4 h-14 rounded-2xl font-bold flex items-center justify-between px-5 sf-btn-accent" style={{ boxShadow: "var(--sf-shadow)" }}>
          <span>{cart.length} item{cart.length > 1 ? "s" : ""}</span>
          <span>₹{total.toFixed(2)} · View cart</span>
        </button>
      )}

      {cartOpen && (
        <div className="fixed inset-0 z-20 flex items-end sm:items-center sm:justify-center" style={{ background: "var(--sf-overlay)" }} onClick={() => setCartOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className={`sf ${theme === "dark" ? "sf-dark" : ""} w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl p-5 max-h-[88vh] overflow-y-auto sf-card`} style={{ borderBottom: "none" }}>

            {sheetStep === STEP.CART && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div className="text-lg font-bold">Your order</div>
                  <button onClick={() => setCartOpen(false)}><X className="w-5 h-5" style={{ color: "var(--sf-text-muted)" }} /></button>
                </div>
                {cart.length === 0 ? (
                  <p className="text-sm text-center py-8" style={{ color: "var(--sf-text-muted)" }}>Your cart is empty.</p>
                ) : (
                  <div className="space-y-3 mb-4">
                    {cart.map((l) => (
                      <div key={l.lineId} className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm truncate">{l.displayName}</div>
                          {l.mods?.length > 0 && <div className="text-[11px]" style={{ color: "var(--sf-text-muted)" }}>{l.mods.join(" · ")}</div>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button onClick={() => updateQty(l.lineId, -1)} className="w-7 h-7 rounded-full flex items-center justify-center sf-input"><Minus className="w-3 h-3" /></button>
                          <span className="text-sm w-4 text-center">{l.qty}</span>
                          <button onClick={() => updateQty(l.lineId, 1)} className="w-7 h-7 rounded-full flex items-center justify-center sf-input"><Plus className="w-3 h-3" /></button>
                          <button onClick={() => removeLine(l.lineId)} className="w-7 h-7 rounded-full flex items-center justify-center sf-input"><X className="w-3 h-3" style={{ color: "var(--sf-danger)" }} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <input placeholder="Your name (optional)" value={name} onChange={(e) => setName(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl text-sm mb-3 sf-input" />
                {gst.taxTotal > 0 && (
                  <div className="flex items-center justify-between text-xs mb-1" style={{ color: "var(--sf-text-muted)" }}>
                    <span>GST (CGST ₹{gst.cgst.toFixed(2)} + SGST ₹{gst.sgst.toFixed(2)})</span><span>₹{gst.taxTotal.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-base font-bold mb-4">
                  <span>Total</span><span>₹{total.toFixed(2)}</span>
                </div>
                <button data-testid="sf-checkout-btn" onClick={goToPayment} disabled={cart.length === 0}
                  className="w-full h-12 rounded-full font-bold flex items-center justify-center gap-2 disabled:opacity-50 sf-btn-accent">
                  Checkout
                </button>
              </>
            )}

            {sheetStep === STEP.PAYMENT && (
              <div data-testid="table-payment-step">
                <button onClick={() => setSheetStep(STEP.CART)} className="flex items-center gap-1 text-xs mb-3" style={{ color: "var(--sf-text-muted)" }}>
                  <ChevronLeft className="w-3.5 h-3.5" /> Back to cart
                </button>
                <div className="text-lg font-bold mb-1">How would you like to pay?</div>
                <div className="text-sm mb-4" style={{ color: "var(--sf-text-muted)" }}>Total <b>₹{total.toFixed(2)}</b></div>
                <div className="space-y-2.5">
                  {menu.tenant.onlinePayments !== false && (
                    <button data-testid="table-pay-online" onClick={() => finalizeOrder(true)}
                      className="w-full h-14 rounded-2xl font-bold flex items-center gap-3 px-4 sf-input">
                      <CreditCard className="w-5 h-5" style={{ color: "var(--sf-accent)" }} />
                      <span className="text-left flex-1">Pay online now<span className="block text-[11px] font-normal" style={{ color: "var(--sf-text-muted)" }}>UPI, cards and wallets</span></span>
                    </button>
                  )}
                  <button data-testid="table-pay-later" onClick={() => finalizeOrder(false)}
                    className="w-full h-14 rounded-2xl font-bold flex items-center gap-3 px-4 sf-input">
                    <Wallet className="w-5 h-5" style={{ color: "var(--sf-accent)" }} />
                    <span className="text-left flex-1">Pay at the table<span className="block text-[11px] font-normal" style={{ color: "var(--sf-text-muted)" }}>Settle up when you're ready</span></span>
                  </button>
                </div>
              </div>
            )}

            {sheetStep === STEP.PLACING && (
              <div className="py-16 flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--sf-accent)" }} />
                <div className="text-sm" style={{ color: "var(--sf-text-muted)" }}>{placing ? "Placing your order…" : "One moment…"}</div>
              </div>
            )}
          </div>
        </div>
      )}

      <StorefrontItemModal item={modalItem} items={menu.items} onClose={() => setModalItem(null)} onAdd={addFromModal} />
    </div>
  );
}
