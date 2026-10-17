// Barcode / SKU lookup for the retail checkout.
//
// Scanners and hand-typed codes don't always agree on case or stray
// whitespace, and a product's sizes/colours each carry their own SKU on
// the variant rather than on the product — so match both, ignoring case
// and surrounding whitespace. Returns { item, variant } (variant is null
// for a product-level match) or null when nothing matches.
const norm = (s) => String(s ?? "").trim().toLowerCase();

export function findByCode(menuItems, code) {
  const c = norm(code);
  if (!c) return null;
  for (const item of menuItems || []) {
    if (item.barcode && norm(item.barcode) === c) return { item, variant: null };
  }
  for (const item of menuItems || []) {
    for (const variant of item.variants || []) {
      if (variant.sku && norm(variant.sku) === c) return { item, variant };
    }
  }
  return null;
}

// True when a keydown is going somewhere the user is typing on purpose, so
// the screen-wide scanner capture must leave it alone.
export function isEditableTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || !!el.isContentEditable;
}
