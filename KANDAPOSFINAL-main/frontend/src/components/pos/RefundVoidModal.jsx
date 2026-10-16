import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { refundsApi } from "../../api/client";
import { toast } from "sonner";
import { orderNo } from "../../utils/orderNumber";

const REFUND_REASONS = ["Wrong item", "Late delivery", "Customer cancellation", "Bad quality", "Other"];
const VOID_REASONS = ["Mis-key", "Customer changed mind", "Out of stock", "Other"];

export default function RefundVoidModal({ order, onClose, onDone }) {
  const open = !!order;
  const kind = order?.kind || "refund";
  const isVoid = kind === "void";

  const refundMax = order ? +(order.total - (order.refunded_amount || 0)).toFixed(2) : 0;
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [refundMethod, setRefundMethod] = useState("original");
  const [busy, setBusy] = useState(false);
  const hasCustomerPhone = !!order?.customer?.phone;

  useEffect(() => {
    if (open) {
      setAmount(isVoid ? "" : String(refundMax));
      setReason("");
      setNotes("");
      setRefundMethod("original");
      setBusy(false);
    }
  }, [open, refundMax, isVoid]);

  const submit = async () => {
    if (!reason) { toast.error("Pick a reason"); return; }
    setBusy(true);
    try {
      if (isVoid) {
        await refundsApi.void(order.id, { reason, notes });
        toast.success(`Order ${orderNo(order)} voided`);
      } else {
        const amt = parseFloat(amount);
        if (!(amt > 0)) { toast.error("Enter a refund amount"); setBusy(false); return; }
        await refundsApi.refund(order.id, { amount: amt, reason, notes, refund_method: refundMethod });
        toast.success(refundMethod === "store_credit"
          ? `₹${amt.toFixed(2)} issued as store credit for order ${orderNo(order)}`
          : `Refunded ₹${amt.toFixed(2)} for order ${orderNo(order)}`);
      }
      onDone && onDone();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally { setBusy(false); }
  };

  const reasons = isVoid ? VOID_REASONS : REFUND_REASONS;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} data-testid={`${kind}-modal`}>
        <DialogHeader><DialogTitle style={{ color: "var(--pos-text)" }}>{isVoid ? "Void Order" : "Refund Order"} #{order?.number}</DialogTitle></DialogHeader>
        {order && (
          <div className="space-y-3">
            <div className="rounded-lg p-3 text-sm" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
              <div style={{ color: "var(--pos-text)" }}>{order.customer?.name || "—"} · ₹{order.total.toFixed(2)} ({order.payment})</div>
              {!isVoid && (order.refunded_amount > 0) && (
                <div className="text-xs mt-1" style={{ color: "#fcd34d" }}>Already refunded ₹{order.refunded_amount.toFixed(2)} · max refundable now ₹{refundMax.toFixed(2)}</div>
              )}
              {isVoid && (
                <div className="text-xs mt-1" style={{ color: "var(--pos-muted)" }}>Voiding will restore inventory and mark this order cancelled.</div>
              )}
            </div>

            {!isVoid && (
              <div>
                <label className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Refund amount (₹)</label>
                <Input data-testid="refund-amount-input" type="number" step="0.5" min="0.01" max={refundMax}
                  value={amount} onChange={(e) => setAmount(e.target.value)}
                  className="text-lg" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
                <div className="flex gap-2 mt-2">
                  <button data-testid="refund-quarter" onClick={() => setAmount(String((refundMax / 4).toFixed(2)))} className="pos-btn h-7 px-2 rounded text-[10px]" style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>25%</button>
                  <button data-testid="refund-half" onClick={() => setAmount(String((refundMax / 2).toFixed(2)))} className="pos-btn h-7 px-2 rounded text-[10px]" style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>50%</button>
                  <button data-testid="refund-full" onClick={() => setAmount(String(refundMax))} className="pos-btn h-7 px-2 rounded text-[10px]" style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>Full</button>
                </div>
              </div>
            )}

            {!isVoid && (
              <div>
                <label className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Refund to</label>
                <div className="grid grid-cols-2 gap-1.5 mt-1">
                  <button data-testid="refund-method-original" onClick={() => setRefundMethod("original")}
                    className="pos-btn h-9 rounded-md text-xs font-bold"
                    style={{ background: refundMethod === "original" ? "var(--pos-accent)" : "var(--pos-panel-2)", color: refundMethod === "original" ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                    Original payment
                  </button>
                  <button data-testid="refund-method-credit" onClick={() => hasCustomerPhone && setRefundMethod("store_credit")} disabled={!hasCustomerPhone}
                    title={hasCustomerPhone ? "" : "No customer phone on file for this order"}
                    className="pos-btn h-9 rounded-md text-xs font-bold disabled:opacity-40"
                    style={{ background: refundMethod === "store_credit" ? "var(--pos-accent)" : "var(--pos-panel-2)", color: refundMethod === "store_credit" ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                    Store credit
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Reason</label>
              <div className="grid grid-cols-2 gap-1.5 mt-1">
                {reasons.map((r) => (
                  <button key={r} data-testid={`reason-${r.toLowerCase().replace(/\s+/g, "-")}`} onClick={() => setReason(r)}
                    className="pos-btn h-9 rounded-md text-xs font-bold"
                    style={{ background: reason === r ? "var(--pos-accent)" : "var(--pos-panel-2)", color: reason === r ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>{r}</button>
                ))}
              </div>
            </div>

            <Input data-testid="refund-notes-input" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)}
              style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} disabled={busy} className="pos-btn h-9 px-4 rounded-md text-xs" style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)" }}>Cancel</button>
              <button data-testid={`${kind}-confirm-btn`} onClick={submit} disabled={busy || !reason}
                className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white disabled:opacity-40"
                style={{ background: isVoid ? "#7d2e2e" : "var(--pos-accent)" }}>
                {busy ? "Processing…" : (isVoid ? "Void Order" : "Issue Refund")}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
