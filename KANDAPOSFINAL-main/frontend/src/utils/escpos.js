// Client-side ESC/POS receipt/KOT byte generation — a 1:1 port of
// backend/receipts.py's _build_escpos() so a thermal-printer receipt can be
// produced with no server round trip (the offline-printing requirement from
// the cloud-native/local-resilience plan). Keep this in sync with the Python
// version if either changes; the backend endpoint (GET
// /orders/{id}/receipt/escpos) stays in place for on-demand server-side
// reprint/audit, not as the primary print path anymore.

const ESC = 0x1b;
const GS = 0x1d;
const INIT = [ESC, 0x40];
const ALIGN_LEFT = [ESC, 0x61, 0x00];
const ALIGN_CENTER = [ESC, 0x61, 0x01];
const BOLD_ON = [ESC, 0x45, 0x01];
const BOLD_OFF = [ESC, 0x45, 0x00];
const DBL_ON = [GS, 0x21, 0x11];
const DBL_OFF = [GS, 0x21, 0x00];
const LF = [0x0a];
const CUT = [GS, 0x56, 0x42, 0x00];

class ByteBuilder {
  constructor() { this.bytes = []; }
  push(...arrs) { for (const a of arrs) this.bytes.push(...a); return this; }
  line(s) {
    // ESC/POS printers speak single-byte code pages (cp437 on the backend).
    // This app's receipt content is ASCII-only in practice (currency is
    // rendered as "Rs.", not "₹" — see money() below), so a straight
    // char-code passthrough for 0x00-0x7F with "?" for anything wider is a
    // faithful match for cp437's ASCII-compatible range without pulling in
    // a full code-page table for characters that never actually appear.
    for (const ch of String(s)) {
      const code = ch.codePointAt(0);
      this.bytes.push(code <= 0x7f ? code : 0x3f);
    }
    this.bytes.push(...LF);
    return this;
  }
  row(left, right, width = 32) {
    const pad = Math.max(1, width - left.length - right.length);
    return this.line(left + " ".repeat(pad) + right);
  }
  toUint8Array() { return new Uint8Array(this.bytes); }
}

function money(v) {
  return `Rs.${Number(v || 0).toFixed(2)}`;
}

// order: the Order shape from the API (see api/client.js ordersApi).
// store: tenant.store (or a fallback with name/address/phone/tax_id/footer).
// kind: "customer" | "kitchen"
export function buildEscposReceipt(order, store, kind = "customer") {
  const b = new ByteBuilder();
  b.push(INIT, ALIGN_CENTER);
  b.push(BOLD_ON, DBL_ON).line(store.name).push(DBL_OFF, BOLD_OFF);
  if (kind === "kitchen") {
    b.push(BOLD_ON, DBL_ON).line("*** KITCHEN ***").push(DBL_OFF, BOLD_OFF);
  } else {
    b.line(store.address || "");
    b.line("Tel " + (store.phone || ""));
    b.line(store.tax_id || store.vat || "");
  }
  b.line("-".repeat(32));

  b.push(ALIGN_LEFT);
  b.row("Order #" + (order.number ?? ""), String(order.type || "").toUpperCase());
  b.line("Time " + String(order.placedAt || "").slice(0, 19).replace("T", " "));
  const cust = order.customer || {};
  if (cust.name) b.line("For  " + cust.name);
  if (cust.address) b.line(String(cust.address).slice(0, 32));
  if (cust.postcode) b.line(cust.postcode);
  if (order.table) b.line("Table " + order.table);
  b.line("-".repeat(32));

  b.push(BOLD_ON);
  for (const it of order.items || []) {
    const line = `${it.qty}x ${it.name}`.slice(0, 24);
    if (kind === "kitchen") {
      b.line(line);
    } else {
      b.row(line, money(it.qty * it.price));
    }
    for (const mod of it.mods || []) {
      b.line("   " + String(mod).slice(0, 28));
    }
  }
  b.push(BOLD_OFF);

  if (kind !== "kitchen") {
    b.line("-".repeat(32));
    const subtotal = order.subtotal ?? (order.items || []).reduce((s, it) => s + it.qty * it.price, 0);
    b.row("Subtotal", money(subtotal));
    if (order.taxTotal) {
      const taxLabel = order.taxInclusive ? "GST (incl.)" : "GST";
      b.row(taxLabel, money(order.taxTotal));
      b.row("  CGST", money(order.cgst || 0));
      b.row("  SGST", money(order.sgst || 0));
    }
    if (order.deliveryFee) b.row("Delivery", money(order.deliveryFee));
    if (order.discount) b.row("Discount", "-" + money(order.discount));
    b.row("TOTAL", money(order.total || 0));
    b.line("-".repeat(32));
    b.row("Paid by", String(order.payment || "?").toUpperCase());
    if (order.razorpayPaymentId) b.line("Ref " + order.razorpayPaymentId);
    b.push(LF);
    b.push(ALIGN_CENTER).line(store.footer || "");
  }

  b.push(LF, LF, LF, CUT);
  return b.toUint8Array();
}

// Trigger a browser download of the raw ESC/POS bytes — same UX as the
// existing server-side download (receiptsApi.downloadEscpos in api/client.js),
// but generated locally so it works with no network at all.
export function downloadEscposReceipt(order, store, kind, filenameOrderId) {
  const bytes = buildEscposReceipt(order, store, kind);
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `receipt_${filenameOrderId || order.id}_${kind}.bin`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
