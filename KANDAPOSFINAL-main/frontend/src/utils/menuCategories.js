// The tenant's live categories in menu order (soft-deleted ones hidden).
export function sortCategories(categories) {
  return (categories || [])
    .filter((c) => !c.deleted_at)
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name).localeCompare(String(b.name)));
}

// Keep the current pick if it still exists, else fall back to the first category.
export function pickActiveCategory(sorted, current) {
  if (sorted.some((c) => c.id === current)) return current;
  return sorted[0]?.id ?? null;
}

// A search term looks across all categories; otherwise show the active one.
export function visibleMenuItems(items, activeCat, query) {
  const q = (query || "").trim().toLowerCase();
  if (q) return items.filter((m) => String(m.name).toLowerCase().includes(q));
  return items.filter((m) => m.catId === activeCat);
}
