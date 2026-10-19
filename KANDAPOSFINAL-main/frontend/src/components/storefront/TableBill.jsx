import React from "react";
import { CheckCircle2, CreditCard, Loader2, ReceiptText, RefreshCw } from "lucide-react";

const rupees = (n) => `₹${(Number(n) || 0).toFixed(2)}`;

// The guest's "Your bill" tab: everything the table has ordered so far, and
// a button to pay it online. Cash and card-machine payers ask staff, as before.
export default function TableBill({ bill, loading, onRefresh, onPay, paying, onlinePayments }) {
  if (loading && !bill) {
    return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--sf-accent)" }} /></div>;
  }
  if (!bill || !bill.open) {
    return (
      <div className="text-center px-6 py-16" data-testid="table-bill-empty">
        <ReceiptText className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--sf-text-muted)" }} />
        <p className="text-sm" style={{ color: "var(--sf-text-muted)" }}>Nothing ordered at this table yet.</p>
      </div>
    );
  }
  return (
    <div className="px-4 pt-4 max-w-md mx-auto" data-testid="table-bill">
      <div className="rounded-2xl p-4 sf-card">
        <div className="flex items-center justify-between mb-3">
          <div className="font-bold">Bill #{bill.orderNumber}</div>
          <button onClick={onRefresh} aria-label="Refresh bill" className="w-8 h-8 rounded-full flex items-center justify-center sf-input">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div className="space-y-2 mb-3">
          {bill.items.map((it, i) => (
            <div key={i} className="flex justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="truncate">{it.qty} × {it.name}</div>
                {it.mods?.length > 0 && <div className="text-[11px]" style={{ color: "var(--sf-text-muted)" }}>{it.mods.join(" · ")}</div>}
              </div>
              <div className="shrink-0">{rupees(it.qty * it.price)}</div>
            </div>
          ))}
        </div>
        <div className="pt-3 space-y-1 text-xs" style={{ borderTop: "1px dashed var(--sf-border)", color: "var(--sf-text-muted)" }}>
          <div className="flex justify-between"><span>Subtotal</span><span>{rupees(bill.subtotal)}</span></div>
          {bill.discount > 0 && <div className="flex justify-between"><span>Discount</span><span>−{rupees(bill.discount)}</span></div>}
          {bill.serviceCharge > 0 && <div className="flex justify-between"><span>Service charge</span><span>{rupees(bill.serviceCharge)}</span></div>}
          {bill.taxTotal > 0 && (
            <div className="flex justify-between"><span>GST (CGST {rupees(bill.cgst)} + SGST {rupees(bill.sgst)})</span><span>{rupees(bill.taxTotal)}</span></div>
          )}
        </div>
        <div className="flex justify-between text-base font-bold mt-2" data-testid="table-bill-total">
          <span>Total</span><span>{rupees(bill.total)}</span>
        </div>
      </div>

      {bill.paid ? (
        <div className="mt-4 h-12 rounded-full flex items-center justify-center gap-2 text-sm font-bold" style={{ background: "var(--sf-success-bg)", color: "var(--sf-success)" }}>
          <CheckCircle2 className="w-4 h-4" /> Paid. Thank you!
        </div>
      ) : (
        <>
          {onlinePayments && (
            <button data-testid="table-bill-pay" onClick={onPay} disabled={paying}
              className="mt-4 w-full h-12 rounded-full font-bold flex items-center justify-center gap-2 disabled:opacity-50 sf-btn-accent">
              {paying ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CreditCard className="w-4 h-4" /> Pay {rupees(bill.total)} online</>}
            </button>
          )}
          <p className="text-xs text-center mt-3" style={{ color: "var(--sf-text-muted)" }}>Paying by cash or card? Ask our staff for the bill.</p>
        </>
      )}
    </div>
  );
}
