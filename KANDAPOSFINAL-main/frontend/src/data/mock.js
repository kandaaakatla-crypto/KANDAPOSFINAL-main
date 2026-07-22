// Static UI constants for the POS frontend (non-data).
// All business data is now loaded from the backend via /api endpoints.

export const PIZZA_SIZES = [
  { id: "sm", label: '9.5" Small', short: "S" },
  { id: "md", label: '12" Medium', short: "M" },
  { id: "lg", label: '15" Large', short: "L" },
];

export const TOPPINGS = [
  "Pepperoni", "Mushrooms", "Red Onions", "Green Peppers", "Sweetcorn",
  "Jalapenos", "Pineapple", "Ham", "BBQ Chicken", "Spicy Beef",
  "Smoked Bacon", "Black Olives", "Fresh Tomatoes", "Extra Cheese",
];

export const TOPPING_PRICE = { sm: 0.9, md: 1.2, lg: 1.5 };

// Mirror of seeded categories used for static colour theming + order.
// Backend /api/menu/categories returns the same set; this is purely for UI tokens.
export const CATEGORIES = [
  { id: "deals",    name: "Meal Deals",       color: "#f59e0b" },
  { id: "pizzas",   name: "Pizzas",            color: "#ef4444" },
  { id: "sides",    name: "Sides",             color: "#f97316" },
  { id: "chicken",  name: "Chicken",           color: "#d97706" },
  { id: "burgers",  name: "Burgers & Wraps",   color: "#84cc16" },
  { id: "drinks",   name: "Drinks",            color: "#3b82f6" },
  { id: "desserts", name: "Desserts",          color: "#ec4899" },
];

export const DELIVERY_FEE = 2.5;

// Demo PIN hints rendered on the login screen (matches seeded staff for first boot).
export const DEMO_STAFF_HINTS = [
  { id: "s1", name: "Aarav Reddy",  pin: "1234", role: "Manager" },
  { id: "s2", name: "Priya Iyer",   pin: "2345", role: "Cashier" },
  { id: "s3", name: "Rohan Sharma", pin: "3456", role: "Cashier" },
  { id: "s4", name: "Karthik Rao",  pin: "4567", role: "Driver" },
];
