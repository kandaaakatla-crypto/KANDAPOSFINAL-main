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
  const cgst = Math.round((taxTotal / 2) * 100) / 100;
  return { itemsTotal, subtotal, taxTotal, cgst, sgst: Math.round((taxTotal - cgst) * 100) / 100 };
}
