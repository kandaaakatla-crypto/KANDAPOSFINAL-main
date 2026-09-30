// Shared receipt content — mirrors backend/receipts.py's _bill_to_lines /
// _summary_rows so the on-screen receipt, the local ESC/POS file and the
// server-rendered PDF invoice all show the same lines.

/** Store's GST registration line — labelled when the tenant entered just
 * the bare number (India uses GST, not VAT). */
export function gstinLine(taxId) {
  const v = String(taxId || "").trim();
  if (!v) return "";
  return /^GST/i.test(v) ? v : `GSTIN ${v}`;
}

/** Customer details worth printing, one per line. A dine-in order with no
 * guest details carries a "Table N" placeholder name — that isn't a
 * customer, so it's left off (the table is printed on its own line). */
export function billToLines(order) {
  const cust = order?.customer || {};
  const lines = [];
  const name = String(cust.name || "").trim();
  if (name && !/^(Table \d+|Walk-in)$/.test(name)) lines.push(name);
  const addr = [cust.address, cust.postcode].map((p) => String(p || "").trim()).filter(Boolean).join(" ");
  if (addr) lines.push(addr);
  if (String(cust.phone || "").trim()) lines.push(`Ph: ${String(cust.phone).trim()}`);
  const email = String(cust.email || order?.customer_email || "").trim();
  if (email) lines.push(email);
  if (String(cust.gstin || "").trim()) lines.push(`GSTIN: ${String(cust.gstin).trim().toUpperCase()}`);
  return lines;
}

/** Totals block as [{label, amount, kind}] — negative amounts are
 * deductions. Refund rows only appear once a refund has been issued. */
export function summaryRows(order) {
  const subtotal = order.subtotal ?? (order.items || []).reduce((s, it) => s + it.qty * it.price, 0);
  const rows = [{ label: "Subtotal", amount: subtotal }];
  if (order.serviceCharge) rows.push({ label: `Service charge (${Number(order.serviceChargePct || 0)}%)`, amount: order.serviceCharge });
  if (order.taxTotal) {
    rows.push({ label: order.taxInclusive ? "GST (incl.)" : "GST", amount: order.taxTotal });
    rows.push({ label: "CGST", amount: order.cgst || 0, kind: "sub" });
    rows.push({ label: "SGST", amount: order.sgst || 0, kind: "sub" });
  }
  if (order.deliveryFee) rows.push({ label: "Delivery", amount: order.deliveryFee });
  if (order.discount) rows.push({ label: "Discount", amount: -order.discount });
  const total = Number(order.total || 0);
  rows.push({ label: "TOTAL", amount: total, kind: "total" });
  const refunded = Number(order.refunded_amount || 0);
  if (refunded > 0) {
    rows.push({ label: "Refunded", amount: -refunded, kind: "refund" });
    rows.push({ label: "NET PAID", amount: Math.round((total - refunded) * 100) / 100, kind: "total" });
  }
  return rows;
}

export function signedMoney(amount, fmt) {
  return amount < 0 ? `-${fmt(-amount)}` : fmt(amount);
}
