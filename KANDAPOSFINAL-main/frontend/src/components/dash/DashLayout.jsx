import React, { useEffect, useState } from "react";
import { Outlet, NavLink, Link, useNavigate, useLocation, Navigate } from "react-router-dom";
import { useDash, canManageStaff, canAddLocation, canManagePayroll, canManageLoyalty, canManageCoupons, canManageGiftCards } from "../../store/DashContext";
import { Building2, LayoutDashboard, Users, UserCircle, Boxes, BarChart3, CalendarDays, BookOpen, MapPin, LogOut, KeyRound, PhoneCall, Sparkles, MessageSquare, MessageCircle, Menu as MenuIcon, Banknote, Store, Gift, Ticket, Wallet, Clock, Warehouse, MonitorSmartphone, ChevronLeft, ChevronRight, Settings, Receipt, Code2, LifeBuoy } from "lucide-react";
import { Sheet, SheetContent } from "../ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import StoreSwitcher from "./StoreSwitcher";

// Grouped into the six business verticals of the dashboard blueprint.
// `Schedules` is menu-availability scheduling (day/time price windows), not
// staff shifts, so it sits under Menu & Catalog next to the other
// catalog-shaping tools rather than next to Rota/Payroll.
const NAV_GROUPS = [
  {
    label: "Sales Overview",
    items: [
      { to: "/biz", end: true, label: "Overview", icon: LayoutDashboard, allow: () => true },
      { to: "/biz/reports", label: "Reports", icon: BarChart3, allow: () => true },
      { to: "/biz/digest", label: "Daily Digest", icon: Sparkles, allow: () => true, feature: "daily_digest" },
    ],
  },
  {
    label: "Live Outlets",
    items: [
      { to: "/biz/locations", label: "Locations", icon: MapPin, allow: () => true },
      { to: "/biz/brand", label: "Brand", icon: Store, allow: (u) => u?.dash_role === "owner" },
      { to: "/biz/central-supply", label: "Central Supply", icon: Warehouse, allow: (u) => u?.dash_role === "owner" && !!u?.brand_id },
    ],
  },
  {
    label: "Menu & Catalog",
    items: [
      { to: "/biz/menu", label: "Menu", icon: BookOpen, allow: () => true },
      { to: "/biz/schedules", label: "Schedules", icon: Clock, allow: () => true },
      { to: "/biz/coupons", label: "Coupons", icon: Ticket, allow: (u) => canManageCoupons(u) },
      { to: "/biz/gift-cards", label: "Gift Cards", icon: Wallet, allow: (u) => canManageGiftCards(u) },
      { to: "/biz/loyalty", label: "Loyalty", icon: Gift, allow: (u) => canManageLoyalty(u), feature: "loyalty" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { to: "/biz/inventory", label: "Inventory", icon: Boxes, allow: () => true, badge: "lowStock" },
      { to: "/biz/devices", label: "Kiosk Devices", icon: MonitorSmartphone, allow: () => true },
    ],
  },
  {
    label: "Staff / Shifts",
    items: [
      { to: "/biz/staff", label: "Staff", icon: Users, allow: (u) => canManageStaff(u) || u?.dash_role === "manager" },
      { to: "/biz/workforce", label: "Rota", icon: CalendarDays, allow: () => true },
      { to: "/biz/payroll", label: "Payroll", icon: Banknote, allow: (u) => canManagePayroll(u), feature: "payroll" },
    ],
  },
  {
    label: "Customer CRM",
    items: [
      { to: "/biz/customers", label: "Customers", icon: UserCircle, allow: () => true },
      { to: "/biz/sms", label: "Customer SMS", icon: MessageSquare, allow: () => true, feature: "customer_sms" },
      { to: "/biz/whatsapp", label: "WhatsApp", icon: MessageCircle, allow: () => true, feature: "whatsapp" },
      { to: "/biz/voice", label: "Voice Agent", icon: PhoneCall, allow: () => true, feature: "voice_agent" },
    ],
  },
];
// Flat view of every item — used for the feature-gate redirect effect and
// kept so that logic doesn't need to know about groups at all.
const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

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

// Footer row for both settings links (some "coming soon" and inert) and the
// password/sign-out action buttons. Collapses to an icon with a tooltip
// alongside the main nav rows.
function FooterLink({ to, onClick, onNavigate, icon: Icon, label, collapsed, soon, color, testid }) {
  const content = (
    <>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && soon && (
        <span className="ml-auto text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: "var(--pos-bg)", border: "1px solid var(--pos-border)", color: "var(--pos-muted)" }}>Soon</span>
      )}
    </>
  );
  const className = `pos-btn w-full flex items-center gap-2 px-3 py-1.5 rounded text-xs ${collapsed ? "justify-center px-0" : ""} ${soon ? "cursor-default opacity-60" : ""}`;
  const style = { color: color || "var(--pos-muted)" };

  let el;
  if (soon) {
    el = <div className={className} style={style} aria-disabled="true">{content}</div>;
  } else if (to) {
    el = <Link to={to} data-testid={testid} onClick={onNavigate} className={className} style={style}>{content}</Link>;
  } else {
    el = <button type="button" data-testid={testid} onClick={() => { onNavigate?.(); onClick?.(); }} className={className} style={style}>{content}</button>;
  }

  if (!collapsed) return el;
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{el}</TooltipTrigger>
      <TooltipContent side="right" style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)", border: "1px solid var(--pos-border)" }}>
        {label}{soon ? " (soon)" : ""}
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

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0"); } catch { /* ignore */ }
  }, [collapsed]);

  const visibleGroups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => i.allow(user) && (!i.feature || features[i.feature])) }))
    .filter((g) => g.items.length > 0);

  // A feature turned off shouldn't be reachable by direct URL either.
  useEffect(() => {
    if (!user) return;
    const disabled = NAV_ITEMS.find((i) => i.feature && location.pathname.startsWith(i.to) && !features[i.feature]);
    if (disabled) navigate("/biz", { replace: true });
  }, [location.pathname, features, user, navigate]);

  if (!user) return <Navigate to="/biz/login" replace />;
  if (user.must_change_password) return <Navigate to="/biz/account/password" replace />;
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
        <FooterLink to="/biz/locations" onNavigate={onNavigate} icon={Settings} label="Store Settings" collapsed={navCollapsed} />
        <FooterLink icon={Receipt} label="Tax & Billing" collapsed={navCollapsed} soon />
        <FooterLink icon={Code2} label="Developer" collapsed={navCollapsed} soon />
        <FooterLink icon={LifeBuoy} label="Support" collapsed={navCollapsed} soon />
        <div className="my-1" style={{ borderTop: "1px solid var(--pos-border)" }} />
        <div className={`flex items-center gap-2.5 rounded-md p-2 ${navCollapsed ? "justify-center" : ""}`} style={{ background: "var(--pos-panel-2)" }}>
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0" style={{ background: "var(--pos-accent)", color: "#1a0e04" }}>{initials}</div>
          {!navCollapsed && (
            <div className="min-w-0">
              <div className="text-xs font-bold text-white truncate">{user.name}</div>
              <div className="text-[10px]" style={{ color: "var(--pos-muted)" }}>{roleLabel}</div>
            </div>
          )}
        </div>
        <FooterLink onNavigate={onNavigate} icon={KeyRound} label="Change password" collapsed={navCollapsed}
          onClick={() => navigate("/biz/account/password")} testid="dash-password-btn" />
        <FooterLink onNavigate={onNavigate} icon={LogOut} label="Sign out" collapsed={navCollapsed}
          onClick={() => { logout(); navigate("/biz/login"); }} color="#f87171" testid="dash-logout-btn" />
      </div>
    </>
  );

  return (
    <TooltipProvider>
      <div className="h-screen flex flex-col md:flex-row" style={{ background: "var(--pos-bg)" }} data-testid="dash-layout">
        {/* Mobile top bar */}
        <header className="md:hidden h-14 flex items-center justify-between px-4 shrink-0" style={{ background: "var(--pos-panel)", borderBottom: "1px solid var(--pos-border)" }}>
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5" style={{ color: "var(--pos-accent)" }} />
            <div className="text-sm font-bold text-white">KANDA Dashboard</div>
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
            <Building2 className="w-5 h-5 shrink-0" style={{ color: "var(--pos-accent)" }} />
            {!collapsed && (
              <div className="leading-tight min-w-0">
                <div className="text-sm font-bold text-white">KANDA</div>
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
          <SheetContent side="left" className="w-72 p-0 flex flex-col border-r" data-testid="dash-mobile-nav-sheet"
            style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
            <div className="p-4 flex items-center gap-2" style={{ borderBottom: "1px solid var(--pos-border)" }}>
              <Building2 className="w-5 h-5" style={{ color: "var(--pos-accent)" }} />
              <div className="leading-tight">
                <div className="text-sm font-bold text-white">KANDA</div>
                <div className="text-[10px] tracking-wider uppercase" style={{ color: "var(--pos-muted)" }}>Dashboard</div>
              </div>
            </div>
            <StoreSwitcher />
            <NavItems onNavigate={() => setNavOpen(false)} />
          </SheetContent>
        </Sheet>

        <main className="flex-1 min-h-0 overflow-auto">
          <Outlet />
        </main>
      </div>
    </TooltipProvider>
  );
}
