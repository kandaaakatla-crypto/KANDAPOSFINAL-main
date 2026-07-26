import React, { useState, useEffect } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { usePos } from "../../store/PosContext";
import { Pizza, ShoppingCart, ClipboardList, LayoutGrid, BookOpen, Bike, PackageCheck, LogOut, LifeBuoy, UserCog, CalendarDays, MoreHorizontal, X } from "lucide-react";
import ImpersonationBanner from "../owner/ImpersonationBanner";
import BillingBanner from "./BillingBanner";
import ContactSupportModal from "./ContactSupportModal";
import OnboardingBanner from "./OnboardingBanner";
import LocationSwitcher from "./LocationSwitcher";
import { Sheet, SheetContent } from "../ui/sheet";

// Primary tabs — always visible in the mobile bottom bar (max 5).
const PRIMARY_NAV = [
  { to: "/", label: "Order", icon: ShoppingCart, end: true },
  { to: "/orders", label: "Orders", icon: ClipboardList },
  { to: "/tables", label: "Tables", icon: LayoutGrid },
  { to: "/menu", label: "Menu", icon: BookOpen },
];

// Secondary — visible in the desktop sidebar and inside the mobile "More" sheet.
// Customers / Inventory / Reports live in the manager Dashboard only (/biz/*).
const SECONDARY_NAV = [
  { to: "/dispatch", label: "Dispatch", icon: Bike },
  { to: "/packing", label: "Packing", icon: PackageCheck },
];

const ALL_STAFF_WORKFORCE = { to: "/workforce", label: "My Rota", icon: CalendarDays };

