import React, { useEffect, useState } from "react";
import { Outlet, NavLink, useNavigate, useLocation, Navigate } from "react-router-dom";
import { useDash, canManageStaff, canAddLocation } from "../../store/DashContext";
import { Building2, LayoutDashboard, Users, UserCircle, Boxes, BarChart3, CalendarDays, BookOpen, MapPin, LogOut, KeyRound, PhoneCall, Sparkles, MessageSquare, MessageCircle, Menu as MenuIcon } from "lucide-react";
import { Sheet, SheetContent } from "../ui/sheet";

const NAV_ITEMS = [
  { to: "/biz", end: true, label: "Overview", icon: LayoutDashboard, allow: () => true },
  { to: "/biz/menu", label: "Menu", icon: BookOpen, allow: () => true },
  { to: "/biz/staff", label: "Staff", icon: Users, allow: (u) => canManageStaff(u) || u?.dash_role === "manager" },
  { to: "/biz/workforce", label: "Rota", icon: CalendarDays, allow: () => true },
  { to: "/biz/customers", label: "Customers", icon: UserCircle, allow: () => true },
  { to: "/biz/inventory", label: "Inventory", icon: Boxes, allow: () => true },
  { to: "/biz/reports", label: "Reports", icon: BarChart3, allow: () => true },
  { to: "/biz/voice", label: "Voice Agent", icon: PhoneCall, allow: () => true, feature: "voice_agent" },
  { to: "/biz/sms", label: "Customer SMS", icon: MessageSquare, allow: () => true, feature: "customer_sms" },
  { to: "/biz/whatsapp", label: "WhatsApp", icon: MessageCircle, allow: () => true, feature: "whatsapp" },
  { to: "/biz/digest", label: "Daily Digest", icon: Sparkles, allow: () => true, feature: "daily_digest" },
  { to: "/biz/locations", label: "Locations", icon: MapPin, allow: () => true },
];

export default function DashLayout() {
  const { user, logout, features } = useDash();
  const navigate = useNavigate();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  const items = NAV_ITEMS.filter((i) => i.allow(user) && (!i.feature || features[i.feature]));

  // A feature turned off shouldn't be reachable by direct URL either.
  useEffect(() => {
    if (!user) return;
    const disabled = NAV_ITEMS.find((i) => i.feature && location.pathname.startsWith(i.to) && !features[i.feature]);
    if (disabled) navigate("/biz", { replace: true });
  }, [location.pathname, features, user, navigate]);

  if (!user) return <Navigate to="/biz/login" replace />;
  if (user.must_change_password) return <Navigate to="/biz/account/password" replace />;
  const roleLabel = { owner: "Restaurant Owner", area_manager: "Area Manager", manager: "Store Manager" }[user.dash_role] || user.dash_role;

  const NavItems = ({ onNavigate }) => (
    <>
      <nav className="flex-1 p-2 space-y-1">
        {items.map(({ to, end, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={end} data-testid={`dash-nav-${label.toLowerCase()}`} onClick={onNavigate}
            className={({ isActive }) => `pos-btn flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium ${isActive ? "text-white" : ""}`}
            style={({ isActive }) => ({ background: isActive ? "var(--pos-accent)" : "transparent", color: isActive ? "#fff" : "var(--pos-muted)" })}>
            <Icon className="w-4 h-4" /> {label}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 space-y-2" style={{ borderTop: "1px solid var(--pos-border)" }}>
        <div className="rounded-md p-2.5" style={{ background: "var(--pos-panel-2)" }}>
          <div className="text-xs font-bold text-white truncate">{user.name}</div>
          <div className="text-[10px]" style={{ color: "var(--pos-muted)" }}>{roleLabel}</div>
        </div>
        <button data-testid="dash-password-btn" onClick={() => { onNavigate?.(); navigate("/biz/account/password"); }}
          className="pos-btn w-full flex items-center gap-2 px-3 py-2 rounded text-xs"
          style={{ color: "var(--pos-muted)" }}>
          <KeyRound className="w-3.5 h-3.5" /> Change password
        </button>
        <button data-testid="dash-logout-btn" onClick={() => { onNavigate?.(); logout(); navigate("/biz/login"); }}
          className="pos-btn w-full flex items-center gap-2 px-3 py-2 rounded text-xs"
          style={{ color: "#f87171" }}>
          <LogOut className="w-3.5 h-3.5" /> Sign out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex flex-col md:flex-row" style={{ background: "var(--pos-bg)" }} data-testid="dash-layout">
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
      <aside className="hidden md:flex w-60 shrink-0 flex-col" style={{ background: "var(--pos-panel)", borderRight: "1px solid var(--pos-border)" }}>
        <div className="p-4 flex items-center gap-2" style={{ borderBottom: "1px solid var(--pos-border)" }}>
          <Building2 className="w-5 h-5" style={{ color: "var(--pos-accent)" }} />
          <div className="leading-tight">
            <div className="text-sm font-bold text-white">KANDA</div>
            <div className="text-[10px] tracking-wider uppercase" style={{ color: "var(--pos-muted)" }}>Dashboard</div>
          </div>
        </div>
        <NavItems />
      </aside>

      {/* Mobile nav sheet */}
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
          <NavItems onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <main className="flex-1 min-h-0 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
