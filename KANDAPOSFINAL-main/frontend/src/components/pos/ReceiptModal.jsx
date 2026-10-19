import React, { useEffect, useState } from "react";
import { Dialog, DialogContent } from "../ui/dialog";
import { Printer, Download, Loader2, FileText, UserPlus } from "lucide-react";
import { receiptsApi } from "../../api/client";
import { usePos } from "../../store/PosContext";
import { sendEscposReceipt, billTitleLines } from "../../utils/escpos";
import { billToLines, summaryRows, signedMoney, gstinLine } from "../../utils/receiptSummary";
import { Input } from "../ui/input";
import { toast } from "sonner";
import { orderNo } from "../../utils/orderNumber";
import WhatsAppBillForm from "./WhatsAppBillForm";

const inr = (v) => `₹${Number(v || 0).toFixed(2)}`;
const EMPTY_CUSTOMER = { name: "", phone: "", email: "", address: "", postcode: "", gstin: "" };

/** Inline form to put the guest's details (and GSTIN, for a business) on an
 * already-placed order, so the receipt and the PDF tax invoice carry them. */
function CustomerDetailsForm({ order, onSave, onCancel }) {
  const cust = order.customer || {};
  const placeholder = /^(Table \d+|Walk-in)$/.test(cust.name || "");
  const [form, setForm] = useState({
    ...EMPTY_CUSTOMER,
    ...Object.fromEntries(Object.entries(cust).filter(([, v]) => v != null)),
    name: placeholder ? "" : (cust.name || ""),
    email: cust.email || order.customer_email || "",
  });
  const [saving, setSaving] = useState(false);
  const field = (key, placeholderText, testid) => (
    <Input data-testid={testid} placeholder={placeholderText} value={form[key] || ""}
      onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="h-9"
      style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
  );
  const save = async () => {
    setSaving(true);
    const ok = await onSave({ ...form, id: cust.id || null });
    setSaving(false);
    if (ok) onCancel();
  };
  return (
    <div className="px-4 py-3 space-y-2 print-hide" data-testid="receipt-customer-form" style={{ borderTop: "1px solid var(--pos-border)" }}>
      <div className="text-xs uppercase tracking-wider font-semibold" style={{ color: "var(--pos-muted)" }}>Customer details for this bill</div>
      {field("name", "Name / company", "receipt-cust-name")}
      <div className="grid grid-cols-2 gap-2">
        {field("phone", "Phone", "receipt-cust-phone")}
        {field("gstin", "GSTIN (optional)", "receipt-cust-gstin")}
      </div>
      {field("email", "Email (optional)", "receipt-cust-email")}
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">{field("address", "Address (optional)", "receipt-cust-address")}</div>
        {field("postcode", "PIN code", "receipt-cust-postcode")}
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} disabled={saving} className="pos-btn h-9 px-4 rounded-md text-xs" style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)" }}>Cancel</button>
        <button data-testid="receipt-cust-save" onClick={save} disabled={saving}
          className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white disabled:opacity-40" style={{ background: "var(--pos-accent)" }}>
          {saving ? "Saving…" : "Save to bill"}
        </button>
      </div>
    </div>
  );
}

const FALLBACK_STORE = { name: "Kanda POS", address: "", phone: "", tax_id: "", footer: "Thank you for ordering!" };

/** Customer receipt — HTML for browser printing + ESC/POS download for thermal printers.
 * Built entirely from the already-cached order + tenant store info whenever
 * possible (see PosContext's `orders`/`tenantInfo`) so it works with zero
 * network calls — critical for a receipt right after an offline-queued
 * order, which may not even exist server-side yet. */
