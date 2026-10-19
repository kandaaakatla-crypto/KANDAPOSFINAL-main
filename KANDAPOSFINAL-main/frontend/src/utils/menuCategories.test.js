import { sortCategories, pickActiveCategory, visibleMenuItems } from "./menuCategories";

// A new restaurant's own categories, none of which exist in the demo data.
const cats = [
  { id: "c-mains", name: "Mains", color: "#ef4444", sort_order: 20 },
  { id: "c-starters", name: "Starters", color: "#f59e0b", sort_order: 10 },
  { id: "c-gone", name: "Old", color: "#999", sort_order: 5, deleted_at: "2026-10-01" },
];
const items = [
  { id: "1", name: "Paneer Tikka", catId: "c-starters" },
  { id: "2", name: "Dal Makhani", catId: "c-mains" },
  { id: "3", name: "Paneer Butter Masala", catId: "c-mains" },
];

test("sorts by sort_order and drops deleted categories", () => {
  expect(sortCategories(cats).map((c) => c.id)).toEqual(["c-starters", "c-mains"]);
});

test("defaults to the first real category, not a demo id", () => {
  const sorted = sortCategories(cats);
  expect(pickActiveCategory(sorted, "pizzas")).toBe("c-starters");
  expect(pickActiveCategory(sorted, "c-mains")).toBe("c-mains");
  expect(pickActiveCategory([], "pizzas")).toBe(null);
});

test("a new tenant sees its items under its own categories", () => {
  const sorted = sortCategories(cats);
  const active = pickActiveCategory(sorted, "pizzas");
  expect(visibleMenuItems(items, active, "").map((i) => i.id)).toEqual(["1"]);
});

test("search looks across every category", () => {
  expect(visibleMenuItems(items, "c-starters", "paneer").map((i) => i.id)).toEqual(["1", "3"]);
  expect(visibleMenuItems(items, "c-starters", "  DAL ").map((i) => i.id)).toEqual(["2"]);
});
