import React, { act } from "react";
import { createRoot } from "react-dom/client";

// Jest can't resolve react-router v7's package exports here; stand in the
// handful of pieces the dashboard shell uses.
let mockPath = "/dashboard";
jest.mock("react-router-dom", () => {
  const R = require("react");
  const resolve = (v, arg) => (typeof v === "function" ? v(arg) : v);
  const NavLink = ({ to, end, className, style, children, ...rest }) => {
    const isActive = end ? mockPath === to : mockPath === to || mockPath.startsWith(`${to}/`);
    return R.createElement("a", { href: to, className: resolve(className, { isActive }), style: resolve(style, { isActive }), ...rest }, children);
  };
  return {
    NavLink,
    Link: NavLink,
    Outlet: () => R.createElement("div", { "data-testid": "outlet" }),
    Navigate: () => null,
    useNavigate: () => jest.fn(),
    useLocation: () => ({ pathname: mockPath }),
  };
}, { virtual: true });

// shadcn components import the "@/" alias, which Jest doesn't map. The
// mobile sheet renders nothing here so only the desktop sidebar is counted.
jest.mock("../ui/sheet", () => ({ Sheet: () => null, SheetContent: () => null }));
jest.mock("../ui/tooltip", () => {
  const R = require("react");
  const Pass = ({ children }) => R.createElement(R.Fragment, null, children);
  return { Tooltip: Pass, TooltipContent: () => null, TooltipProvider: Pass, TooltipTrigger: Pass };
});
jest.mock("./StoreSwitcher", () => () => null);
jest.mock("../../api/client", () => ({ dashApi: {}, brandApi: {} }));

const ALL_FEATURES = {
  qr_ordering: true, loyalty: true, voice_agent: true, customer_sms: true, whatsapp: true, daily_digest: true, payroll: true,
};
let mockDash;
jest.mock("../../store/DashContext", () => ({
  ...jest.requireActual("../../store/DashContext"),
  useDash: () => mockDash,
}));

// eslint-disable-next-line import/first
import DashLayout from "./DashLayout";

const CORE = ["Overview", "Reports", "Menu", "Promotions", "Inventory", "Customers", "Staff", "Settings"];

let container;
let root;

beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });

beforeEach(() => {
  mockPath = "/dashboard";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function setUser(user) {
  mockDash = { user, logout: jest.fn(), features: ALL_FEATURES, lowStockCount: 0 };
}

const sidebarLabels = () =>
  Array.from(container.querySelector("aside nav").querySelectorAll("a")).map((a) => a.textContent.trim());

test("sidebar shows the launch menu items to a store manager", async () => {
  setUser({ name: "Asha Rao", dash_role: "manager", permissions: {
    reports: true, coupons: true, loyalty: true, gift_cards: true, customers: true, customer_admin: true, payroll: true, settings: true,
  } });
  await act(async () => { root.render(<DashLayout />); });
  expect(sidebarLabels()).toEqual(CORE);
});

test("brand owners also get Brand and Central Supply", async () => {
  setUser({ name: "Ravi Kumar", dash_role: "owner", brand_id: "b1" });
  await act(async () => { root.render(<DashLayout />); });
  expect(sidebarLabels()).toEqual([...CORE, "Brand", "Central Supply"]);
});

test("a section stays highlighted on any of its tabs", async () => {
  setUser({ name: "Ravi Kumar", dash_role: "owner" });
  mockPath = "/dashboard/surge";
  await act(async () => { root.render(<DashLayout />); });
  // The active row is the one painted white-on-accent.
  const promotions = container.querySelector('aside [data-testid="dash-nav-promotions"]');
  const overview = container.querySelector('aside [data-testid="dash-nav-overview"]');
  expect(promotions.classList.contains("text-white")).toBe(true);
  expect(overview.classList.contains("text-white")).toBe(false);
});

test("a tab group renders its tabs above the page", async () => {
  setUser({ name: "Ravi Kumar", dash_role: "owner" });
  mockPath = "/dashboard/coupons";
  const DashTabGroup = require("./DashTabGroup").default;
  await act(async () => { root.render(<DashTabGroup section="promotions" />); });
  const tabs = Array.from(container.querySelectorAll('[data-testid="dash-tabs"] a'));
  expect(tabs.map((a) => [a.textContent.trim(), a.getAttribute("href")])).toEqual([
    ["Coupons", "/dashboard/coupons"],
    ["Happy hours & schedules", "/dashboard/schedules"],
    ["Swiggy/Zomato markups", "/dashboard/surge"],
  ]);
  expect(container.querySelector('[data-testid="outlet"]')).not.toBeNull();
});

test("tabs the user can't open are left out", async () => {
  setUser({ name: "Asha Rao", dash_role: "manager", permissions: {} });
  mockPath = "/dashboard/schedules";
  const DashTabGroup = require("./DashTabGroup").default;
  await act(async () => { root.render(<DashTabGroup section="promotions" />); });
  const labels = Array.from(container.querySelectorAll('[data-testid="dash-tabs"] a')).map((a) => a.textContent.trim());
  expect(labels).toEqual(["Happy hours & schedules", "Swiggy/Zomato markups"]);
});
