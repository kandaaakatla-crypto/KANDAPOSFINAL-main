// The veg / egg / non-veg mark Indian menus print next to each dish: a
// coloured dot in a square of the same colour. Order here is the order the
// dashboard offers them in.
export const FOOD_TYPES = {
  veg: { label: "Veg", color: "#16a34a" },
  egg: { label: "Egg", color: "#ca8a04" },
  nonveg: { label: "Non-veg", color: "#b91c1c" },
};

// What a QR guest sees in the grid. A search looks across the whole menu,
// not just the open category, because guests search when they can't find
// where a dish lives.
export function filterStorefrontItems(items, { catId, query = "", vegOnly = false }) {
  const q = query.trim().toLowerCase();
  return (items || []).filter((item) => {
    if (vegOnly && item.foodType !== "veg") return false;
    if (q) return `${item.name || ""} ${item.desc || ""}`.toLowerCase().includes(q);
    return item.catId === catId;
  });
}
