import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { storefrontApi } from "../../api/storefrontClient";
import StorefrontItemModal from "./StorefrontItemModal";
import { Pizza, Minus, Plus, X, ShoppingCart, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";

const STEP = { IDENTIFY: "identify", OTP: "otp", MENU: "menu", DONE: "done" };

export default function PickupOrderPage() {
  const { slug } = useParams();
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
  const [confirmed, setConfirmed] = useState(null);

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
    if (item.isPizza || item.catId === "deals") { setModalItem(item); return; }
    setCart((prev) => [...prev, { lineId: `l_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, item_id: item.id, qty: 1, size: null, mods: [], displayName: item.name, displayPrice: item.price }]);
  };
  const addFromModal = (line) => setCart((prev) => [...prev, { ...line, lineId: `l_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }]);
  const updateQty = (lineId, delta) => setCart((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, qty: Math.max(1, l.qty + delta) } : l)));
  const removeLine = (lineId) => setCart((prev) => prev.filter((l) => l.lineId !== lineId));

  const placeOrder = async () => {
    if (cart.length === 0) return;
    setBusy(true);
    try {
      const res = await storefrontApi.placePickupOrder(slug, sessionToken, {
        items: cart.map((l) => ({ item_id: l.item_id, qty: l.qty, size: l.size, mods: l.mods })),
      });
      setConfirmed(res);
      setCart([]);
      setStep(STEP.DONE);
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not place your order — please try again.");
    } finally { setBusy(false); }
  };

  if (error && step !== STEP.DONE) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--pos-bg)" }}>
        <div className="text-center max-w-sm">
          <p className="text-white font-semibold mb-1">Something went wrong</p>
          <p className="text-sm" style={{ color: "var(--pos-muted)" }}>{error}</p>
        </div>
      </div>
    );
  }

  if (step === STEP.DONE && confirmed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--pos-bg)" }}>
        <div className="text-center max-w-sm" data-testid="pickup-order-confirmed">
          <CheckCircle2 className="w-14 h-14 mx-auto mb-4" style={{ color: "#22c55e" }} />
          <div className="text-2xl font-bold text-white mb-1">Order placed!</div>
          <div className="text-sm mb-4" style={{ color: "var(--pos-muted)" }}>Order #{confirmed.orderNumber} · ₹{confirmed.total.toFixed(2)}</div>
          <p className="text-xs" style={{ color: "var(--pos-muted)" }}>We'll have it ready shortly — pay when you collect. Show your name at the counter.</p>
        </div>
      </div>
    );
  }

  if (step === STEP.IDENTIFY || step === STEP.OTP) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--pos-bg)" }}>
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: "var(--pos-accent)" }}><Pizza className="w-6 h-6 text-white" /></div>
            <div className="text-xl font-bold text-white">{menu?.tenant?.name || "Pickup order"}</div>
            <div className="text-xs mt-1" style={{ color: "var(--pos-muted)" }}>Order ahead for collection</div>
          </div>

          {step === STEP.IDENTIFY ? (
            <div className="space-y-3" data-testid="pickup-identify-step">
              <input data-testid="pickup-name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)}
                className="w-full h-11 px-3 rounded-lg text-sm text-white" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} />
              <input data-testid="pickup-phone" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)}
                className="w-full h-11 px-3 rounded-lg text-sm text-white" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} />
              {otpError && <p className="text-xs" style={{ color: "#f87171" }}>{otpError}</p>}
              <button data-testid="pickup-send-otp" onClick={requestOtp} disabled={busy}
                className="w-full h-11 rounded-lg font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50" style={{ background: "var(--pos-accent)" }}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send verification code"}
              </button>
            </div>
          ) : (
            <div className="space-y-3" data-testid="pickup-otp-step">
              <div className="flex items-center gap-2 text-xs mb-1" style={{ color: "var(--pos-muted)" }}>
                <ShieldCheck className="w-3.5 h-3.5" /> Code sent to {phone}
              </div>
              {devCode && (
                <div className="text-xs rounded-lg px-3 py-2" style={{ background: "rgba(249,115,22,0.12)", color: "var(--pos-accent)" }}>
                  No SMS provider configured — your code is <b>{devCode}</b>
                </div>
              )}
              <input data-testid="pickup-otp-code" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="w-full h-11 px-3 rounded-lg text-sm text-white text-center tracking-[0.5em] font-bold" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} />
              {otpError && <p className="text-xs" style={{ color: "#f87171" }}>{otpError}</p>}
              <button data-testid="pickup-verify-otp" onClick={verifyOtp} disabled={busy}
                className="w-full h-11 rounded-lg font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50" style={{ background: "var(--pos-accent)" }}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify"}
              </button>
              <button onClick={() => setStep(STEP.IDENTIFY)} className="w-full text-xs" style={{ color: "var(--pos-muted)" }}>Change phone number</button>
            </div>
          )}
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
    <div className="min-h-screen pb-28" style={{ background: "var(--pos-bg)" }} data-testid="pickup-order-page">
      <header className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between" style={{ background: "rgba(11,18,32,0.9)", backdropFilter: "blur(8px)", borderBottom: "1px solid var(--pos-border)" }}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-accent)" }}><Pizza className="w-4 h-4 text-white" /></div>
          <div>
            <div className="text-sm font-bold text-white">{menu.tenant.name}</div>
            <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>Pickup · {name}</div>
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
            <div className="flex items-center justify-between text-base font-bold text-white mb-4">
              <span>Total</span><span>₹{total.toFixed(2)}</span>
            </div>
            <button data-testid="sf-place-order" onClick={placeOrder} disabled={cart.length === 0 || busy}
              className="w-full h-12 rounded-xl font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ background: "var(--pos-accent)" }}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Place Order — pay on collection"}
            </button>
          </div>
        </div>
      )}

      <StorefrontItemModal item={modalItem} items={menu.items} onClose={() => setModalItem(null)} onAdd={addFromModal} />
    </div>
  );
}
