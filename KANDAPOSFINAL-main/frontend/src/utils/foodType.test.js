import { filterStorefrontItems, FOOD_TYPES } from "./foodType";

const ITEMS = [
  { id: "1", catId: "starters", name: "Paneer Tikka", foodType: "veg" },
  { id: "2", catId: "starters", name: "Chicken 65", foodType: "nonveg", desc: "spicy fried chicken" },
  { id: "3", catId: "mains", name: "Egg Curry", foodType: "egg" },
  { id: "4", catId: "mains", name: "Paneer Butter Masala", foodType: "veg" },
  { id: "5", catId: "drinks", name: "Masala Chai" },
];

const ids = (list) => list.map((i) => i.id);

describe("filterStorefrontItems", () => {
  it("shows the active category when there is no search", () => {
    expect(ids(filterStorefrontItems(ITEMS, { catId: "starters" }))).toEqual(["1", "2"]);
  });

  it("searches name and description across every category", () => {
    expect(ids(filterStorefrontItems(ITEMS, { catId: "drinks", query: "paneer" }))).toEqual(["1", "4"]);
    expect(ids(filterStorefrontItems(ITEMS, { catId: "mains", query: "SPICY" }))).toEqual(["2"]);
  });

  it("veg only keeps just items marked veg", () => {
    expect(ids(filterStorefrontItems(ITEMS, { catId: "mains", vegOnly: true }))).toEqual(["4"]);
    expect(ids(filterStorefrontItems(ITEMS, { catId: "starters", query: "a", vegOnly: true }))).toEqual(["1", "4"]);
  });
});

it("labels every food type", () => {
  expect(Object.keys(FOOD_TYPES)).toEqual(["veg", "egg", "nonveg"]);
  Object.values(FOOD_TYPES).forEach((t) => { expect(t.label).toBeTruthy(); expect(t.color).toMatch(/^#/); });
});
