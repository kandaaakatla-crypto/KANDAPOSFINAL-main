import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Store, Loader2, ShieldCheck, Check } from "lucide-react";
import { plansApi } from "../api/client";

/**
 * Pay-per-location upgrade dialog.
 *
 * Business model: the first location is free. Every additional location
 * costs ₹1999 (one-time). Payment via Razorpay Checkout, then we increment
 * `tenant.paid_slots` server-side and the caller can proceed to add the
 * actual location.
 */
export default function PlanUpgradeDialog({ open, onClose, onUpgraded }) {
  const [slots, setSlots] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    plansApi.list().then(setSlots).catch(() => {}).finally(() => setLoading(false));
  }, [open]);

  const ensureScript = () => {
    if (window.Razorpay) return Promise.resolve();
    if (window.__razorpayScript) return window.__razorpayScript;
    window.__razorpayScript = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Failed to load Razorpay"));
      document.body.appendChild(s);
    });
    return window.__razorpayScript;
  };

  const buySlot = async () => {
    setBusy(true);
    try {
      await ensureScript();
      const order = await plansApi.purchaseLocation();
      const rzp = new window.Razorpay({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        order_id: order.order_id,
        name: "Kanda POS",
        description: order.description,
        theme: { color: "#7c3aed" },
        handler: async (resp) => {
          try {
            const v = await plansApi.verify({
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            });
            if (v.ok) {
              toast.success("Payment successful — you can now add your new location!");
              onUpgraded?.();
              onClose?.();
            } else {
              toast.error("Payment verification failed. Contact support if amount was charged.");
            }
          } catch (e) {
            toast.error(e?.response?.data?.detail || "Verification failed");
          } finally {
            setBusy(false);
          }
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.on("payment.failed", (r) => {
        toast.error(r?.error?.description || "Payment failed");
        setBusy(false);
      });
      rzp.open();
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "Could not start checkout");
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent data-testid="plan-upgrade-dialog" className="max-w-md border"
        style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: "var(--pos-text)" }}>
            <Store className="w-5 h-5" style={{ color: "#a78bfa" }} />
            Add another location
          </DialogTitle>
        </DialogHeader>
        {loading && (
          <div className="p-6 text-center text-sm" style={{ color: "var(--pos-muted)" }}>
            <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading…
          </div>
        )}
        {slots && (
          <div className="space-y-4">
            <div className="p-3 rounded" style={{ background: "var(--pos-panel-2)" }}>
              <div className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>
                Your locations
              </div>
              <div className="mt-1 text-sm" style={{ color: "var(--pos-text)" }}>
                {slots.used} / {slots.total_slots} used
                <span className="ml-2 text-[11px]" style={{ color: "var(--pos-muted)" }}>
                  ({slots.free_slots} free · {slots.paid_slots} paid)
                </span>
              </div>
            </div>

            <div className="p-4 rounded-xl text-center"
              style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.20), rgba(79,70,229,0.10))",
                       border: "1px solid rgba(124,58,237,0.40)" }}>
              <div className="text-[11px] uppercase tracking-wider" style={{ color: "#c4b5fd" }}>
                One-time charge
              </div>
              <div className="mt-1 text-4xl font-bold tabular-nums" style={{ color: "var(--pos-text)" }}>
                ₹{slots.price_per_location.toFixed(0)}
              </div>
              <div className="text-[11px] mt-1" style={{ color: "var(--pos-muted)" }}>
                per additional location
              </div>
            </div>

            <ul className="space-y-1.5 text-xs" style={{ color: "var(--pos-muted)" }}>
              <li className="flex items-center gap-1.5">
                <Check className="w-3 h-3 text-emerald-400" /> Full POS, KDS, staff & reports for the new store
              </li>
              <li className="flex items-center gap-1.5">
                <Check className="w-3 h-3 text-emerald-400" /> AI Assistant, Voice Agent & WhatsApp included
              </li>
              <li className="flex items-center gap-1.5">
                <Check className="w-3 h-3 text-emerald-400" /> No monthly commitment — pay only when you grow
              </li>
            </ul>

            <button data-testid="plan-buy-slot" onClick={buySlot} disabled={busy}
              className="pos-btn w-full h-11 rounded text-sm font-bold text-white flex items-center justify-center gap-2"
              style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", opacity: busy ? 0.5 : 1 }}>
              {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Opening Razorpay…</>
                : <><ShieldCheck className="w-4 h-4" /> Pay ₹{slots.price_per_location.toFixed(0)} & add location</>}
            </button>
            <div className="text-[10px] text-center" style={{ color: "var(--pos-muted)" }}>
              Test card <code>4111 1111 1111 1111</code> · any future date · any CVC · OTP <code>1234</code>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
