import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Banknote, CreditCard, CheckCircle2, Loader2, XCircle, Split } from "lucide-react";
import { Input } from "../ui/input";
import { paymentsApi } from "../../api/client";
import { toast } from "sonner";

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {number} props.total
 * @param {string} props.customerName
 * @param {(method:"cash"|"card", splits?:Array) => Promise<{ id: string } | null>} props.onCreateOrder
 * @param {(method:"cash"|"card"|"split", order:object) => void} props.onPaid
 */
export default function PaymentModal({ open, onClose, total, customerName, onCreateOrder, onPaid }) {
  const [method, setMethod] = useState("cash");
  const [tendered, setTendered] = useState("");
  const [cardState, setCardState] = useState("idle");
  const [splitCash, setSplitCash] = useState("");
  const [splitCard, setSplitCard] = useState("");

  useEffect(() => {
    if (open) { setMethod("cash"); setTendered(""); setCardState("idle"); setSplitCash(""); setSplitCard(""); }
  }, [open]);

  const tenderedNum = parseFloat(tendered) || 0;
  const change = tenderedNum - total;
  const quickAmounts = [Math.ceil(total), Math.ceil(total / 5) * 5, Math.ceil(total / 10) * 10, Math.ceil(total / 10) * 10 + 10].filter((v, i, a) => a.indexOf(v) === i);

  const splitCashNum = parseFloat(splitCash) || 0;
  const splitCardNum = parseFloat(splitCard) || 0;
  const splitSum = +(splitCashNum + splitCardNum).toFixed(2);
  const splitDelta = +(total - splitSum).toFixed(2);
  const splitValid = Math.abs(splitDelta) < 0.01 && splitCashNum > 0 && splitCardNum > 0;

  const confirmCash = async () => {
    setCardState("creating");
    const placed = await onCreateOrder("cash");
    if (!placed) { setCardState("idle"); return; }
    onPaid("cash", placed);
  };

  const confirmSplit = async () => {
    if (!splitValid) { toast.error("Cash + Card must equal total"); return; }
    setCardState("creating");
    const splits = [
      { method: "cash", amount: splitCashNum },
      { method: "card", amount: splitCardNum },
    ];
    const placed = await onCreateOrder("split", splits);
    if (!placed) { setCardState("idle"); return; }

    // For split with a card component, drive Razorpay for the card portion only.
    if (typeof window.Razorpay !== "function") {
      // Card portion unconfirmed — leave the order saved as 'unpaid' for the cashier to chase.
      toast.success(`Cash ₹${splitCashNum.toFixed(2)} taken. Card ₹${splitCardNum.toFixed(2)} pending — Razorpay unavailable.`);
      onPaid("split", placed);
      return;
    }
    let rzpOrder;
    try {
      rzpOrder = await paymentsApi.createRazorpayOrder(placed.id, splitCardNum);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not start card portion");
      setCardState("failed");
      return;
    }
    setCardState("opening");
    const rzp = new window.Razorpay({
      key: rzpOrder.razorpayKeyId, amount: rzpOrder.amount, currency: rzpOrder.currency,
      order_id: rzpOrder.razorpayOrderId, name: "Kanda POS",
      description: `POS Order #${placed.number} — card portion`,
      prefill: { name: customerName || "Walk-in" }, theme: { color: "#f97316" },
      modal: {
        ondismiss: () => {
          setCardState("idle");
          toast.info("Card portion cancelled — cash portion recorded, order saved unpaid");
          onClose();
        },
      },
      handler: async (resp) => {
        setCardState("verifying");
        try {
          const result = await paymentsApi.verify({
            orderId: placed.id, razorpay_order_id: resp.razorpay_order_id,
            razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature,
          });
          setCardState("approved");
          setTimeout(() => onPaid("split", result.order), 800);
        } catch (e) {
          setCardState("failed");
          toast.error(e?.response?.data?.detail || "Card verification failed");
        }
      },
    });
    rzp.open();
  };

  const processCard = async () => {
    if (typeof window.Razorpay !== "function") {
      toast.error("Razorpay Checkout failed to load");
      return;
    }
    setCardState("creating");
    const placed = await onCreateOrder("card");
    if (!placed) { setCardState("idle"); return; }

    let rzpOrder;
    try {
      rzpOrder = await paymentsApi.createRazorpayOrder(placed.id, total);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not create Razorpay order");
      setCardState("failed");
      return;
    }

    setCardState("opening");
    const rzp = new window.Razorpay({
      key: rzpOrder.razorpayKeyId,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
      order_id: rzpOrder.razorpayOrderId,
      name: "Kanda POS",
      description: `POS Order #${placed.number}`,
      prefill: { name: customerName || "Walk-in" },
      theme: { color: "#f97316" },
      modal: {
        ondismiss: () => {
          setCardState("idle");
          toast.info("Card payment cancelled — order saved as unpaid");
          onClose();
        },
      },
      handler: async (resp) => {
        setCardState("verifying");
        try {
          const result = await paymentsApi.verify({
            orderId: placed.id,
            razorpay_order_id: resp.razorpay_order_id,
            razorpay_payment_id: resp.razorpay_payment_id,
            razorpay_signature: resp.razorpay_signature,
          });
          setCardState("approved");
          setTimeout(() => onPaid("card", result.order), 800);
        } catch (e) {
          setCardState("failed");
          toast.error(e?.response?.data?.detail || "Payment verification failed");
        }
      },
    });
    rzp.open();
  };

  const busy = ["creating", "opening", "verifying"].includes(cardState);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} data-testid="payment-modal">
        <DialogHeader>
          <DialogTitle style={{ color: "var(--pos-text)" }}>Take Payment</DialogTitle>
        </DialogHeader>

        <div className="text-center py-2">
          <div className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Amount Due</div>
          <div className="text-4xl font-bold tabular-nums mt-1" style={{ color: "var(--pos-accent)" }} data-testid="payment-total">₹{total.toFixed(2)}</div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button data-testid="method-cash" onClick={() => setMethod("cash")} disabled={busy}
            className="pos-btn h-14 rounded-xl flex flex-col items-center justify-center gap-1 font-bold text-xs disabled:opacity-50"
            style={{ background: method === "cash" ? "var(--pos-accent)" : "var(--pos-panel-2)", color: method === "cash" ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
            <Banknote className="w-5 h-5" /> Cash
          </button>
          <button data-testid="method-card" onClick={() => setMethod("card")} disabled={busy}
            className="pos-btn h-14 rounded-xl flex flex-col items-center justify-center gap-1 font-bold text-xs disabled:opacity-50"
            style={{ background: method === "card" ? "var(--pos-accent)" : "var(--pos-panel-2)", color: method === "card" ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
            <CreditCard className="w-5 h-5" /> Card
          </button>
          <button data-testid="method-split" onClick={() => setMethod("split")} disabled={busy}
            className="pos-btn h-14 rounded-xl flex flex-col items-center justify-center gap-1 font-bold text-xs disabled:opacity-50"
            style={{ background: method === "split" ? "var(--pos-accent)" : "var(--pos-panel-2)", color: method === "split" ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
            <Split className="w-5 h-5" /> Split
          </button>
        </div>

        {method === "cash" && (
          <div className="space-y-3 fade-in">
            <div className="grid grid-cols-4 gap-2">
              {quickAmounts.map((a) => (
                <button key={a} data-testid={`tender-${a}`} onClick={() => setTendered(String(a))}
                  className="pos-btn h-11 rounded-lg font-bold text-sm"
                  style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
                  ₹{a}
                </button>
              ))}
            </div>
            <Input data-testid="tendered-input" type="number" placeholder="Amount tendered" value={tendered} onChange={(e) => setTendered(e.target.value)}
              className="h-12 text-lg" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
            {tenderedNum >= total && (
              <div className="flex justify-between items-center rounded-lg px-4 py-3" style={{ background: "rgba(22,163,74,0.14)", border: "1px solid rgba(22,163,74,0.4)" }} data-testid="change-due">
                <span className="text-sm font-semibold" style={{ color: "#16a34a" }}>Change due</span>
                <span className="text-xl font-bold tabular-nums" style={{ color: "#16a34a" }}>₹{change.toFixed(2)}</span>
              </div>
            )}
            <button data-testid="confirm-cash-btn" onClick={confirmCash} disabled={tenderedNum < total || busy}
              className="pos-btn w-full h-14 rounded-xl font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2" style={{ background: "var(--pos-accent)" }}>
              {cardState === "creating" ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving order...</> : "Confirm Cash Payment"}
            </button>
          </div>
        )}

        {method === "card" && (
          <div className="space-y-3 fade-in">
            {cardState === "idle" && (
              <button data-testid="card-charge-btn" onClick={processCard}
                className="pos-btn w-full h-14 rounded-xl font-bold text-white" style={{ background: "var(--pos-accent)" }}>
                Charge Card ₹{total.toFixed(2)}
              </button>
            )}
            {cardState === "creating" && (
              <div className="flex items-center justify-center gap-3 h-14 rounded-xl" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--pos-accent)" }} />
                <span className="text-sm font-semibold" style={{ color: "var(--pos-text)" }}>Creating order...</span>
              </div>
            )}
            {cardState === "opening" && (
              <div className="flex items-center justify-center gap-3 h-14 rounded-xl" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} data-testid="card-processing">
                <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--pos-accent)" }} />
                <span className="text-sm font-semibold" style={{ color: "var(--pos-text)" }}>Awaiting cardholder at Razorpay...</span>
              </div>
            )}
            {cardState === "verifying" && (
              <div className="flex items-center justify-center gap-3 h-14 rounded-xl" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--pos-accent)" }} />
                <span className="text-sm font-semibold" style={{ color: "var(--pos-text)" }}>Verifying signature...</span>
              </div>
            )}
            {cardState === "approved" && (
              <div className="flex items-center justify-center gap-3 h-14 rounded-xl" style={{ background: "rgba(22,163,74,0.14)", border: "1px solid rgba(22,163,74,0.4)" }} data-testid="card-approved">
                <CheckCircle2 className="w-5 h-5" style={{ color: "#16a34a" }} />
                <span className="text-sm font-bold" style={{ color: "#16a34a" }}>APPROVED</span>
              </div>
            )}
            {cardState === "failed" && (
              <div className="flex items-center justify-center gap-3 h-14 rounded-xl" style={{ background: "rgba(220,38,38,0.14)", border: "1px solid rgba(220,38,38,0.4)" }}>
                <XCircle className="w-5 h-5" style={{ color: "#dc2626" }} />
                <span className="text-sm font-bold" style={{ color: "#dc2626" }}>PAYMENT FAILED</span>
              </div>
            )}
            <div className="text-[11px] text-center" style={{ color: "var(--pos-muted)" }}>
              Test card: <span className="font-mono" style={{ color: "var(--pos-text)" }}>4111 1111 1111 1111</span> · any future expiry · CVV 123
            </div>
          </div>
        )}

        {method === "split" && (
          <div className="space-y-3 fade-in">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] uppercase tracking-wider flex items-center gap-1" style={{ color: "var(--pos-muted)" }}>
                  <Banknote className="w-3 h-3" /> Cash
                </label>
                <Input data-testid="split-cash-input" type="number" step="0.5" placeholder="0.00"
                  value={splitCash} onChange={(e) => setSplitCash(e.target.value)}
                  className="h-12 text-lg" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider flex items-center gap-1" style={{ color: "var(--pos-muted)" }}>
                  <CreditCard className="w-3 h-3" /> Card
                </label>
                <Input data-testid="split-card-input" type="number" step="0.5" placeholder="0.00"
                  value={splitCard} onChange={(e) => setSplitCard(e.target.value)}
                  className="h-12 text-lg" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button data-testid="split-half" onClick={() => { const h = +(total / 2).toFixed(2); setSplitCash(String(h)); setSplitCard(String(+(total - h).toFixed(2))); }}
                className="pos-btn h-9 rounded-md text-xs font-bold" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>50/50</button>
              <button data-testid="split-remainder-card" onClick={() => setSplitCard(String(Math.max(0, +(total - splitCashNum).toFixed(2))))}
                className="pos-btn h-9 rounded-md text-xs font-bold" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>Card = remainder</button>
            </div>
            <div className="flex justify-between rounded-lg px-3 py-2 text-sm"
              style={{ background: splitValid ? "rgba(22,163,74,0.14)" : Math.abs(splitDelta) < 0.01 ? "var(--pos-panel-2)" : "rgba(220,38,38,0.14)",
                       border: `1px solid ${splitValid ? "rgba(22,163,74,0.4)" : Math.abs(splitDelta) < 0.01 ? "var(--pos-border)" : "rgba(220,38,38,0.4)"}` }}
              data-testid="split-summary">
              <span style={{ color: "var(--pos-muted)" }}>Cash + Card</span>
              <span className="tabular-nums font-bold" style={{ color: splitValid || Math.abs(splitDelta) >= 0.01 ? "#fff" : "var(--pos-text)" }}>₹{splitSum.toFixed(2)} <span style={{ color: "var(--pos-muted)", fontWeight: 400 }}>/ ₹{total.toFixed(2)}</span></span>
            </div>
            <button data-testid="confirm-split-btn" onClick={confirmSplit} disabled={!splitValid || busy}
              className="pos-btn w-full h-14 rounded-xl font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2" style={{ background: "var(--pos-accent)" }}>
              {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</> : "Take Split Payment"}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
