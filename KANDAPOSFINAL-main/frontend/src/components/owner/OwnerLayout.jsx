import React, { useEffect, useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useOwner } from "../../store/OwnerContext";
import { LayoutDashboard, Store, Plus, LogOut, ShieldCheck, AlertOctagon, ClipboardCheck, LifeBuoy, Inbox, Menu as MenuIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { Sheet, SheetContent } from "../ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";

const SIDEBAR_COLLAPSED_KEY = "kanda_owner_sidebar_collapsed_v1";

const NAV = [
  { to: "/owner", end: true, icon: LayoutDashboard, label: "Dashboard" },
  { to: "/owner/tenants", icon: Store, label: "Tenants" },
  { to: "/owner/tenants/new", icon: Plus, label: "New tenant" },
  { to: "/owner/ops/leads", icon: Inbox, label: "Website leads" },
  { to: "/owner/ops/support", icon: LifeBuoy, label: "Support" },
  { to: "/owner/ops/audit", icon: ClipboardCheck, label: "Audit log" },
  { to: "/owner/ops/errors", icon: AlertOctagon, label: "Errors" },
];

// One nav row, shared by the desktop list and the mobile sheet. When
// `collapsed`, the label is dropped in favor of a hover tooltip and the row
// centers its icon — mirrors DashLayout's NavRow.
function NavRow({ to, end, label, icon: Icon, onNavigate, collapsed }) {
  const row = (
    <NavLink to={to} end={end} onClick={onNavigate}
      className="flex items-center gap-2.5 h-10 px-3 rounded-lg text-sm font-medium"
      style={({ isActive }) => ({
        background: isActive ? "var(--pos-panel-2)" : "transparent",
        color: isActive ? "var(--pos-text)" : "var(--pos-muted)",
        border: `1px solid ${isActive ? "var(--pos-border)" : "transparent"}`,
        justifyContent: collapsed ? "center" : "flex-start",
        paddingLeft: collapsed ? 0 : undefined,
        paddingRight: collapsed ? 0 : undefined,
      })}
      data-testid={`owner-nav-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <Icon className="w-4 h-4 shrink-0" /> {!collapsed && label}
    </NavLink>
  );
  if (!collapsed) return row;
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="right" style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)", border: "1px solid var(--pos-border)" }}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export default function OwnerLayout() {
  const { owner, logout } = useOwner();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0"); } catch { /* ignore */ }
  }, [collapsed]);

  const NavItems = ({ onNavigate, collapsed: navCollapsed = false }) => (
    <>
      <nav className="px-2 space-y-1 flex-1 min-h-0 overflow-y-auto">
        {NAV.map((n) => (
          <NavRow key={n.to} to={n.to} end={n.end} label={n.label} icon={n.icon}
            onNavigate={onNavigate} collapsed={navCollapsed} />
        ))}
      </nav>
      <div className="px-3 py-3" style={{ borderTop: "1px solid var(--pos-border)" }}>
        {!navCollapsed && (
          <>
            <div className="text-xs font-semibold" style={{ color: "var(--pos-text)" }}>{owner?.name}</div>
            <div className="text-[10px]" style={{ color: "var(--pos-muted)" }}>{owner?.email}</div>
          </>
        )}
        <button data-testid="owner-logout" onClick={() => { onNavigate?.(); logout(); navigate("/owner/login"); }}
          className="mt-2 w-full h-9 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5"
          style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
          <LogOut className="w-3.5 h-3.5" /> {!navCollapsed && "Sign out"}
        </button>
      </div>
    </>
  );

  return (
    <TooltipProvider>
      <div className="h-screen flex flex-col md:flex-row" style={{ background: "var(--pos-bg)" }}>
        {/* Mobile top bar */}
        <header className="md:hidden h-14 flex items-center justify-between px-4 shrink-0" style={{ background: "var(--pos-panel)", borderBottom: "1px solid var(--pos-border)" }}>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" style={{ color: "var(--pos-accent)" }} />
            <div className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>Owner Portal</div>
          </div>
          <button data-testid="owner-mobile-menu-btn" onClick={() => setNavOpen(true)}
            className="w-10 h-10 flex items-center justify-center rounded-lg" style={{ color: "var(--pos-muted)" }}>
            <MenuIcon className="w-5 h-5" />
          </button>
        </header>

        {/* Desktop sidebar */}
        <aside className={`hidden md:flex shrink-0 flex-col transition-[width] duration-150 ${collapsed ? "w-[68px]" : "w-60"}`}
          style={{ background: "var(--pos-panel)", borderRight: "1px solid var(--pos-border)" }}>
          <div className={`px-5 py-4 flex items-center gap-2 ${collapsed ? "justify-center px-2" : ""}`}>
            <ShieldCheck className="w-5 h-5 shrink-0" style={{ color: "var(--pos-accent)" }} />
            {!collapsed && (
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Kanda POS</div>
                <div className="font-bold" style={{ color: "var(--pos-text)" }}>Owner Portal</div>
              </div>
            )}
            {!collapsed && (
              <button data-testid="owner-collapse-btn" onClick={() => setCollapsed(true)} title="Collapse sidebar"
                className="ml-auto w-6 h-6 rounded flex items-center justify-center" style={{ color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {collapsed && (
            <button data-testid="owner-expand-btn" onClick={() => setCollapsed(false)} title="Expand sidebar"
              className="mx-auto mb-2 w-6 h-6 rounded flex items-center justify-center" style={{ color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
          <NavItems collapsed={collapsed} />
        </aside>

        {/* Mobile nav sheet — always renders expanded, independent of the desktop collapse state */}
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent side="left" className="w-72 p-0 flex flex-col border-r" data-testid="owner-mobile-nav-sheet"
            style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
            <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: "1px solid var(--pos-border)" }}>
              <ShieldCheck className="w-5 h-5" style={{ color: "var(--pos-accent)" }} />
              <div>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Kanda POS</div>
                <div className="font-bold" style={{ color: "var(--pos-text)" }}>Owner Portal</div>
              </div>
            </div>
            <NavItems onNavigate={() => setNavOpen(false)} />
          </SheetContent>
        </Sheet>

        <main className="flex-1 min-h-0 overflow-y-auto pos-scroll p-6">
          <Outlet />
        </main>
      </div>
    </TooltipProvider>
  );
}