export default function ReceiptModal({ orderId, open, onClose }) {
  const { orders, tenantInfo, staffUser, setOrderCustomer } = usePos();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(false);

  useEffect(() => { if (!open) setEditingCustomer(false); }, [open]);

  const saveCustomer = async (customer) => {
    const updated = await setOrderCustomer(orderId, customer);
    if (!updated) return false;
    // Covers the network-fallback path too, where `data` isn't derived from `orders`.
    setData((d) => (d ? { ...d, order: updated } : d));
    toast.success("Customer details added to the bill");
    return true;
  };

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
          <div className="p-10 flex items-center justify-center gap-2" style={{ color: "var(--pos-text)" }}>
            <Loader2 className="w-5 h-5 animate-spin" /> Loading receipt…
          </div>
        )}
        {!loading && data && (
          <>
            {/* Printable receipt (visible in modal + media print) */}
            <div id="receipt-printable" className="bg-white text-black px-6 py-5 font-mono text-[12px] leading-tight">
              <div className="text-center">
                <div className="font-bold text-base">{data.store.name}</div>
                {data.store.address && <div>{data.store.address}</div>}
                {data.store.phone && <div>Tel {data.store.phone}</div>}
                {data.store.tax_id && <div>{gstinLine(data.store.tax_id)}</div>}
                {data.store.fssai && <div data-testid="receipt-fssai">FSSAI Lic. No. {data.store.fssai}</div>}
                {billTitleLines(data.store).map((l, i) => (
                  <div key={l} className={i === 0 ? "font-bold mt-1" : "text-[10px]"} data-testid={i === 0 ? "receipt-title" : undefined}>{l}</div>
                ))}
              </div>
              <div className="border-t border-dashed border-black my-2" />
              {data.order.voided && <div className="text-center font-bold" data-testid="receipt-void">*** VOID ***</div>}
              <div className="flex justify-between font-bold">
                <span>Order {orderNo(data.order)}</span>
                <span className="uppercase">{data.order.type}</span>
              </div>
              <div>{(data.order.placedAt || "").slice(0, 19).replace("T", " ")}</div>
              {billToLines(data.order).map((line, i) => (
                <div key={line} data-testid={i === 0 ? "receipt-bill-to" : undefined}>{i === 0 ? `For: ${line}` : line}</div>
              ))}
              {data.order.table && <div>Table {data.order.table}</div>}
              <div className="border-t border-dashed border-black my-2" />
              {data.order.items.map((it, i) => (
                <div key={`${it.name}-${i}`} className="mb-1">
                  <div className="flex justify-between">
                    <span>{it.qty}× {it.name}</span>
                    <span className="tabular-nums">{inr(it.qty * it.price)}</span>
                  </div>
                  {it.mods?.length > 0 && (
                    <div className="pl-4 text-[11px]">{it.mods.join(" · ")}</div>
                  )}
                </div>
              ))}
              <div className="border-t border-dashed border-black my-2" />
              {summaryRows(data.order).map((r) => (
                <div key={r.label} data-testid={r.kind === "refund" ? "receipt-refunded" : undefined}
                  className={`flex justify-between ${r.kind === "sub" ? "pl-3 text-[11px]" : ""} ${r.kind === "total" ? "font-bold text-base mt-1" : ""}`}>
                  <span>{r.label}</span>
                  <span className="tabular-nums">{signedMoney(r.amount, inr)}</span>
                </div>
              ))}
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

            {editingCustomer && (
              <CustomerDetailsForm order={data.order} onSave={saveCustomer} onCancel={() => setEditingCustomer(false)} />
            )}

            {/* Actions — hidden in print */}
            <div className="px-4 py-3 grid grid-cols-2 gap-2 print-hide" style={{ borderTop: "1px solid var(--pos-border)" }}>
              {!editingCustomer && (
                <button data-testid="receipt-edit-customer" onClick={() => setEditingCustomer(true)}
                  className="pos-btn col-span-2 h-10 rounded-lg flex items-center justify-center gap-2 font-bold text-xs"
                  style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
                  <UserPlus className="w-3.5 h-3.5" /> {billToLines(data.order).length ? "Edit customer details" : "Add customer details"}
                </button>
              )}
              <button data-testid="print-receipt-btn" onClick={doPrint}
                className="pos-btn h-11 rounded-lg flex items-center justify-center gap-2 font-bold text-sm text-white"
                style={{ background: "var(--pos-accent)" }}>
                <Printer className="w-4 h-4" /> Print
              </button>
              <button data-testid="download-invoice-btn" disabled={downloading} onClick={downloadInvoice}
                className="pos-btn h-11 rounded-lg flex items-center justify-center gap-2 font-bold text-xs text-white disabled:opacity-40"
                style={{ background: "var(--pos-blue)" }}>
                <FileText className="w-3.5 h-3.5" /> {billTitleLines(data.store)[0] === "TAX INVOICE" ? "Tax Invoice" : "Bill of Supply"} (PDF)
              </button>
              <button data-testid="escpos-customer-btn" disabled={downloading} onClick={() => downloadEscpos("customer")}
                className="pos-btn h-11 rounded-lg flex items-center justify-center gap-2 font-bold text-xs disabled:opacity-40"
                style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
                <Download className="w-3.5 h-3.5" /> ESC/POS
              </button>
              <button data-testid="escpos-kitchen-btn" disabled={downloading} onClick={() => downloadEscpos("kitchen")}
                className="pos-btn h-11 rounded-lg flex items-center justify-center gap-2 font-bold text-xs disabled:opacity-40"
                style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
                <Download className="w-3.5 h-3.5" /> KOT
              </button>
              <WhatsAppBillForm key={orderId} orderId={orderId} defaultPhone={data.order.customer?.phone || ""}
                canAskReview={!!data.store.google_review_url} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
