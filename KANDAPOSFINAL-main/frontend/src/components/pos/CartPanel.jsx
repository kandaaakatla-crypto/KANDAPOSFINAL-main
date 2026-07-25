import React, { useState } from "react";
import { Minus, Plus, Trash2, Percent, Send, CreditCard, Bike, ShoppingBag, UtensilsCrossed, Tag, Gift, Mail, Coins, X } from "lucide-react";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { couponsApi, loyaltyApi } from "../../api/client";
import { toast } from "sonner";

const TYPE_ICON = { delivery: Bike, collection: ShoppingBag, "dine-in": UtensilsCrossed };

const TIP_PRESETS = [0, 5, 10, 15];

export default function CartPanel({
  cart, orderType, customer, subtotal, deliveryFee, discount, discountAmt, total: providedTotal,
  onQty, onRemove, onDiscount, onClear, onSend, onPay,
  // new
  tipPct, onTipPct, coupon, onCoupon, customerEmail, onCustomerEmail,
  sendReceipt, onSendReceiptToggle,
  loyaltyBalance, redeemPoints, onRedeemPoints,
  // editing an existing (unpaid) order — occupied table / running tab
  runningBill = null,
  // mobile: cart renders as a full-screen sheet, gated by open/onClose.
  // Desktop (md+) ignores these and stays a permanent sidebar.
  open = false, onClose,
}) {
  const TypeIcon = TYPE_ICON[orderType];

  const tipAmt = +(subtotal * (tipPct || 0) / 100).toFixed(2);
  const couponDiscount = coupon?.discount || 0;
  const loyaltyDiscount = Math.min(redeemPoints || 0, subtotal);
  // Total: subtotal − %-discount − coupon − loyalty + delivery + tip (+ running bill from earlier rounds)
  const newRoundTotal = +Math.max(0, subtotal - discountAmt - couponDiscount - loyaltyDiscount + deliveryFee + tipAmt).toFixed(2);
  const total = +(newRoundTotal + (runningBill?.total || 0)).toFixed(2);

  const applyCoupon = async (code) => {
    if (!code) { onCoupon(null); return; }
    try {
      const res = await couponsApi.apply(code, subtotal);
      onCoupon({ code: res.code, kind: res.kind, value: res.value, discount: res.discount });
      toast.success(`Coupon ${res.code} applied — ₹${res.discount.toFixed(2)} off`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Invalid coupon");
      onCoupon(null);
    }
  };

  return (
    <div
      className={`${open ? "fixed inset-0 z-50 flex" : "hidden"} md:static md:z-auto md:flex md:w-[340px] md:shrink-0 flex-col h-full`}
      style={{ background: "var(--pos-panel)", borderLeft: "1px solid var(--pos-border)" }}
      data-testid="cart-panel"
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between shrink-0" style={{ borderBottom: "1px solid var(--pos-border)" }}>
        <div className="flex items-center gap-2">
          <button data-testid="cart-close-btn" onClick={onClose} className="pos-btn -ml-2 w-11 h-11 flex items-center justify-center rounded-lg md:hidden">
            <X className="w-5 h-5 text-white" />
          </button>
          <TypeIcon className="w-4 h-4" style={{ color: "var(--pos-accent)" }} />
          <span className="font-bold text-white text-sm capitalize">{orderType} Order</span>
        </div>
        {cart.length > 0 && (
          <button data-testid="clear-cart-btn" onClick={onClear} className="pos-btn text-xs flex items-center gap-1 px-2 py-1 rounded" style={{ color: "#f87171" }}>
            <Trash2 className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>
      {customer?.name && (
        <div className="px-4 py-2 text-xs truncate flex items-center justify-between" style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)", borderBottom: "1px solid var(--pos-border)" }} data-testid="cart-customer">
          <span className="truncate">{customer.name}{customer.address ? ` · ${customer.address}` : ""}</span>
          {loyaltyBalance != null && loyaltyBalance > 0 && (
            <span className="ml-2 flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#1c2438", color: "#fcd34d" }}>
              <Coins className="w-3 h-3" /> {loyaltyBalance} pts
            </span>
          )}
        </div>
      )}

      {/* Lines */}
      <div className="flex-1 overflow-y-auto pos-scroll px-3 py-2" data-testid="cart-lines">
        {runningBill && runningBill.items?.length > 0 && (
          <div className="rounded-lg p-2.5 mb-3" style={{ background: "#1a2235", border: "1px dashed #3f5170" }} data-testid="running-bill-items">
            <div className="text-[10px] uppercase tracking-wider mb-1.5 flex items-center justify-between" style={{ color: "#7ea3d1" }}>
              <span>Already sent to kitchen · #{runningBill.number}</span>
              <span className="tabular-nums font-bold">₹{runningBill.total.toFixed(2)}</span>
            </div>
            <div className="space-y-0.5">
              {runningBill.items.map((it, i) => (
                <div key={`sent-${i}`} className="flex justify-between text-[11px]" style={{ color: "#c7d4e6" }}>
                  <span>{it.qty}× {it.name}</span>
                  <span className="tabular-nums">₹{(it.price * it.qty).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {cart.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mb-3" style={{ background: "var(--pos-panel-2)" }}>
              <CreditCard className="w-6 h-6" style={{ color: "var(--pos-muted)" }} />
            </div>
            <p className="text-sm" style={{ color: "var(--pos-muted)" }}>
              {runningBill ? <>No new items yet.<br />Tap menu to add, or hit Pay to settle.</> : <>No items yet.<br />Tap menu items to build the order.</>}
            </p>
          </div>
        ) : (
          cart.map((l) => (
            <div key={l.lineId} className="rounded-lg p-2.5 mb-2 fade-in" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} data-testid="cart-line">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white leading-snug">{l.name}</div>
                  {l.mods?.length > 0 && (
                    <div className="text-[11px] mt-0.5 leading-snug" style={{ color: "var(--pos-muted)" }}>{l.mods.join(" · ")}</div>
                  )}
                </div>
                <div className="text-sm font-bold text-white shrink-0">₹{(l.price * l.qty).toFixed(2)}</div>
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-2">
                  <button data-testid="line-qty-minus" onClick={() => onQty(l.lineId, -1)} className="pos-btn w-7 h-7 rounded flex items-center justify-center" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
                    <Minus className="w-3 h-3 text-white" />
                  </button>
                  <span className="text-sm font-bold text-white w-5 text-center">{l.qty}</span>
                  <button data-testid="line-qty-plus" onClick={() => onQty(l.lineId, 1)} className="pos-btn w-7 h-7 rounded flex items-center justify-center" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
                    <Plus className="w-3 h-3 text-white" />
                  </button>
                </div>
                <button data-testid="line-remove" onClick={() => onRemove(l.lineId)} className="pos-btn p-1.5 rounded" style={{ color: "#f87171" }}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Tip + coupon + email + loyalty */}
      {cart.length > 0 && (
        <div className="px-3 py-1.5 space-y-1" style={{ borderTop: "1px solid var(--pos-border)" }}>
          {/* Tip */}
          <div className="flex items-center gap-2 text-[11px]">
            <span className="flex items-center gap-1" style={{ color: "var(--pos-muted)" }}><Gift className="w-3 h-3" /> Tip</span>
            <div className="flex gap-1 flex-1">
              {TIP_PRESETS.map((p) => (
                <button key={p} data-testid={`tip-${p}`} onClick={() => onTipPct(p)}
                  className="pos-btn flex-1 h-6 rounded text-[10px] font-bold"
                  style={{ background: tipPct === p ? "var(--pos-accent)" : "var(--pos-panel-2)", color: tipPct === p ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                  {p === 0 ? "None" : `${p}%`}
                </button>
              ))}
            </div>
            <span className="text-white tabular-nums w-12 text-right">₹{tipAmt.toFixed(2)}</span>
          </div>

          {/* Coupon */}
          <div className="flex items-center gap-2">
            <Tag className="w-3 h-3" style={{ color: coupon ? "#86efac" : "var(--pos-muted)" }} />
            <Input data-testid="coupon-input" placeholder="Coupon code"
              defaultValue={coupon?.code || ""}
              onBlur={(e) => applyCoupon(e.target.value.trim().toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyCoupon(e.target.value.trim().toUpperCase()); } }}
              className="h-7 text-xs text-white tracking-wider" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
            {coupon && (
              <button data-testid="coupon-clear" onClick={() => onCoupon(null)} className="pos-btn text-[10px] px-1" style={{ color: "#fca5a5" }}>×</button>
            )}
          </div>

          {/* Loyalty redeem */}
          {loyaltyBalance > 0 && (
            <div className="flex items-center gap-2 text-[11px]">
              <Coins className="w-3 h-3" style={{ color: "#fcd34d" }} />
              <span style={{ color: "var(--pos-muted)" }}>Redeem points</span>
              <Input data-testid="redeem-points-input" type="number" min={0} max={Math.min(loyaltyBalance, subtotal)}
                value={redeemPoints || ""} onChange={(e) => onRedeemPoints(Math.max(0, Math.min(loyaltyBalance, Math.floor(+e.target.value || 0))))}
                className="h-6 w-16 text-xs text-white text-right" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
              <button data-testid="redeem-all-btn" onClick={() => onRedeemPoints(Math.min(loyaltyBalance, Math.floor(subtotal)))}
                className="pos-btn text-[10px] px-2 py-0.5 rounded" style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>
                Max
              </button>
              <span className="text-white tabular-nums">−₹{loyaltyDiscount.toFixed(2)}</span>
            </div>
          )}

          {/* Email receipt */}
          <div className="flex items-center gap-2 text-[11px]">
            <Mail className="w-3 h-3" style={{ color: "var(--pos-muted)" }} />
            <Input data-testid="email-input" type="email" placeholder="Email receipt to..."
              value={customerEmail || ""} onChange={(e) => onCustomerEmail(e.target.value)}
              className="h-7 text-xs text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
            <Switch data-testid="send-receipt-toggle" checked={!!sendReceipt} onCheckedChange={onSendReceiptToggle} />
          </div>
        </div>
      )}

      {/* Totals */}
      <div className="px-4 py-2 space-y-1" style={{ borderTop: "1px solid var(--pos-border)" }}>
        {runningBill && (
          <div className="flex justify-between text-xs" data-testid="running-bill-summary">
            <span style={{ color: "#7ea3d1" }}>Running bill (already sent)</span>
            <span className="tabular-nums" style={{ color: "#c7d4e6" }}>₹{runningBill.total.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm"><span style={{ color: "var(--pos-muted)" }}>{runningBill ? "New subtotal" : "Subtotal"}</span><span className="text-white tabular-nums" data-testid="cart-subtotal">₹{subtotal.toFixed(2)}</span></div>
        {deliveryFee > 0 && <div className="flex justify-between text-sm"><span style={{ color: "var(--pos-muted)" }}>Delivery fee</span><span className="text-white tabular-nums">₹{deliveryFee.toFixed(2)}</span></div>}
        <div className="flex justify-between items-center text-sm">
          <span className="flex items-center gap-1.5" style={{ color: "var(--pos-muted)" }}>
            <Percent className="w-3.5 h-3.5" /> Discount
            <span className="flex gap-1 ml-1">
              {[0, 10, 20].map((d) => (
                <button key={d} data-testid={`discount-${d}`} onClick={() => onDiscount(d)}
                  className="pos-btn text-[11px] px-1.5 py-0.5 rounded font-semibold"
                  style={{ background: discount === d ? "var(--pos-blue)" : "var(--pos-panel-2)", color: discount === d ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                  {d === 0 ? "None" : `${d}%`}
                </button>
              ))}
            </span>
          </span>
          <span className="tabular-nums" style={{ color: discountAmt > 0 ? "#7ee2a8" : "var(--pos-muted)" }}>-₹{discountAmt.toFixed(2)}</span>
        </div>
        {couponDiscount > 0 && (
          <div className="flex justify-between text-sm"><span style={{ color: "var(--pos-muted)" }}>Coupon ({coupon.code})</span><span className="tabular-nums" style={{ color: "#7ee2a8" }}>-₹{couponDiscount.toFixed(2)}</span></div>
        )}
        {loyaltyDiscount > 0 && (
          <div className="flex justify-between text-sm"><span style={{ color: "var(--pos-muted)" }}>Loyalty ({redeemPoints} pts)</span><span className="tabular-nums" style={{ color: "#fcd34d" }}>-₹{loyaltyDiscount.toFixed(2)}</span></div>
        )}
        {tipAmt > 0 && (
          <div className="flex justify-between text-sm"><span style={{ color: "var(--pos-muted)" }}>Tip</span><span className="text-white tabular-nums" data-testid="tip-amount">₹{tipAmt.toFixed(2)}</span></div>
        )}
        <div className="flex justify-between items-center pt-2" style={{ borderTop: "1px dashed var(--pos-border)" }}>
          <span className="font-bold text-white">TOTAL</span>
          <span className="text-2xl font-bold tabular-nums" style={{ color: "var(--pos-accent)" }} data-testid="cart-total">₹{total.toFixed(2)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="p-3 pb-14 grid grid-cols-2 gap-2 relative z-20" style={{ borderTop: "1px solid var(--pos-border)" }}>
        <button data-testid="send-kitchen-btn" onClick={() => onSend(total, tipAmt, couponDiscount, loyaltyDiscount)} disabled={cart.length === 0}
          className="pos-btn h-14 rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 text-white relative z-20"
          style={{ background: "var(--pos-blue)" }}>
          <Send className="w-4 h-4" /> {runningBill ? "Add to Kitchen" : "Send to Kitchen"}
        </button>
        <button data-testid="pay-btn" onClick={() => onPay(total, tipAmt, couponDiscount, loyaltyDiscount)} disabled={cart.length === 0 && !runningBill}
          className="pos-btn h-14 rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 text-white relative z-20"
          style={{ background: "var(--pos-accent)" }}>
          <CreditCard className="w-4 h-4" /> {runningBill ? "Pay Bill" : "Pay"} ₹{total.toFixed(2)}
        </button>
      </div>
    </div>
  );
}
