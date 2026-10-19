import { LayoutDashboard, Users, UserCircle, Boxes, BarChart3, BookOpen, Store, Ticket, Warehouse, Settings } from "lucide-react";
import { hasPerm, canManagePayroll, canManageLoyalty, canManageCoupons, canManageGiftCards, canManageCustomers, canViewReports, canManageSettings, canManageTeam } from "../../store/DashContext";

// The dashboard sidebar: one row per section. A section with more than one
// tab shows a tab strip (DashTabGroup) above its pages; every tab keeps the
// page's original URL, so old links and bookmarks still land in the right
// place. A row links to its first tab the person can open.
//
// `allow(user)` and `feature` gate each tab exactly as the old flat sidebar
// gated each page; a section is shown when at least one tab is visible.
const all = () => true;

export const NAV_SECTIONS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, tabs: [
    { to: "/dashboard", end: true, label: "Overview", allow: all },
  ] },
  { key: "reports", label: "Reports", icon: BarChart3, tabs: [
    { to: "/dashboard/reports", label: "Sales", allow: (u) => canViewReports(u) },
    { to: "/dashboard/digest", label: "Email me this daily", allow: (u) => canViewReports(u), feature: "daily_digest" },
  ] },
  { key: "menu", label: "Menu", icon: BookOpen, tabs: [
    { to: "/dashboard/menu", label: "Menu", allow: all },
  ] },
  { key: "promotions", label: "Promotions", icon: Ticket, tabs: [
    { to: "/dashboard/coupons", label: "Coupons", allow: (u) => canManageCoupons(u) },
    { to: "/dashboard/schedules", label: "Happy hours & schedules", allow: all },
    { to: "/dashboard/surge", label: "Swiggy/Zomato markups", allow: all },
  ] },
  { key: "inventory", label: "Inventory", icon: Boxes, badge: "lowStock", tabs: [
    { to: "/dashboard/inventory", label: "Inventory", allow: all },
  ] },
  { key: "customers", label: "Customers", icon: UserCircle, tabs: [
    { to: "/dashboard/customers", label: "List", allow: (u) => hasPerm(u, "customers") },
    { to: "/dashboard/loyalty", label: "Loyalty", allow: (u) => canManageLoyalty(u), feature: "loyalty" },
    { to: "/dashboard/gift-cards", label: "Gift cards", allow: (u) => canManageGiftCards(u) },
    { to: "/dashboard/sms", label: "SMS campaigns", allow: (u) => canManageCustomers(u), feature: "customer_sms" },
    { to: "/dashboard/whatsapp", label: "WhatsApp", allow: all, feature: "whatsapp" },
  ] },
  { key: "staff", label: "Staff", icon: Users, tabs: [
    { to: "/dashboard/staff", label: "People", allow: all },
    { to: "/dashboard/team", label: "Team & access", allow: (u) => canManageTeam(u) },
    { to: "/dashboard/workforce", label: "Rota", allow: all },
    { to: "/dashboard/payroll", label: "Payroll", allow: (u) => canManagePayroll(u), feature: "payroll" },
  ] },
  { key: "settings", label: "Settings", icon: Settings, tabs: [
    { to: "/dashboard/business", label: "Business", allow: (u) => canManageSettings(u) },
    { to: "/dashboard/devices", label: "Devices & screens", allow: all },
    { to: "/dashboard/branding", label: "QR branding", allow: (u) => canManageSettings(u), feature: "qr_ordering" },
    { to: "/dashboard/website-orders", label: "Website orders", allow: (u) => canManageSettings(u) },
    { to: "/dashboard/voice", label: "AI phone agent", allow: (u) => canManageSettings(u), feature: "voice_agent" },
  ] },
  // Brand owners only.
  { key: "brand", label: "Brand", icon: Store, tabs: [
    { to: "/dashboard/brand", label: "Brand", allow: (u) => u?.dash_role === "owner" },
  ] },
  { key: "central-supply", label: "Central Supply", icon: Warehouse, tabs: [
    { to: "/dashboard/central-supply", label: "Central Supply", allow: (u) => u?.dash_role === "owner" && !!u?.brand_id },
  ] },
];

// Pages kept reachable by URL (and from links elsewhere, e.g. "Add location"
// on Overview) but not shown in the sidebar for launch.
export const HIDDEN_PAGES = [
  { to: "/dashboard/locations", label: "Locations", allow: all },
];

// Every gated page, for the "not allowed / feature off" redirect.
export const ALL_PAGES = [...NAV_SECTIONS.flatMap((s) => s.tabs), ...HIDDEN_PAGES];

export const tabVisible = (tab, user, features) => tab.allow(user) && (!tab.feature || !!features?.[tab.feature]);

export const visibleTabs = (section, user, features) => section.tabs.filter((t) => tabVisible(t, user, features));

export const sectionByKey = (key) => NAV_SECTIONS.find((s) => s.key === key);

const trimSlash = (p) => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);

export const tabMatches = (tab, pathname) => {
  const p = trimSlash(pathname);
  return tab.end ? p === tab.to : p === tab.to || p.startsWith(`${tab.to}/`);
};
