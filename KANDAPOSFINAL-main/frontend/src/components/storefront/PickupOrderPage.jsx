import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { storefrontApi } from "../../api/storefrontClient";
import { useStorefrontTheme } from "./useStorefrontTheme";
import StorefrontItemModal from "./StorefrontItemModal";
import "./storefront.css";
import {
  UtensilsCrossed, Minus, Plus, X, ShoppingCart, CheckCircle2, Loader2, ShieldCheck,
  Sun, Moon, User, ChevronLeft, Wallet, CreditCard, Clock,
} from "lucide-react";

const STEP = { IDENTIFY: "identify", OTP: "otp", MENU: "menu", DONE: "done" };
const SHEET = { CART: "cart", PAYMENT: "payment", PLACING: "placing" };

async function runOnlinePayment({ slug, orderId, amount, customerName }) {
  if (typeof window.Razorpay !== "function") {
    return { ok: false, reason: "Online payment isn't available for this store — your order is saved, pay on collection." };
  }
  let rzpOrder;
  try {
    rzpOrder = await storefrontApi.createPaymentOrder(slug, orderId, amount);
  } catch (e) {
    return { ok: false, reason: e?.response?.data?.detail || "Online payment isn't available for this store — your order is saved, pay on collection." };
  }
  return new Promise((resolve) => {
    const rzp = new window.Razorpay({
      key: rzpOrder.razorpayKeyId, amount: rzpOrder.amount, currency: rzpOrder.currency,
      order_id: rzpOrder.razorpayOrderId, name: "Order payment", description: `Order`,
      prefill: { name: customerName || "" }, theme: { color: "#d9480f" },
      modal: { ondismiss: () => resolve({ ok: false, reason: "Payment cancelled — your order is saved, pay on collection." }) },
      handler: async (resp) => {
        try {
          const result = await storefrontApi.verifyPayment(slug, {
            order_id: orderId, razorpay_order_id: resp.razorpay_order_id,
            razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature,
          });
          resolve({ ok: true, order: result.order });
        } catch (e) {
          resolve({ ok: false, reason: e?.response?.data?.detail || "Payment verification failed — your order is saved, pay on collection." });
        }
      },
    });
    rzp.open();
  });
}

