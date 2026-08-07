import React, { useEffect, useState } from "react";
import { Dialog, DialogContent } from "../ui/dialog";
import { Printer, Download, Loader2, FileText } from "lucide-react";
import { receiptsApi } from "../../api/client";
import { usePos } from "../../store/PosContext";
import { sendEscposReceipt } from "../../utils/escpos";
import { toast } from "sonner";

const FALLBACK_STORE = { name: "Kanda POS", address: "", phone: "", tax_id: "", footer: "Thank you for ordering!" };

/** Customer receipt — HTML for browser printing + ESC/POS download for thermal printers.
 * Built entirely from the already-cached order + tenant store info whenever
 * possible (see PosContext's `orders`/`tenantInfo`) so it works with zero
 * network calls — critical for a receipt right after an offline-queued
 * order, which may not even exist server-side yet. */
export default function ReceiptModal({ orderId, open, onClose }) {
  const { orders, tenantInfo, staffUser } = usePos();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!open || !orderId) { setData(null); return; }
    const cached = orders.find((o) => o.id === orderId);
    if (cached) {
      const subtotal = cached.subtotal ?? cached.items.reduce((s, it) => s + it.qty * it.price, 0);
      setData({
        store: tenantInfo?.store || FALLBACK_STORE,
        order: cached,
        subtotal,
        taxTotal: cached.taxTotal || 0,
        cgst: cached.cgst || 0,
        sgst: cached.sgst || 0,
        taxInclusive: !!cached.taxInclusive,
        issuedAt: cached.placedAt,
        cashier: staffUser?.name,
      });
      return;
    }
    // Not in the local cache (shouldn't normally happen — every order shown
    // anywhere in the app comes from there) — fall back to the network.
    setLoading(true);
    receiptsApi.json(orderId)
      .then(setData)
      .catch(() => toast.error("Could not load receipt"))
      .finally(() => setLoading(false));
  }, [open, orderId, orders, tenantInfo, staffUser]);

  const doPrint = () => {
    window.print();
  };

  const downloadEscpos = async (kind) => {
    if (!data) return;
    const label = kind === "kitchen" ? "Kitchen ticket" : "Receipt";
    try {
      const mode = await sendEscposReceipt(data.order, data.store, kind, orderId);
      toast.success(mode === "printed" ? `${label} sent to printer` : `${label} ESC/POS file saved`);
    } catch {
      toast.error(`Could not send ${label.toLowerCase()}`);
    }
  };

  const downloadInvoice = async () => {
    setDownloading(true);
    try {
      await receiptsApi.downloadInvoicePdf(orderId, data?.order?.number);
      toast.success("Tax invoice PDF saved");
    } catch {
      toast.error("Could not generate invoice PDF");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border print-receipt-modal p-0" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} data-testid="receipt-modal">
        {loading && (
          <div className="p-10 flex items-center justify-center gap-2 text-white">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading receipt…
          </div>
        )}
        {!loading && data && (
          <>
            {/* Printable receipt (visible in modal + media print) */}
            <div id="receipt-printable" className="bg-white text-black px-6 py-5 font-mono text-[12px] leading-tight">
              <div className="text-center">
                <div className="font-bold text-base">{data.store.name}</div>
                <div>{data.store.address}</div>
                <div>Tel {data.store.phone}</div>
                <div>VAT {data.store.vat}</div>
              </div>
              <div className="border-t border-dashed border-black my-2" />
              <div className="flex justify-between font-bold">
                <span>Order #{data.order.number}</span>
                <span className="uppercase">{data.order.type}</span>
              </div>
              <div>{(data.order.placedAt || "").slice(0, 19).replace("T", " ")}</div>
              {data.order.customer?.name && <div>For: {data.order.customer.name}</div>}
              {data.order.customer?.address && <div>{data.order.customer.address}</div>}
              {data.order.customer?.postcode && <div>{data.order.customer.postcode}</div>}
              {data.order.table && <div>Table {data.order.table}</div>}
              <div className="border-t border-dashed border-black my-2" />
              {data.order.items.map((it, i) => (
                <div key={`${it.name}-${i}`} className="mb-1">
                  <div className="flex justify-between">
                    <span>{it.qty}× {it.name}</span>
                    <span className="tabular-nums">₹{(it.qty * it.price).toFixed(2)}</span>
                  </div>
                  {it.mods?.length > 0 && (
                    <div className="pl-4 text-[11px]">{it.mods.join(" · ")}</div>
                  )}
                </div>
              ))}
              <div className="border-t border-dashed border-black my-2" />
              <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">₹{data.subtotal.toFixed(2)}</span></div>
              {data.taxTotal > 0 && (
                <>
                  <div className="flex justify-between"><span>{data.taxInclusive ? "GST (incl.)" : "GST"}</span><span className="tabular-nums">₹{data.taxTotal.toFixed(2)}</span></div>
                  <div className="flex justify-between pl-3 text-[11px]"><span>CGST</span><span className="tabular-nums">₹{data.cgst.toFixed(2)}</span></div>
                  <div className="flex justify-between pl-3 text-[11px]"><span>SGST</span><span className="tabular-nums">₹{data.sgst.toFixed(2)}</span></div>
                </>
              )}
              {data.order.deliveryFee > 0 && (
                <div className="flex justify-between"><span>Delivery</span><span className="tabular-nums">₹{data.order.deliveryFee.toFixed(2)}</span></div>
              )}
              {data.order.discount > 0 && (
                <div className="flex justify-between"><span>Discount</span><span className="tabular-nums">-₹{data.order.discount.toFixed(2)}</span></div>
              )}
              <div className="flex justify-between font-bold text-base mt-1">
                <span>TOTAL</span>
                <span className="tabular-nums">₹{data.order.total.toFixed(2)}</span>
              </div>
              <div className="border-t border-dashed border-black my-2" />
              <div className="flex justify-between">
                <span>Paid by</span>
                <span className="font-bold uppercase">{data.order.payment}</span>
              </div>
              {data.order.razorpayPaymentId && (
                <div className="text-[10px] mt-1">Ref: {data.order.razorpayPaymentId}</div>
              )}
              {data.cashier && <div className="text-[10px] mt-1">Cashier: {data.cashier}</div>}
              <div className="text-center mt-3">{data.store.footer}</div>
            </div>

            {/* Actions — hidden in print */}
            <div className="px-4 py-3 grid grid-cols-2 gap-2 print-hide" style={{ borderTop: "1px solid var(--pos-border)" }}>
              <button data-testid="print-receipt-btn" onClick={doPrint}
                className="pos-btn h-11 rounded-lg flex items-center justify-center gap-2 font-bold text-sm text-white"
                style={{ background: "var(--pos-accent)" }}>
                <Printer className="w-4 h-4" /> Print
              </button>
              <button data-testid="download-invoice-btn" disabled={downloading} onClick={downloadInvoice}
                className="pos-btn h-11 rounded-lg flex items-center justify-center gap-2 font-bold text-xs text-white disabled:opacity-40"
                style={{ background: "var(--pos-blue)" }}>
                <FileText className="w-3.5 h-3.5" /> Tax Invoice (PDF)
              </button>
              <button data-testid="escpos-customer-btn" disabled={downloading} onClick={() => downloadEscpos("customer")}
                className="pos-btn h-11 rounded-lg flex items-center justify-center gap-2 font-bold text-xs text-white disabled:opacity-40"
                style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                <Download className="w-3.5 h-3.5" /> ESC/POS
              </button>
              <button data-testid="escpos-kitchen-btn" disabled={downloading} onClick={() => downloadEscpos("kitchen")}
                className="pos-btn h-11 rounded-lg flex items-center justify-center gap-2 font-bold text-xs text-white disabled:opacity-40"
                style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                <Download className="w-3.5 h-3.5" /> KOT
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
