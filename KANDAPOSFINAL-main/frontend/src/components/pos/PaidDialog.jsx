import React, { useState } from "react";
import { CheckCircle2, Printer, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import ReceiptModal from "./ReceiptModal";
import { orderNo } from "../../utils/orderNumber";

/** Shown right after a sale is paid: print/view the receipt, or go straight
 *  to the next order. `info` = { order, method, total } or null. */
export default function PaidDialog({ info, onClose }) {
  const [showReceipt, setShowReceipt] = useState(false);
  if (!info) return null;
  const close = () => { setShowReceipt(false); onClose(); };
  return (
    <>
      <Dialog open={!showReceipt} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-sm border text-center" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} data-testid="paid-dialog">
          <DialogHeader>
            <DialogTitle className="sr-only">Payment received</DialogTitle>
          </DialogHeader>
          <CheckCircle2 className="w-12 h-12 mx-auto" style={{ color: "#16a34a" }} />
          <div className="text-lg font-bold" style={{ color: "var(--pos-text)" }}>Payment received</div>
          <div className="text-sm" style={{ color: "var(--pos-muted)" }}>
            Order {orderNo(info.order)} · {info.method} · ₹{Number(info.total).toFixed(2)}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button data-testid="paid-print" onClick={() => setShowReceipt(true)}
              className="pos-btn h-11 rounded-lg font-bold text-sm flex items-center justify-center gap-1.5"
              style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)", border: "1px solid var(--pos-border)" }}>
              <Printer className="w-4 h-4" /> Receipt
            </button>
            <button data-testid="paid-new-order" onClick={close} autoFocus
              className="pos-btn h-11 rounded-lg font-bold text-sm text-white flex items-center justify-center gap-1.5"
              style={{ background: "var(--pos-accent)" }}>
              <Plus className="w-4 h-4" /> New order
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <ReceiptModal orderId={info.order.id} open={showReceipt} onClose={close} />
    </>
  );
}