export default function POSLayout() {
  const { staffUser, logout, orders } = usePos();
  const navigate = useNavigate();
  const [time, setTime] = useState(new Date());
  const [supportOpen, setSupportOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Drivers get their own stripped-down app (deliveries + rota only) — never
  // the full POS chrome, even if they hit one of these routes directly.
  useEffect(() => {
    if (staffUser?.role === "Driver") navigate("/driver", { replace: true });
  }, [staffUser, navigate]);

  const activeCount = orders.filter((o) => ["new", "in-kitchen", "ready", "out-for-delivery"].includes(o.status)).length;

  // Reused nav pill for the desktop rail.
  const RailLink = ({ to, label, Icon, badge, end }) => (
    <NavLink to={to} end={end} data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
      className={({ isActive }) => `pos-btn relative flex flex-col items-center gap-1 py-2.5 rounded-lg text-[10px] font-medium ${isActive ? "text-white" : ""}`}
      style={({ isActive }) => ({ background: isActive ? "var(--pos-accent)" : "transparent", color: isActive ? "#fff" : "var(--pos-muted)" })}>
      <Icon className="w-5 h-5" />
      {label}
      {badge > 0 && (
        <span className="absolute top-1 right-2 min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center text-white live-dot" style={{ background: "#ef4444" }}>{badge}</span>
      )}
    </NavLink>
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--pos-bg)" }}>
      <ImpersonationBanner />
      <BillingBanner />
      <ContactSupportModal open={supportOpen} onClose={() => setSupportOpen(false)} />
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Desktop sidebar — hidden on mobile in favour of the bottom nav. */}
        <aside className="hidden md:flex w-[92px] flex-col items-center py-4 shrink-0" style={{ background: "var(--pos-panel)", borderRight: "1px solid var(--pos-border)" }} data-testid="sidebar">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-6" style={{ background: "var(--pos-accent)" }}>
            <Pizza className="w-6 h-6 text-white" />
          </div>
          <nav className="flex flex-col gap-1.5 flex-1 w-full px-2 overflow-y-auto">
            {[...PRIMARY_NAV, ...SECONDARY_NAV].map((n) => (
              <RailLink key={n.to} to={n.to} label={n.label} Icon={n.icon} end={n.end}
                badge={n.to === "/orders" ? activeCount : 0} />
            ))}
            {staffUser?.role === "Manager" && (
              <>
                <div className="my-1 mx-2" style={{ borderTop: "1px solid var(--pos-border)" }} />
                <a href="/biz" data-testid="nav-dashboard-link" title="Open Restaurant Dashboard"
                  className="pos-btn relative flex flex-col items-center gap-1 py-2.5 rounded-lg text-[10px] font-medium"
                  style={{ background: "transparent", color: "var(--pos-muted)" }}>
                  <UserCog className="w-5 h-5" />
                  Dashboard
                </a>
              </>
            )}
            {staffUser && staffUser.role !== "Manager" && (
              <>
                <div className="my-1 mx-2" style={{ borderTop: "1px solid var(--pos-border)" }} />
                <RailLink to={ALL_STAFF_WORKFORCE.to} label={ALL_STAFF_WORKFORCE.label} Icon={ALL_STAFF_WORKFORCE.icon} />
              </>
            )}
          </nav>
          <button data-testid="help-btn" onClick={() => setSupportOpen(true)}
            className="pos-btn flex flex-col items-center gap-1 py-2.5 rounded-lg text-[10px] w-full mx-2 mb-1" style={{ color: "var(--pos-muted)" }}>
            <LifeBuoy className="w-5 h-5" />
            Help
          </button>
          <button data-testid="logout-btn" onClick={() => { logout(); navigate("/login"); }}
            className="pos-btn flex flex-col items-center gap-1 py-2.5 rounded-lg text-[10px] w-full mx-2" style={{ color: "var(--pos-muted)" }}>
            <LogOut className="w-5 h-5" />
            Sign out
          </button>
        </aside>

        {/* Main */}
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center justify-between px-3 md:px-5 shrink-0 gap-2" style={{ background: "var(--pos-panel)", borderBottom: "1px solid var(--pos-border)" }}>
            <div className="flex items-center gap-2 md:gap-3 min-w-0">
              {/* Mobile brand mark */}
              <div className="md:hidden w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--pos-accent)" }}>
                <Pizza className="w-4 h-4 text-white" />
              </div>
              <span className="hidden md:inline font-bold text-white tracking-tight">KANDA POS</span>
              <LocationSwitcher storeName="Store" isManager={staffUser?.role === "Manager"} />
            </div>
            <div className="flex items-center gap-2 md:gap-4 shrink-0">
              <span className="hidden lg:inline text-sm tabular-nums" style={{ color: "var(--pos-muted)" }} data-testid="header-clock">
                {time.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · {time.toLocaleTimeString("en-GB")}
              </span>
              <div className="flex items-center gap-2" data-testid="header-staff">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "var(--pos-blue)" }}>{staffUser?.initials}</div>
                <div className="hidden sm:block leading-tight">
                  <div className="text-sm font-medium text-white truncate max-w-[120px]">{staffUser?.name}</div>
                  <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>{staffUser?.role}</div>
                </div>
              </div>
            </div>
          </header>
          <OnboardingBanner />
          <main className="flex-1 min-h-0 overflow-hidden pb-16 md:pb-0" data-testid="pos-main">
            <Outlet />
          </main>
        </div>
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-5 h-16"
        data-testid="mobile-bottom-nav"
        style={{ background: "var(--pos-panel)", borderTop: "1px solid var(--pos-border)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        {PRIMARY_NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} data-testid={`mnav-${label.toLowerCase()}`}
            className={({ isActive }) => `relative flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${isActive ? "text-white" : ""}`}
            style={({ isActive }) => ({ color: isActive ? "var(--pos-accent)" : "var(--pos-muted)" })}>
            <Icon className="w-5 h-5" />
            {label}
            {to === "/orders" && activeCount > 0 && (
              <span className="absolute top-1 right-3 min-w-[16px] h-[16px] rounded-full text-[9px] font-bold flex items-center justify-center text-white" style={{ background: "#ef4444" }}>{activeCount}</span>
            )}
          </NavLink>
        ))}
        <button data-testid="mnav-more" onClick={() => setMoreOpen(true)}
          className="flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium" style={{ color: "var(--pos-muted)" }}>
          <MoreHorizontal className="w-5 h-5" />
          More
        </button>
      </nav>

      {/* Mobile "More" sheet — Dispatch / Customers / Inventory / Reports + Dashboard link + Sign out */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="right" className="w-[280px] p-0 border-l" data-testid="mobile-more-sheet"
          style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
          <div className="p-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--pos-border)" }}>
            <span className="font-bold text-white">More</span>
            <button data-testid="mobile-more-close" onClick={() => setMoreOpen(false)} className="pos-btn p-1 rounded" style={{ color: "var(--pos-muted)" }}>
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-3 space-y-1">
            {SECONDARY_NAV.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} data-testid={`mmore-${label.toLowerCase()}`} onClick={() => setMoreOpen(false)}
                className={({ isActive }) => `pos-btn flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium ${isActive ? "text-white" : ""}`}
                style={({ isActive }) => ({ background: isActive ? "var(--pos-accent)" : "var(--pos-panel-2)", color: isActive ? "#fff" : "var(--pos-muted)" })}>
                <Icon className="w-5 h-5" /> {label}
              </NavLink>
            ))}
            {staffUser?.role === "Manager" && (
              <a href="/biz" data-testid="mmore-dashboard" className="pos-btn flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium"
                style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>
                <UserCog className="w-5 h-5" /> Restaurant Dashboard
              </a>
            )}
            {staffUser && staffUser.role !== "Manager" && (
              <NavLink to={ALL_STAFF_WORKFORCE.to} data-testid="mmore-rota" onClick={() => setMoreOpen(false)}
                className="pos-btn flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium"
                style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>
                <ALL_STAFF_WORKFORCE.icon className="w-5 h-5" /> {ALL_STAFF_WORKFORCE.label}
              </NavLink>
            )}
          </div>
          <div className="p-3 space-y-2 mt-2" style={{ borderTop: "1px solid var(--pos-border)" }}>
            <button data-testid="mmore-help" onClick={() => { setMoreOpen(false); setSupportOpen(true); }}
              className="pos-btn w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm"
              style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>
              <LifeBuoy className="w-4 h-4" /> Help & Support
            </button>
            <button data-testid="mmore-logout" onClick={() => { setMoreOpen(false); logout(); navigate("/login"); }}
              className="pos-btn w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm"
              style={{ background: "var(--pos-panel-2)", color: "#f87171" }}>
              <LogOut className="w-4 h-4" /> Sign out
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
