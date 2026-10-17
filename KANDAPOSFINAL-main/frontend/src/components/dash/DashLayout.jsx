import React, { useEffect, useState } from "react";
import { Outlet, NavLink, useNavigate, useLocation, Navigate } from "react-router-dom";
import { useDash, hasPerm, canManagePayroll, canManageLoyalty, canManageCoupons, canManageGiftCards, canManageCustomers, canViewReports, canManageSettings, canManageTeam } from "../../store/DashContext";
import { LayoutDashboard, Users, UserCircle, Boxes, BarChart3, CalendarDays, BookOpen, MapPin, LogOut, KeyRound, PhoneCall, Sparkles, MessageSquare, MessageCircle, Menu as MenuIcon, MoreHorizontal, ClipboardList, PackageX, Banknote, Store, Gift, Ticket, Wallet, Clock, Warehouse, MonitorSmartphone, Globe, ChevronLeft, ChevronRight, Sun, Moon, QrCode, ShieldCheck, TrendingUp } from "lucide-react";
import { Sheet, SheetContent } from "../ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import StoreSwitcher from "./StoreSwitcher";
import { getTheme, toggleTheme } from "../../lib/theme";

// Grouped into the six business verticals of the dashboard blueprint.
// `Schedules` is menu-availability scheduling (day/time price windows), not
// staff shifts, so it sits under Menu & Catalog next to the other
// catalog-shaping tools rather than next to Rota/Payroll.
const NAV_GROUPS = [
  {
    label: "Sales Overview",
    items: [
      { to: "/dashboard", end: true, label: "Overview", icon: LayoutDashboard, allow: () => true },
      { to: "/dashboard/orders", label: "Orders", icon: ClipboardList, allow: () => true },
      { to: "/dashboard/reports", label: "Reports", icon: BarChart3, allow: (u) => canViewReports(u) },
      { to: "/dashboard/digest", label: "Daily Digest", icon: Sparkles, allow: (u) => canViewReports(u), feature: "daily_digest" },
    ],
  },
  {
    label: "Live Outlets",
    items: [
      { to: "/dashboard/locations", label: "Locations", icon: MapPin, allow: () => true },
      { to: "/dashboard/branding", label: "QR Branding", icon: QrCode, allow: (u) => canManageSettings(u), feature: "qr_ordering" },
      { to: "/dashboard/website-orders", label: "Website Orders", icon: Globe, allow: (u) => canManageSettings(u) },
      { to: "/dashboard/brand", label: "Brand", icon: Store, allow: (u) => u?.dash_role === "owner" },
      { to: "/dashboard/central-supply", label: "Central Supply", icon: Warehouse, allow: (u) => u?.dash_role === "owner" && !!u?.brand_id },
    ],
  },
  {
    label: "Menu & Catalog",
    items: [
      { to: "/dashboard/menu", label: "Menu", icon: BookOpen, allow: () => true },
      { to: "/dashboard/stock", label: "Item stock", icon: PackageX, allow: () => true },
      { to: "/dashboard/schedules", label: "Schedules", icon: Clock, allow: () => true },
      { to: "/dashboard/surge", label: "Surge Pricing", icon: TrendingUp, allow: () => true },
      { to: "/dashboard/coupons", label: "Coupons", icon: Ticket, allow: (u) => canManageCoupons(u) },
      { to: "/dashboard/gift-cards", label: "Gift Cards", icon: Wallet, allow: (u) => canManageGiftCards(u) },
      { to: "/dashboard/loyalty", label: "Loyalty", icon: Gift, allow: (u) => canManageLoyalty(u), feature: "loyalty" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { to: "/dashboard/inventory", label: "Inventory", icon: Boxes, allow: () => true, badge: "lowStock" },
      { to: "/dashboard/devices", label: "Kiosk Devices", icon: MonitorSmartphone, allow: () => true },
    ],
  },
  {
    label: "Staff / Shifts",
    items: [
      { to: "/dashboard/staff", label: "Staff", icon: Users, allow: () => true },
      { to: "/dashboard/team", label: "Team & access", icon: ShieldCheck, allow: (u) => canManageTeam(u) },
      { to: "/dashboard/workforce", label: "Rota", icon: CalendarDays, allow: () => true },
      { to: "/dashboard/payroll", label: "Payroll", icon: Banknote, allow: (u) => canManagePayroll(u), feature: "payroll" },
    ],
  },
  {
    label: "Customer CRM",
    items: [
      { to: "/dashboard/customers", label: "Customers", icon: UserCircle, allow: (u) => hasPerm(u, "customers") },
      { to: "/dashboard/sms", label: "Customer SMS", icon: MessageSquare, allow: (u) => canManageCustomers(u), feature: "customer_sms" },
      { to: "/dashboard/whatsapp", label: "WhatsApp", icon: MessageCircle, allow: () => true, feature: "whatsapp" },
      { to: "/dashboard/voice", label: "Voice Agent", icon: PhoneCall, allow: (u) => canManageSettings(u), feature: "voice_agent" },
    ],
  },
];
// Flat view of every item — used for the feature-gate redirect effect and
// kept so that logic doesn't need to know about groups at all.
const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

// The four screens an owner checks most from a phone get a bottom tab each
// on small screens; everything else stays one tap away under "More" (the
// same nav sheet the header's menu button opens).
const MOBILE_TABS = ["/dashboard", "/dashboard/orders", "/dashboard/reports", "/dashboard/menu"];
const MOBILE_TAB_LABELS = { "/dashboard": "Home" };

const SIDEBAR_COLLAPSED_KEY = "kanda_dash_sidebar_collapsed_v1";

// One nav row, shared by the grouped desktop list and the mobile sheet.
// When `collapsed`, the label is dropped in favor of a hover tooltip and the
// row centers its icon — the low-stock badge becomes a plain dot overlay.
function NavRow({ to, end, label, icon: Icon, onNavigate, collapsed, badgeCount }) {
  const row = (
    <NavLink key={to} to={to} end={end} data-testid={`dash-nav-${label.toLowerCase()}`} onClick={onNavigate}
      className={({ isActive }) => `pos-btn relative flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] font-medium ${isActive ? "text-white" : ""} ${collapsed ? "justify-center px-0" : ""}`}
      style={({ isActive }) => ({ background: isActive ? "var(--pos-accent)" : "transparent", color: isActive ? "#fff" : "var(--pos-muted)" })}>
      <Icon className="w-4 h-4 shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && badgeCount > 0 && (
        <span className="ml-auto text-[10px] font-bold px-1.5 rounded-full" style={{ background: "#f59e0b", color: "#2a1a02" }}>{badgeCount}</span>
      )}
      {collapsed && badgeCount > 0 && (
        <span className="absolute top-1 right-1 w-2 h-2 rounded-full" style={{ background: "#f59e0b" }} />
      )}
    </NavLink>
  );
  if (!collapsed) return row;
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="right" style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)", border: "1px solid var(--pos-border)" }}>
        {label}{badgeCount > 0 ? ` · ${badgeCount}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

// Footer action buttons (change password / sign out). Collapses to an icon
// with a tooltip alongside the main nav rows.
function FooterLink({ onClick, onNavigate, icon: Icon, label, collapsed, color, testid }) {
  const content = (
    <>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </>
  );
  const className = `pos-btn w-full flex items-center gap-2 px-3 py-1.5 rounded text-xs ${collapsed ? "justify-center px-0" : ""}`;
  const style = { color: color || "var(--pos-muted)" };

  const el = <button type="button" data-testid={testid} onClick={() => { onNavigate?.(); onClick?.(); }} className={className} style={style}>{content}</button>;

  if (!collapsed) return el;
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{el}</TooltipTrigger>
      <TooltipContent side="right" style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)", border: "1px solid var(--pos-border)" }}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// Plain group label — always visible, not a toggle. Grouping alone (without
// hiding anything behind a click) is the de-clutter mechanism here; density
// (tighter row height/spacing) does the rest.
function GroupHeader({ label }) {
  return (
    <div className="px-3 pb-0.5 pt-1.5 text-[9.5px] font-bold uppercase tracking-wider" style={{ color: "#5c6d8f" }}>
      {label}
    </div>
  );
}

export default function DashLayout() {
  const { user, logout, features, lowStockCount } = useDash();
  const navigate = useNavigate();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"; } catch { return false; }
  });
  const [theme, setTheme] = useState(getTheme);

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0"); } catch { /* ignore */ }
  }, [collapsed]);

  const visibleGroups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => i.allow(user) && (!i.feature || features[i.feature])) }))
    .filter((g) => g.items.length > 0);

  // A feature turned off, or a section the owner hasn't given this person,
  // shouldn't be reachable by direct URL either. (The API refuses it anyway;
  // this just avoids a screen full of errors.)
  useEffect(() => {
    if (!user) return;
    const blocked = NAV_ITEMS.find((i) => i.to !== "/dashboard" && location.pathname.startsWith(i.to)
      && ((i.feature && !features[i.feature]) || !i.allow(user)));
    if (blocked) navigate("/dashboard", { replace: true });
  }, [location.pathname, features, user, navigate]);

  if (!user) return <Navigate to="/dashboard/login" replace />;
  if (user.must_change_password) return <Navigate to="/dashboard/account/password" replace />;
  const mobileTabs = MOBILE_TABS.map((to) => visibleGroups.flatMap((g) => g.items).find((i) => i.to === to)).filter(Boolean);
  const roleLabel = { owner: "Restaurant Owner", area_manager: "Area Manager", manager: "Store Manager" }[user.dash_role] || user.dash_role;
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  const NavItems = ({ onNavigate, collapsed: navCollapsed = false }) => (
    <>
      <nav className="flex-1 min-h-0 p-2 space-y-0.5 overflow-y-auto">
        {visibleGroups.map((group) => (
          <div key={group.label}>
            {!navCollapsed && <GroupHeader label={group.label} />}
            <div className="space-y-0.5">
              {group.items.map(({ to, end, label, icon, badge }) => (
                <NavRow key={to} to={to} end={end} label={label} icon={icon} onNavigate={onNavigate}
                  collapsed={navCollapsed} badgeCount={badge === "lowStock" ? lowStockCount : 0} />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="p-2 space-y-0.5" style={{ borderTop: "1px solid var(--pos-border)" }}>
        <div className={`flex items-center gap-2.5 rounded-md p-2 ${navCollapsed ? "justify-center" : ""}`} style={{ background: "var(--pos-panel-2)" }}>
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0" style={{ background: "var(--pos-accent)", color: "#1a0e04" }}>{initials}</div>
          {!navCollapsed && (
            <div className="min-w-0">
              <div className="text-xs font-bold truncate" style={{ color: "var(--pos-text)" }}>{user.name}</div>
              <div className="text-[10px]" style={{ color: "var(--pos-muted)" }}>{roleLabel}</div>
            </div>
          )}
        </div>
        <FooterLink onNavigate={onNavigate} icon={KeyRound} label="Change password" collapsed={navCollapsed}
          onClick={() => navigate("/dashboard/account/password")} testid="dash-password-btn" />
        <FooterLink icon={theme === "dark" ? Sun : Moon} label={theme === "dark" ? "Light mode" : "Dark mode"} collapsed={navCollapsed}
          onClick={() => setTheme(toggleTheme())} testid="dash-theme-toggle" />
        <FooterLink onNavigate={onNavigate} icon={LogOut} label="Sign out" collapsed={navCollapsed}
          onClick={() => { logout(); navigate("/dashboard/login"); }} color="#f87171" testid="dash-logout-btn" />
      </div>
    </>
  );

  return (
    <TooltipProvider>
      <div className="h-screen flex flex-col md:flex-row lg-ambient" style={{ backgroundColor: "var(--pos-bg)" }} data-testid="dash-layout">
        {/* Mobile top bar — liquid glass, floats over the scrolling page */}
        <header className="md:hidden lg-glass fixed top-0 inset-x-0 z-40 flex items-center justify-between px-4"
          style={{ borderWidth: "0 0 1px 0", paddingTop: "var(--safe-top)", height: "calc(3.5rem + var(--safe-top))" }}>
          <div className="flex items-center gap-2">
            <img src="/icon-192.png" alt="Kanda POS" className="w-7 h-7 rounded-md shrink-0" />
            <div className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>KANDA Dashboard</div>
          </div>
          <button data-testid="dash-mobile-menu-btn" onClick={() => setNavOpen(true)}
            className="pos-btn w-10 h-10 flex items-center justify-center rounded-lg" style={{ color: "var(--pos-muted)" }}>
            <MenuIcon className="w-5 h-5" />
          </button>
        </header>

        {/* Desktop sidebar */}
        <aside className={`hidden md:flex shrink-0 flex-col transition-[width] duration-150 ${collapsed ? "w-[68px]" : "w-60"}`}
          style={{ background: "var(--pos-panel)", borderRight: "1px solid var(--pos-border)" }}>
          <div className={`p-4 flex items-center gap-2 ${collapsed ? "justify-center px-2" : ""}`} style={{ borderBottom: "1px solid var(--pos-border)" }}>
            <img src="/icon-192.png" alt="Kanda POS" className="w-7 h-7 rounded-md shrink-0" />
            {!collapsed && (
              <div className="leading-tight min-w-0">
                <div className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>KANDA</div>
                <div className="text-[10px] tracking-wider uppercase" style={{ color: "var(--pos-muted)" }}>Dashboard</div>
              </div>
            )}
            {!collapsed && (
              <button data-testid="dash-collapse-btn" onClick={() => setCollapsed(true)} title="Collapse sidebar"
                className="pos-btn ml-auto w-6 h-6 rounded flex items-center justify-center" style={{ color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {collapsed && (
            <button data-testid="dash-expand-btn" onClick={() => setCollapsed(false)} title="Expand sidebar"
              className="pos-btn mx-auto mt-2 w-6 h-6 rounded flex items-center justify-center" style={{ color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
          {!collapsed && <StoreSwitcher />}
          <NavItems collapsed={collapsed} />
        </aside>

        {/* Mobile nav sheet — always renders expanded, independent of the desktop collapse state */}
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent side="left" className="lg-glass-strong w-72 p-0 flex flex-col border-r" data-testid="dash-mobile-nav-sheet"
            style={{ background: "var(--lg-sheet)", paddingTop: "var(--safe-top)", paddingBottom: "var(--safe-bottom)" }}>
            <div className="p-4 flex items-center gap-2" style={{ borderBottom: "1px solid var(--pos-border)" }}>
              <img src="/icon-192.png" alt="Kanda POS" className="w-7 h-7 rounded-md shrink-0" />
              <div className="leading-tight">
                <div className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>KANDA</div>
                <div className="text-[10px] tracking-wider uppercase" style={{ color: "var(--pos-muted)" }}>Dashboard</div>
              </div>
            </div>
            <StoreSwitcher />
            <NavItems onNavigate={() => setNavOpen(false)} />
          </SheetContent>
        </Sheet>

        <main className="flex-1 min-h-0 overflow-auto pt-[calc(3.5rem+var(--safe-top))] pb-[calc(6rem+var(--safe-bottom))] md:pt-0 md:pb-0">
          <Outlet />
        </main>

        {/* Mobile tab bar — a floating liquid-glass pill, iOS-style, used on
            Android too. The active tab sits on a tinted lens. */}
        <nav className="md:hidden lg-glass-strong fixed inset-x-3 z-40 grid p-1.5 rounded-[30px]" data-testid="dash-mobile-tabs"
          style={{ bottom: "calc(0.75rem + var(--safe-bottom))", height: "4.25rem", gridTemplateColumns: `repeat(${mobileTabs.length + 1}, minmax(0, 1fr))` }}>
          {mobileTabs.map(({ to, end, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={end} data-testid={`dash-tab-${label.toLowerCase()}`}
              className="lg-press flex flex-col items-center justify-center gap-0.5 rounded-[24px] text-[10px] font-semibold"
              style={({ isActive }) => ({ color: isActive ? "var(--pos-accent)" : "var(--pos-muted)", background: isActive ? "rgba(249,115,22,0.13)" : "transparent" })}>
              <Icon className="w-5 h-5" />
              {MOBILE_TAB_LABELS[to] || label}
            </NavLink>
          ))}
          <button type="button" data-testid="dash-tab-more" onClick={() => setNavOpen(true)}
            className="lg-press flex flex-col items-center justify-center gap-0.5 rounded-[24px] text-[10px] font-semibold" style={{ color: "var(--pos-muted)" }}>
            <MoreHorizontal className="w-5 h-5" />
            More
          </button>
        </nav>
      </div>
    </TooltipProvider>
  );
}