export default function PickupOrderPage() {
  const { slug } = useParams();
  const [theme, toggleTheme] = useStorefrontTheme();
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState(STEP.IDENTIFY);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [otpError, setOtpError] = useState("");

  const [activeCat, setActiveCat] = useState(null);
  const [cart, setCart] = useState([]);
  const [modalItem, setModalItem] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [sheetStep, setSheetStep] = useState(SHEET.CART);
  const [placing, setPlacing] = useState(false);
  const [confirmed, setConfirmed] = useState(null);

  const [accountOpen, setAccountOpen] = useState(false);
  const [account, setAccount] = useState(null);

  useEffect(() => {
    storefrontApi.menu(slug).then((m) => { setMenu(m); if (m.categories.length) setActiveCat(m.categories[0].id); })
      .catch((e) => setError(e?.response?.data?.detail || "This link isn't valid."));
  }, [slug]);

  const items = useMemo(() => (menu?.items || []).filter((m) => m.catId === activeCat), [menu, activeCat]);
  const total = useMemo(() => cart.reduce((s, l) => s + l.displayPrice * l.qty, 0), [cart]);

  const requestOtp = async () => {
    if (!name.trim() || phone.trim().length < 8) { setOtpError("Enter your name and phone number"); return; }
    setBusy(true); setOtpError("");
    try {
      const r = await storefrontApi.requestOtp(slug, name.trim(), phone.trim());
      setDevCode(r.dev_code || "");
      setStep(STEP.OTP);
    } catch (e) {
      setOtpError(e?.response?.data?.detail || "Could not send code");
    } finally { setBusy(false); }
  };

  const verifyOtp = async () => {
    if (code.trim().length !== 6) { setOtpError("Enter the 6-digit code"); return; }
    setBusy(true); setOtpError("");
    try {
      const r = await storefrontApi.verifyOtp(slug, phone.trim(), code.trim());
      setSessionToken(r.token);
      setStep(STEP.MENU);
    } catch (e) {
      setOtpError(e?.response?.data?.detail || "Incorrect code");
    } finally { setBusy(false); }
  };

  const handleItemClick = (item) => {
    if (!item.available) return;
    if (item.isPizza || item.catId === "deals" || (Array.isArray(item.variants) && item.variants.length)) { setModalItem(item); return; }
    setCart((prev) => [...prev, { lineId: `l_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, item_id: item.id, qty: 1, size: null, mods: [], displayName: item.name, displayPrice: item.price }]);
  };
  const addFromModal = (line) => setCart((prev) => [...prev, { ...line, lineId: `l_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }]);
  const updateQty = (lineId, delta) => setCart((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, qty: Math.max(1, l.qty + delta) } : l)));
  const removeLine = (lineId) => setCart((prev) => prev.filter((l) => l.lineId !== lineId));

  const openCart = () => { setSheetStep(SHEET.CART); setCartOpen(true); };
  const goToPayment = () => { if (cart.length) setSheetStep(SHEET.PAYMENT); };

  const openAccount = async () => {
    setAccountOpen(true);
    try { setAccount(await storefrontApi.me(slug, sessionToken)); } catch { /* ignore */ }
  };

  const finalizeOrder = async (payOnline) => {
    setPlacing(true); setSheetStep(SHEET.PLACING);
    try {
      const res = await storefrontApi.placePickupOrder(slug, sessionToken, {
        items: cart.map((l) => ({ item_id: l.item_id, qty: l.qty, size: l.size, variant: l.variant, mods: l.mods })),
      });
      let paid = false;
      if (payOnline) {
        const result = await runOnlinePayment({ slug, orderId: res.orderId, amount: res.total, customerName: name });
        if (result.ok) paid = true; else toast.info(result.reason);
      }
      setConfirmed({ ...res, paid });
      setCart([]);
      setCartOpen(false);
      setStep(STEP.DONE);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not place your order — please try again.");
      setSheetStep(SHEET.PAYMENT);
    } finally { setPlacing(false); }
  };

  const themeClass = `sf ${theme === "dark" ? "sf-dark" : ""}`;
  const ThemeToggleBtn = (
    <button onClick={toggleTheme} className="w-9 h-9 rounded-full flex items-center justify-center sf-input" aria-label="Toggle theme">
      {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );

  if (error && step !== STEP.DONE) {
    return (
      <div className={themeClass} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div className="text-center max-w-sm">
          <p className="font-semibold mb-1">Something went wrong</p>
          <p className="text-sm" style={{ color: "var(--sf-text-muted)" }}>{error}</p>
        </div>
      </div>
    );
  }

  if (step === STEP.DONE && confirmed) {
    return (
      <div className={themeClass} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div className="text-center max-w-sm" data-testid="pickup-order-confirmed">
          <CheckCircle2 className="w-14 h-14 mx-auto mb-4" style={{ color: "var(--sf-success)" }} />
          <div className="text-2xl font-bold mb-1">Order placed!</div>
          <div className="text-sm mb-1" style={{ color: "var(--sf-text-muted)" }}>Order #{confirmed.orderNumber} · ₹{confirmed.total.toFixed(2)}</div>
          <div className="text-xs mb-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: confirmed.paid ? "var(--sf-success-bg)" : "var(--sf-bg-sunken)", color: confirmed.paid ? "var(--sf-success)" : "var(--sf-text-muted)" }}>
            {confirmed.paid ? <><CheckCircle2 className="w-3.5 h-3.5" /> Paid online</> : <><Clock className="w-3.5 h-3.5" /> Pay on collection</>}
          </div>
          <p className="text-xs" style={{ color: "var(--sf-text-muted)" }}>We'll have it ready shortly — show your name at the counter.</p>
        </div>
      </div>
    );
  }

  if (step === STEP.IDENTIFY || step === STEP.OTP) {
    return (
      <div className={themeClass} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div className="absolute top-4 right-4">{ThemeToggleBtn}</div>
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3 sf-btn-accent"><UtensilsCrossed className="w-6 h-6" /></div>
            <div className="text-xl font-bold">{menu?.tenant?.name || "Pickup order"}</div>
            <div className="text-xs mt-1" style={{ color: "var(--sf-text-muted)" }}>Order ahead for collection</div>
          </div>

          {step === STEP.IDENTIFY ? (
            <div className="space-y-3" data-testid="pickup-identify-step">
              <input data-testid="pickup-name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} className="w-full h-11 px-3.5 rounded-xl text-sm sf-input" />
              <input data-testid="pickup-phone" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full h-11 px-3.5 rounded-xl text-sm sf-input" />
              {otpError && <p className="text-xs" style={{ color: "var(--sf-danger)" }}>{otpError}</p>}
              <button data-testid="pickup-send-otp" onClick={requestOtp} disabled={busy}
                className="w-full h-11 rounded-full font-bold flex items-center justify-center gap-2 disabled:opacity-50 sf-btn-accent">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send verification code"}
              </button>
            </div>
          ) : (
            <div className="space-y-3" data-testid="pickup-otp-step">
              <div className="flex items-center gap-2 text-xs mb-1" style={{ color: "var(--sf-text-muted)" }}>
                <ShieldCheck className="w-3.5 h-3.5" /> Code sent to {phone}
              </div>
              {devCode && (
                <div className="text-xs rounded-lg px-3 py-2" style={{ background: "var(--sf-bg-sunken)", color: "var(--sf-accent)" }}>
                  No SMS provider configured — your code is <b>{devCode}</b>
                </div>
              )}
              <input data-testid="pickup-otp-code" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="w-full h-11 px-3 rounded-xl text-sm text-center tracking-[0.5em] font-bold sf-input" />
              {otpError && <p className="text-xs" style={{ color: "var(--sf-danger)" }}>{otpError}</p>}
              <button data-testid="pickup-verify-otp" onClick={verifyOtp} disabled={busy}
                className="w-full h-11 rounded-full font-bold flex items-center justify-center gap-2 disabled:opacity-50 sf-btn-accent">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify"}
              </button>
              <button onClick={() => setStep(STEP.IDENTIFY)} className="w-full text-xs" style={{ color: "var(--sf-text-muted)" }}>Change phone number</button>
            </div>
          )}
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

  return (
    <div className={themeClass} style={{ paddingBottom: 112 }} data-testid="pickup-order-page">
      <header className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between sf-card" style={{ backdropFilter: "blur(10px)", borderLeft: "none", borderRight: "none", borderTop: "none" }}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 sf-btn-accent"><UtensilsCrossed className="w-4 h-4" /></div>
          <div className="min-w-0">
            <div className="text-sm font-bold truncate">{menu.tenant.name}</div>
            <div className="text-[11px]" style={{ color: "var(--sf-text-muted)" }}>Pickup · {name}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {ThemeToggleBtn}
          <button onClick={openAccount} data-testid="sf-account-btn" className="w-9 h-9 rounded-full flex items-center justify-center sf-input"><User className="w-4 h-4" /></button>
          <button onClick={openCart} className="relative w-9 h-9 rounded-full flex items-center justify-center sf-input">
            <ShoppingCart className="w-4 h-4" />
            {cart.length > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center sf-btn-accent">{cart.length}</span>}
          </button>
        </div>
      </header>

      <div className="flex gap-1.5 overflow-x-auto sf-scroll px-4 py-3">
        {menu.categories.map((c) => (
          <button key={c.id} onClick={() => setActiveCat(c.id)}
            className="shrink-0 px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap sf-input"
            style={activeCat === c.id ? { background: "var(--sf-accent)", color: "var(--sf-accent-text)", borderColor: "var(--sf-accent)" } : undefined}>
            {c.name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5 px-4">
        {items.map((item) => {
          const priceLabel = item.isPizza ? `₹${item.sizes.sm.toFixed(0)} – ₹${item.sizes.lg.toFixed(0)}`
            : (Array.isArray(item.variants) && item.variants.length ? `From ₹${Math.min(...item.variants.map((v) => v.price)).toFixed(0)}` : `₹${(item.price || 0).toFixed(0)}`);
          return (
            <button key={item.id} data-testid={`sf-item-${item.id}`} onClick={() => handleItemClick(item)}
              className="rounded-2xl text-left flex flex-col overflow-hidden sf-card" style={{ opacity: item.available ? 1 : 0.5 }} disabled={!item.available}>
              {item.imageUrl ? (
                <img src={item.imageUrl} alt="" className="w-full aspect-square object-cover sf-item-img" loading="lazy" />
              ) : (
                <div className="w-full aspect-square flex items-center justify-center sf-item-img">
                  <UtensilsCrossed className="w-7 h-7" style={{ color: "var(--sf-text-muted)" }} />
                </div>
              )}
              <div className="p-2.5 flex flex-col gap-1 flex-1">
                <div className="font-semibold text-sm leading-snug">{item.name}</div>
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

            {sheetStep === SHEET.CART && (
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
                <div className="flex items-center justify-between text-base font-bold mb-4">
                  <span>Total</span><span>₹{total.toFixed(2)}</span>
                </div>
                <button data-testid="sf-checkout-btn" onClick={goToPayment} disabled={cart.length === 0}
                  className="w-full h-12 rounded-full font-bold flex items-center justify-center gap-2 disabled:opacity-50 sf-btn-accent">
                  Checkout
                </button>
              </>
            )}

            {sheetStep === SHEET.PAYMENT && (
              <div data-testid="pickup-payment-step">
                <button onClick={() => setSheetStep(SHEET.CART)} className="flex items-center gap-1 text-xs mb-3" style={{ color: "var(--sf-text-muted)" }}>
                  <ChevronLeft className="w-3.5 h-3.5" /> Back to cart
                </button>
                <div className="text-lg font-bold mb-1">How would you like to pay?</div>
                <div className="text-sm mb-4" style={{ color: "var(--sf-text-muted)" }}>Total <b>₹{total.toFixed(2)}</b></div>
                <div className="space-y-2.5">
                  {menu.tenant.onlinePayments !== false && (
                    <button data-testid="pickup-pay-online" onClick={() => finalizeOrder(true)} className="w-full h-14 rounded-2xl font-bold flex items-center gap-3 px-4 sf-input">
                      <CreditCard className="w-5 h-5" style={{ color: "var(--sf-accent)" }} />
                      <span className="text-left flex-1">Pay online now</span>
                    </button>
                  )}
                  <button data-testid="pickup-pay-later" onClick={() => finalizeOrder(false)} className="w-full h-14 rounded-2xl font-bold flex items-center gap-3 px-4 sf-input">
                    <Wallet className="w-5 h-5" style={{ color: "var(--sf-accent)" }} />
                    <span className="text-left flex-1">Pay on collection<span className="block text-[11px] font-normal" style={{ color: "var(--sf-text-muted)" }}>Settle up at the counter</span></span>
                  </button>
                </div>
              </div>
            )}

            {sheetStep === SHEET.PLACING && (
              <div className="py-16 flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--sf-accent)" }} />
                <div className="text-sm" style={{ color: "var(--sf-text-muted)" }}>{placing ? "Placing your order…" : "One moment…"}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {accountOpen && (
        <div className="fixed inset-0 z-20 flex items-end sm:items-center sm:justify-center" style={{ background: "var(--sf-overlay)" }} onClick={() => setAccountOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className={`sf ${theme === "dark" ? "sf-dark" : ""} w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto sf-card`} data-testid="pickup-account-sheet">
            <div className="flex items-center justify-between mb-4">
              <div className="text-lg font-bold">Account</div>
              <button onClick={() => setAccountOpen(false)}><X className="w-5 h-5" style={{ color: "var(--sf-text-muted)" }} /></button>
            </div>
            <div className="text-sm mb-1">{name}</div>
            <div className="text-xs mb-4" style={{ color: "var(--sf-text-muted)" }}>{phone}</div>
            <div className="text-xs uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--sf-text-muted)" }}>Recent orders</div>
            {!account ? (
              <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--sf-accent)" }} /></div>
            ) : account.orders.length === 0 ? (
              <p className="text-sm py-4" style={{ color: "var(--sf-text-muted)" }}>No previous orders yet.</p>
            ) : (
              <div className="space-y-2">
                {account.orders.map((o) => (
                  <div key={o.id} className="rounded-xl p-3 sf-input">
                    <div className="flex items-center justify-between text-sm font-semibold">
                      <span>#{o.number}</span><span>₹{o.total.toFixed(2)}</span>
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: "var(--sf-text-muted)" }}>{o.type} · {o.status}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <StorefrontItemModal item={modalItem} items={menu.items} onClose={() => setModalItem(null)} onAdd={addFromModal} />
    </div>
  );
}
