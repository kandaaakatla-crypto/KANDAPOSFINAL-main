import React, { useEffect, useState } from "react";
import { Outlet, NavLink, useNavigate, useLocation, Navigate } from "react-router-dom";
import { useDash } from "../../store/DashContext";
import { LogOut, KeyRound, Menu as MenuIcon, ChevronLeft, ChevronRight, Sun, Moon } from "lucide-react";
import { Sheet, SheetContent } from "../ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import StoreSwitcher from "./StoreSwitcher";
import { getTheme, toggleTheme } from "../../lib/theme";
import { NAV_SECTIONS, ALL_PAGES, visibleTabs, tabVisible, tabMatches } from "./dashNav";

const SIDEBAR_COLLAPSED_KEY = "kanda_dash_sidebar_collapsed_v1";

// One nav row, shared by the grouped desktop list and the mobile sheet.
// When `collapsed`, the label is dropped in favor of a hover tooltip and the
// row centers its icon — the low-stock badge becomes a plain dot overlay.
// `active` is worked out by the caller: a section row stays highlighted on
// any of its tabs, not only the one it links to.
function NavRow({ to, end, label, icon: Icon, onNavigate, collapsed, badgeCount, active }) {
  const row = (
    <NavLink key={to} to={to} end={end} data-testid={`dash-nav-${label.toLowerCase().replace(/\s+/g, "-")}`} onClick={onNavigate}
      className={() => `pos-btn relative flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] font-medium ${active ? "text-white" : ""} ${collapsed ? "justify-center px-0" : ""}`}
      style={() => ({ background: active ? "var(--pos-accent)" : "transparent", color: active ? "#fff" : "var(--pos-muted)" })}>
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

export default function DashLayout() {
  const { user, logout, features, lowStockCount } = useDash();
  const navigate = useNavigate();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    // First visit on a tablet-width screen starts collapsed so tables get the room;
    // after that the person's own choice wins.
    try {
      const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (saved === null) return window.innerWidth < 1100;
      return saved === "1";
    } catch { return false; }
  });
  const [theme, setTheme] = useState(getTheme);

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0"); } catch { /* ignore */ }
  }, [collapsed]);

  const visibleSections = NAV_SECTIONS
    .map((s) => ({ ...s, tabs: visibleTabs(s, user, features) }))
    .filter((s) => s.tabs.length > 0);

  // A feature turned off, or a section the owner hasn't given this person,
  // shouldn't be reachable by direct URL either. (The API refuses it anyway;
  // this just avoids a screen full of errors.)
  useEffect(() => {
    if (!user) return;
    const blocked = ALL_PAGES.find((i) => i.to !== "/dashboard" && location.pathname.startsWith(i.to)
      && !tabVisible(i, user, features));
    if (blocked) navigate("/dashboard", { replace: true });
  }, [location.pathname, features, user, navigate]);

  // Idle timeout: the owner session sits in localStorage on whatever device
  // was used, so on a shared till someone could open /dashboard hours later.
  // Sign out after IDLE_MS without any interaction (checked on load too, so
  // a long-closed tab can't resurrect an old session).
  useEffect(() => {
    if (!user) return undefined;
    const KEY = "kanda_dash_last_active_v1";
    const IDLE_MS = 30 * 60 * 1000;
    const stamp = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ } };
    const check = () => {
      let last = 0;
      try { last = Number(localStorage.getItem(KEY)) || 0; } catch { /* ignore */ }
      if (last && Date.now() - last > IDLE_MS) { logout(); navigate("/dashboard/login", { replace: true }); return true; }
      return false;
    };
    if (check()) return undefined;
    stamp();
    let lastWrite = Date.now();
    const onActivity = () => { if (Date.now() - lastWrite > 15000) { lastWrite = Date.now(); stamp(); } };
    const events = ["pointerdown", "keydown", "scroll"];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const id = setInterval(check, 60000);
    return () => { events.forEach((e) => window.removeEventListener(e, onActivity)); clearInterval(id); };
  }, [user, logout, navigate]);

  if (!user) return <Navigate to="/dashboard/login" replace />;
  if (user.must_change_password) return <Navigate to="/dashboard/account/password" replace />;
  const roleLabel = { owner: "Restaurant Owner", area_manager: "Area Manager", manager: "Store Manager" }[user.dash_role] || user.dash_role;
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  const NavItems = ({ onNavigate, collapsed: navCollapsed = false }) => (
    <>
      <nav className="flex-1 min-h-0 p-2 space-y-0.5 overflow-y-auto">
        {visibleSections.map(({ key, label, icon, badge, tabs }) => (
          <NavRow key={key} to={tabs[0].to} end={tabs[0].end} label={label} icon={icon} onNavigate={onNavigate}
            collapsed={navCollapsed} badgeCount={badge === "lowStock" ? lowStockCount : 0}
            active={tabs.some((t) => tabMatches(t, location.pathname))} />
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
      <div className="h-screen flex flex-col md:flex-row" style={{ background: "var(--pos-bg)" }} data-testid="dash-layout">
        {/* Mobile top bar */}
        <header className="md:hidden h-14 flex items-center justify-between px-4 shrink-0" style={{ background: "var(--pos-panel)", borderBottom: "1px solid var(--pos-border)" }}>
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
          <SheetContent side="left" className="w-72 p-0 flex flex-col border-r" data-testid="dash-mobile-nav-sheet"
            style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
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

        <main className="flex-1 min-h-0 overflow-auto">
          <Outlet />
        </main>
      </div>
    </TooltipProvider>
  );
}
