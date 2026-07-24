// Static UI constants for the POS frontend (non-data).
// All business data is now loaded from the backend via /api endpoints.

export const PIZZA_SIZES = [
  { id: "sm", label: '9.5" Small', short: "S" },
  { id: "md", label: '12" Medium', short: "M" },
  { id: "lg", label: '15" Large', short: "L" },
];

export const TOPPINGS = [
  "Pepperoni", "Mushrooms", "Red Onions", "Green Peppers", "Sweetcorn",
  "Jalapenos", "Pineapple", "Chicken Sausage", "BBQ Chicken", "Chicken Keema",
  "Paneer", "Black Olives", "Fresh Tomatoes", "Extra Cheese",
];

export const TOPPING_PRICE = { sm: 20, md: 30, lg: 40 };

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

export const DELIVERY_FEE = 49;

// Demo PIN hints rendered on the login screen (matches seeded staff for first boot).
export const DEMO_STAFF_HINTS = [
  { id: "s1",  name: "Aarav Reddy",  pin: "1234", role: "Manager" },
  { id: "s2",  name: "Priya Iyer",   pin: "2345", role: "Cashier" },
  { id: "s3",  name: "Rohan Sharma", pin: "3456", role: "Cashier" },
  { id: "s7",  name: "Ananya Gupta", pin: "7890", role: "Cashier" },
  { id: "s8",  name: "Rahul Verma",  pin: "8901", role: "Cashier" },
  { id: "s5",  name: "Meera Nair",   pin: "5678", role: "Kitchen" },
  { id: "s6",  name: "Vikram Desai", pin: "6789", role: "Kitchen" },
  { id: "s4",  name: "Karthik Rao",  pin: "4567", role: "Driver" },
  { id: "s9",  name: "Sanjay Kumar", pin: "9012", role: "Driver" },
  { id: "s10", name: "Divya Menon",  pin: "1235", role: "Driver" },
  { id: "s11", name: "Arjun Nair",   pin: "1236", role: "Driver" },
];
