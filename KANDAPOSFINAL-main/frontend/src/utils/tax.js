// Client-side mirror of backend/tax.py's line/order GST math, so checkout
// screens can preview the exact breakdown the server will compute and store.
// Rate RESOLUTION happens server-side (categories/items already carry a
// concrete tax_rate by the time they reach the frontend); this file only
// does the arithmetic, not the auto-suggestion.

/** Effective GST % for a cart line: item override > category rate > 0. */
export function effectiveTaxRate(menuItem, category) {
  if (menuItem?.tax_rate != null) return menuItem.tax_rate;
  if (category?.tax_rate != null) return category.tax_rate;
  return 0;
}

/** (taxableValue, taxAmount) for one line — mirrors tax.compute_line_tax. */
export function computeLineTax(price, qty, rate, inclusive) {
  const gross = Math.round(price * qty * 100) / 100;
  if (!rate || rate <= 0) return [gross, 0];
  if (inclusive) {
    const taxable = Math.round((gross / (1 + rate / 100)) * 100) / 100;
    return [taxable, Math.round((gross - taxable) * 100) / 100];
  }
  return [gross, Math.round((gross * rate) / 100 * 100) / 100];
}

/** Aggregate per-line (taxable, tax) pairs into an order-level breakdown. */
export function computeOrderTax(lineAmounts) {
  const subtotal = Math.round(lineAmounts.reduce((s, [t]) => s + t, 0) * 100) / 100;
  const taxTotal = Math.round(lineAmounts.reduce((s, [, x]) => s + x, 0) * 100) / 100;
  const itemsTotal = Math.round((subtotal + taxTotal) * 100) / 100;
  const [cgst, sgst] = splitCgstSgst(taxTotal);
  return { itemsTotal, subtotal, taxTotal, cgst, sgst };
}

const toPaise = (x) => Math.round(Number(x || 0) * 100);

/** 50/50 CGST/SGST, odd paisa to SGST — mirrors tax.split_cgst_sgst. */
export function splitCgstSgst(taxTotal) {
  const total = toPaise(taxTotal);
  const cgst = Math.floor(total / 2);
  return [cgst / 100, (total - cgst) / 100];
}

/** Take a discount off the taxable value and re-derive GST on what's left —
 * mirrors tax.apply_taxable_discount exactly (integer paise, half-up).
 * `inclusive` = retail MRP (discount comes off the gross). Returns the same
 * shape as computeOrderTax. */
export function applyTaxableDiscount(order, discount, inclusive) {
  const subP = toPaise(order.subtotal);
  const taxP = toPaise(order.taxTotal);
  const baseP = inclusive ? subP + taxP : subP;
  const dP = Math.max(0, Math.min(toPaise(discount), baseP));
  if (dP === 0 || baseP === 0) return order;
  const leftP = baseP - dP;
  const newTaxP = Math.floor((taxP * leftP * 2 + baseP) / (2 * baseP));
  const newSubP = inclusive ? leftP - newTaxP : leftP;
  const itemsP = inclusive ? leftP : leftP + newTaxP;
  const taxTotal = newTaxP / 100;
  const [cgst, sgst] = splitCgstSgst(taxTotal);
  return { itemsTotal: itemsP / 100, subtotal: newSubP / 100, taxTotal, cgst, sgst };
}

/** Optional service charge → [charge, gstOnCharge] — mirrors
 * tax.compute_service_charge: pct of the taxable subtotal, taxed at the
 * bill's own effective GST rate. */
export function computeServiceCharge(subtotal, taxTotal, pct) {
  if (!pct || pct <= 0 || !(subtotal > 0)) return [0, 0];
  const charge = Math.round(subtotal * pct) / 100;
  return [charge, Math.round((charge * taxTotal / subtotal) * 100) / 100];
}
