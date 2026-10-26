import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Banknote, CreditCard, CheckCircle2, Loader2, XCircle, Split, QrCode, Wallet } from "lucide-react";
import { Input } from "../ui/input";
import { paymentsApi } from "../../api/client";
import { usePos } from "../../store/PosContext";
import { toast } from "sonner";
import { ONLINE_CARD_ENABLED, tenderLabel } from "../../utils/tenders";

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {number} props.total
 * @param {string} props.customerName
 * @param {(method:"cash"|"upi"|"card_machine"|"other"|"card"|"split", splits?:Array) => Promise<{ id: string } | null>} props.onCreateOrder
 * @param {(method:string, order:object) => void} props.onPaid
 */
export default function PaymentModal({ open, onClose, total, customerName, onCreateOrder, onPaid }) {
  const { waitForServerOrder, tenantInfo } = usePos();
  const [method, setMethod] = useState("cash");
  const [tendered, setTendered] = useState("");
  const [cardState, setCardState] = useState("idle");
  const [splitCash, setSplitCash] = useState("");
  const [splitCard, setSplitCard] = useState("");
  const [splitOther, setSplitOther] = useState("upi");

  useEffect(() => {
    if (open) { setMethod("cash"); setTendered(""); setCardState("idle"); setSplitCash(""); setSplitCard(""); setSplitOther("upi"); }
  }, [open]);

  const tenderedNum = parseFloat(tendered) || 0;
  // Stores can round an all-cash bill to the nearest rupee (half up, same rule as the server).
  const cashTotal = tenantInfo?.cashRoundOff ? Math.floor(total + 0.5 + 1e-9) : total;
  const cashRoundOff = +(cashTotal - total).toFixed(2);
  const change = tenderedNum - cashTotal;
  const quickAmounts = [Math.ceil(cashTotal), Math.ceil(cashTotal / 5) * 5, Math.ceil(cashTotal / 10) * 10, Math.ceil(cashTotal / 10) * 10 + 10].filter((v, i, a) => a.indexOf(v) === i);

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

  // UPI to the restaurant's own QR, its own card machine, or anything else:
  // the cashier checks the money arrived, then records it.
  const confirmRecorded = async (m) => {
    setCardState("creating");
    const placed = await onCreateOrder(m);
    if (!placed) { setCardState("idle"); return; }
    onPaid(m, placed);
  };

  const confirmSplit = async () => {
    if (!splitValid) { toast.error(`Cash + ${tenderLabel(splitOther)} must equal total`); return; }
    setCardState("creating");
    const splits = [
      { method: "cash", amount: splitCashNum },
      { method: splitOther, amount: splitCardNum },
    ];
    const placed = await onCreateOrder("split", splits);
    if (!placed) { setCardState("idle"); return; }
    if (splitOther !== "card") { onPaid("split", placed); return; }

    // For split with a card component, drive Razorpay for the card portion only.
    if (typeof window.Razorpay !== "function") {
      // Card portion unconfirmed — leave the order saved as 'unpaid' for the cashier to chase.
      toast.success(`Cash ₹${splitCashNum.toFixed(2)} taken. Card ₹${splitCardNum.toFixed(2)} pending — Razorpay unavailable.`);
      onPaid("split", placed);
      return;
    }
    // The order is local-first; payment must reference the *server* order.
    let serverOrder;
    try {
      serverOrder = await waitForServerOrder(placed);
    } catch (e) {
      toast.error(e.message);
      setCardState("failed");
      return;
    }
    let rzpOrder;
    try {
      rzpOrder = await paymentsApi.createRazorpayOrder(serverOrder.id, splitCardNum);
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
            orderId: serverOrder.id, razorpay_order_id: resp.razorpay_order_id,
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

    let serverOrder;
    try {
      serverOrder = await waitForServerOrder(placed);
    } catch (e) {
      toast.error(e.message);
      setCardState("failed");
      return;
    }
    let rzpOrder;
    try {
      rzpOrder = await paymentsApi.createRazorpayOrder(serverOrder.id, total);
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
            orderId: serverOrder.id,
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

        <div className="grid grid-cols-5 gap-1.5">
          {[
            { id: "cash", label: "Cash", Icon: Banknote },
            { id: "upi", label: "UPI", Icon: QrCode },
            { id: "card_machine", label: "Card", Icon: CreditCard },
            { id: "split", label: "Split", Icon: Split },
            { id: "other", label: "Other", Icon: Wallet },
          ].map(({ id, label, Icon }) => {
            const on = method === id || (id === "card_machine" && method === "card");
            return (
              <button key={id} data-testid={`method-${id}`} onClick={() => setMethod(id)} disabled={busy} aria-pressed={on}
                className="pos-btn h-14 rounded-xl flex flex-col items-center justify-center gap-1 font-bold text-xs disabled:opacity-50"
                style={{ background: on ? "var(--pos-accent)" : "var(--pos-panel-2)", color: on ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                <Icon className="w-5 h-5" /> {label}
              </button>
            );
          })}
        </div>

        {["upi", "card_machine", "other"].includes(method) && (
          <div className="space-y-3 fade-in">
            <div className="text-xs text-center" style={{ color: "var(--pos-muted)" }}>
              {method === "upi" && "Ask the customer to scan your UPI QR. Confirm once the payment shows on your UPI app."}
              {method === "card_machine" && "Charge the card on your card machine. Confirm once it's approved."}
              {method === "other" && "For any other payment (wallet, voucher, bank transfer). Confirm once received."}
            </div>
            <button data-testid="confirm-recorded-btn" onClick={() => confirmRecorded(method)} disabled={busy}
              className="pos-btn w-full h-14 rounded-xl font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2" style={{ background: "var(--pos-accent)" }}>
              {cardState === "creating" ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving order...</> : `Confirm ₹${total.toFixed(2)} received by ${tenderLabel(method)}`}
            </button>
            {method === "card_machine" && ONLINE_CARD_ENABLED && (
              <button data-testid="method-card-online" onClick={() => setMethod("card")} disabled={busy}
                className="pos-btn w-full h-9 rounded-lg text-xs font-bold" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
                Charge an online card instead
              </button>
            )}
          </div>
        )}

        {method === "cash" && (
          <div className="space-y-3 fade-in">
            {cashRoundOff !== 0 && (
              <div className="flex justify-between text-xs rounded-lg px-3 py-2" data-testid="cash-round-off" style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>
                <span>Round-off {cashRoundOff > 0 ? "+" : "-"}₹{Math.abs(cashRoundOff).toFixed(2)}</span>
                <span className="font-bold" style={{ color: "var(--pos-text)" }}>Cash to collect ₹{cashTotal.toFixed(2)}</span>
              </div>
            )}
            <div className="grid grid-cols-5 gap-2">
              <button data-testid="tender-exact" onClick={() => setTendered(cashTotal.toFixed(2))}
                className="pos-btn h-11 rounded-lg font-bold text-sm"
                style={{ background: "var(--pos-accent)", color: "#fff", border: "1px solid var(--pos-accent)" }}>
                Exact
              </button>
              {quickAmounts.slice(0, 4).map((a) => (
                <button key={a} data-testid={`tender-${a}`} onClick={() => setTendered(String(a))}
                  className="pos-btn h-11 rounded-lg font-bold text-sm"
                  style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
                  ₹{a}
                </button>
              ))}
            </div>
            <Input data-testid="tendered-input" type="number" min={0} max={1000000} aria-label="Amount tendered" placeholder="Amount tendered" value={tendered} onChange={(e) => setTendered(e.target.value)}
              className="h-12 text-lg" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
            {tendered !== "" && tenderedNum < 0 && (
              <div className="text-xs font-semibold" role="alert" style={{ color: "#f87171" }}>Amount can&apos;t be negative.</div>
            )}
            {tenderedNum > 0 && tenderedNum < cashTotal && (
              <div className="text-xs font-semibold" role="alert" data-testid="tender-short" style={{ color: "#f87171" }}>
                Short by ₹{(cashTotal - tenderedNum).toFixed(2)}
              </div>
            )}
            {tenderedNum >= cashTotal && (
              <div className="flex justify-between items-center rounded-lg px-4 py-3" style={{ background: "rgba(22,163,74,0.14)", border: "1px solid rgba(22,163,74,0.4)" }} data-testid="change-due">
                <span className="text-sm font-semibold" style={{ color: "#16a34a" }}>Change due</span>
                <span className="text-xl font-bold tabular-nums" style={{ color: "#16a34a" }}>₹{change.toFixed(2)}</span>
              </div>
            )}
            <button data-testid="confirm-cash-btn" onClick={confirmCash} disabled={tenderedNum < cashTotal || busy}
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
          </div>
        )}

        {method === "split" && (
          <div className="space-y-3 fade-in">
            <div className="flex gap-1.5" role="group" aria-label="Pay the rest by">
              {["upi", "card_machine", ...(ONLINE_CARD_ENABLED ? ["card"] : [])].map((m) => (
                <button key={m} data-testid={`split-other-${m}`} onClick={() => setSplitOther(m)} disabled={busy} aria-pressed={splitOther === m}
                  className="pos-btn flex-1 h-9 rounded-md text-xs font-bold"
                  style={{ background: splitOther === m ? "var(--pos-accent)" : "var(--pos-panel-2)", color: splitOther === m ? "#fff" : "var(--pos-text)", border: "1px solid var(--pos-border)" }}>
                  Cash + {tenderLabel(m)}
                </button>
              ))}
            </div>
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
                  {splitOther === "upi" ? <QrCode className="w-3 h-3" /> : <CreditCard className="w-3 h-3" />} {tenderLabel(splitOther)}
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
                className="pos-btn h-9 rounded-md text-xs font-bold" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>{tenderLabel(splitOther)} = remainder</button>
            </div>
            <div className="flex justify-between rounded-lg px-3 py-2 text-sm"
              style={{ background: splitValid ? "rgba(22,163,74,0.14)" : Math.abs(splitDelta) < 0.01 ? "var(--pos-panel-2)" : "rgba(220,38,38,0.14)",
                       border: `1px solid ${splitValid ? "rgba(22,163,74,0.4)" : Math.abs(splitDelta) < 0.01 ? "var(--pos-border)" : "rgba(220,38,38,0.4)"}` }}
              data-testid="split-summary">
              <span style={{ color: "var(--pos-muted)" }}>Cash + {tenderLabel(splitOther)}</span>
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
