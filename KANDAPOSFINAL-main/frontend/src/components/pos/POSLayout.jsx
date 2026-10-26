import React, { useState, useEffect } from "react";
import { Outlet, NavLink, useNavigate, useLocation, useParams } from "react-router-dom";
import { usePos } from "../../store/PosContext";
import { ArrowLeft, Store, ShoppingCart, ClipboardList, LayoutGrid, BookOpen, Bike, LogOut, LifeBuoy, CalendarDays, MoreHorizontal, X, WifiOff, RefreshCw, Sun, Moon, Lock, Cable } from "lucide-react";
import ImpersonationBanner from "../owner/ImpersonationBanner";
import BillingBanner from "./BillingBanner";
import ContactSupportModal from "./ContactSupportModal";
import DevicesPanel from "./DevicesPanel";
import useScannerWatch from "../../hooks/useScannerWatch";
import OnboardingBanner from "./OnboardingBanner";
import LocationSwitcher from "./LocationSwitcher";
import { Sheet, SheetContent } from "../ui/sheet";
import useSeo from "../../hooks/useSeo";
import { getTheme, toggleTheme } from "../../lib/theme";
import { posDevicesApi, deviceStore } from "../../api/client";
import { toast } from "sonner";
import { backActionFor } from "../../utils/backNavigation";

export default function POSLayout() {
  const { staffUser, logout, orders, businessType, features, isOffline, pendingSyncCount, tenantInfo } = usePos();
  const navigate = useNavigate();
  const location = useLocation();
  const { slug } = useParams();
  const backAction = backActionFor(location.pathname);
  const backTo = backAction.type === "navigate" ? backAction.to : null;
  // Resets the tab title once staff are past /login — otherwise it would
  // keep reading "Staff sign in" for the rest of the session.
  useSeo({ title: "Point of sale", noindex: true });
  const [time, setTime] = useState(new Date());
  const [supportOpen, setSupportOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  // First time a scanner is used this session, say so: that is the whole "detection".
  const scannerSeen = React.useRef(false);
  useScannerWatch(() => {
    if (scannerSeen.current) return;
    scannerSeen.current = true;
    toast.success("Barcode scanner detected");
  });
  const [moreOpen, setMoreOpen] = useState(false);
  const [theme, setTheme] = useState(getTheme);

  const ALL_STAFF_WORKFORCE = { to: `/${slug}/workforce`, label: "My Rota", icon: CalendarDays };

  // Primary tabs — always visible in the mobile bottom bar. Tables only
  // makes sense for dine-in businesses, so retail tenants skip it.
  const PRIMARY_NAV = [
    { to: `/${slug}/pos`, label: businessType === "retail" ? "Sale" : "Order", icon: ShoppingCart, end: true },
    { to: `/${slug}/orders`, label: "Orders", icon: ClipboardList },
    ...(features.tables ? [{ to: `/${slug}/tables`, label: "Tables", icon: LayoutGrid }] : []),
    { to: `/${slug}/menu`, label: businessType === "retail" ? "Products" : "Menu", icon: BookOpen },
  ];

  // Secondary — visible in the desktop sidebar and inside the mobile "More" sheet.
  // Customers / Inventory / Reports live in the manager Dashboard only (/dashboard/*).
  // Packing and Customer Display are separate no-login screens (like KDS) — see QrCodesModal.
  const SECONDARY_NAV = [
    ...(features.dispatch ? [{ to: `/${slug}/dispatch`, label: "Dispatch", icon: Bike }] : []),
  ];

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Manager-only "Lock this till": signs the device itself out (not just the
  // current staff member), so staff PINs stop working here until a manager
  // unlocks it again. Same effect as removing it under Dashboard > Devices.
  const canLockTill = staffUser?.role === "Manager" && !!deviceStore.get(slug);
  const lockTill = async () => {
    if (!window.confirm("Lock this till? Staff won't be able to sign in here until a manager unlocks it again.")) return;
    try {
      await posDevicesApi.lockCurrent();
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Couldn't lock this till");
      return;
    }
    deviceStore.clear(slug);
    logout();
    window.location.assign(`/pos/${slug}/login`);
  };

  // Drivers get their own stripped-down app (deliveries + rota only) — never
  // the full POS chrome, even if they hit one of these routes directly.
  useEffect(() => {
    if (staffUser?.role === "Driver") navigate(`/${slug}/driver`, { replace: true });
  }, [staffUser, navigate, slug]);

  // A tenant with a feature turned off shouldn't be able to reach its screen
  // by direct URL either, not just have it hidden from nav.
  useEffect(() => {
    const path = location.pathname;
    if (path === `/${slug}/tables` && !features.tables) navigate(`/${slug}/pos`, { replace: true });
    if (path === `/${slug}/dispatch` && !features.dispatch) navigate(`/${slug}/pos`, { replace: true });
  }, [location.pathname, features, navigate, slug]);

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
      <DevicesPanel open={devicesOpen} onClose={() => setDevicesOpen(false)} />
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Desktop sidebar — hidden on mobile in favour of the bottom nav. */}
        <aside className="hidden md:flex w-[92px] flex-col items-center py-4 shrink-0" style={{ background: "var(--pos-panel)", borderRight: "1px solid var(--pos-border)" }} data-testid="sidebar">
          {businessType === "retail" ? (
            <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-6" style={{ background: "var(--pos-accent)" }}>
              <Store className="w-6 h-6 text-white" />
            </div>
          ) : (
            <img src="/icon-192.png" alt="Kanda POS" className="w-11 h-11 rounded-xl mb-6" />
          )}
          <nav className="flex flex-col gap-1.5 flex-1 min-h-0 w-full px-2 overflow-y-auto">
            {[...PRIMARY_NAV, ...SECONDARY_NAV].map((n) => (
              <RailLink key={n.to} to={n.to} label={n.label} Icon={n.icon} end={n.end}
                badge={n.to === `/${slug}/orders` ? activeCount : 0} />
            ))}
            {staffUser && staffUser.role !== "Manager" && (
              <>
                <div className="my-1 mx-2" style={{ borderTop: "1px solid var(--pos-border)" }} />
                <RailLink to={ALL_STAFF_WORKFORCE.to} label={ALL_STAFF_WORKFORCE.label} Icon={ALL_STAFF_WORKFORCE.icon} />
              </>
            )}
          </nav>
          {staffUser?.role === "Manager" && (
            <button data-testid="devices-btn" onClick={() => setDevicesOpen(true)}
              className="pos-btn flex flex-col items-center gap-1 py-2.5 rounded-lg text-[10px] w-full mx-2 mb-1" style={{ color: "var(--pos-muted)" }}>
              <Cable className="w-5 h-5" />
              Devices
            </button>
          )}
          <button data-testid="help-btn" onClick={() => setSupportOpen(true)}
            className="pos-btn flex flex-col items-center gap-1 py-2.5 rounded-lg text-[10px] w-full mx-2 mb-1" style={{ color: "var(--pos-muted)" }}>
            <LifeBuoy className="w-5 h-5" />
            Help
          </button>
          <button data-testid="theme-toggle-btn" onClick={() => setTheme(toggleTheme())}
            className="pos-btn flex flex-col items-center gap-1 py-2.5 rounded-lg text-[10px] w-full mx-2 mb-1" style={{ color: "var(--pos-muted)" }}>
            {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          {canLockTill && (
            <button data-testid="lock-till-btn" onClick={lockTill}
              className="pos-btn flex flex-col items-center gap-1 py-2.5 rounded-lg text-[10px] w-full mx-2 mb-1" style={{ color: "var(--pos-muted)" }}>
              <Lock className="w-5 h-5" />
              Lock till
            </button>
          )}
          {/* Hard nav, not navigate("/login") — a client-side transition races
              Protected's own staffUser-triggered re-render of the outgoing
              /pos route, which can win and bounce to "/" instead. */}
          <button data-testid="logout-btn" onClick={() => { logout(); window.location.assign(`/pos/${slug}/login`); }}
            className="pos-btn flex flex-col items-center gap-1 py-2.5 rounded-lg text-[10px] w-full mx-2" style={{ color: "var(--pos-muted)" }}>
            <LogOut className="w-5 h-5" />
            Sign out
          </button>
        </aside>

        {/* Main */}
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center justify-between px-3 md:px-5 shrink-0 gap-2" style={{ background: "var(--pos-panel)", borderBottom: "1px solid var(--pos-border)" }}>
            <div className="flex items-center gap-2 md:gap-3 min-w-0">
              {/* Mobile: a back arrow to the till off the till, else the brand mark */}
              {backTo ? (
                <button data-testid="header-back" aria-label="Back to till" onClick={() => navigate(backTo, { replace: true })}
                  className="pos-btn md:hidden w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                  <ArrowLeft className="w-4 h-4" style={{ color: "var(--pos-text)" }} />
                </button>
              ) : businessType === "retail" ? (
                <div className="md:hidden w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--pos-accent)" }}>
                  <Store className="w-4 h-4 text-white" />
                </div>
              ) : (
                <img src="/icon-192.png" alt="Kanda POS" className="md:hidden w-8 h-8 rounded-lg shrink-0" />
              )}
              <span className="hidden md:inline font-bold tracking-tight" style={{ color: "var(--pos-text)" }}>KANDA POS</span>
              <LocationSwitcher storeName={tenantInfo?.name || ""} isManager={staffUser?.role === "Manager"} />
            </div>
            <div className="flex items-center gap-2 md:gap-4 shrink-0">
              {(isOffline || pendingSyncCount > 0) && (
                <div data-testid="sync-status-badge"
                  className="flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-bold"
                  style={{
                    background: isOffline ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)",
                    color: isOffline ? "#f87171" : "#fbbf24",
                  }}
                  title={isOffline
                    ? "No connection — orders and changes are saved locally and will sync automatically once you're back online."
                    : `${pendingSyncCount} change${pendingSyncCount === 1 ? "" : "s"} waiting to sync`}>
                  {isOffline ? <WifiOff className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span className="hidden sm:inline">
                    {isOffline ? "Offline" : `Syncing ${pendingSyncCount}`}
                  </span>
                </div>
              )}
              <span className="hidden lg:inline text-sm tabular-nums" style={{ color: "var(--pos-muted)" }} data-testid="header-clock">
                {time.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · {time.toLocaleTimeString("en-GB")}
              </span>
              <div className="flex items-center gap-2" data-testid="header-staff">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "var(--pos-blue)" }}>{staffUser?.initials}</div>
                <div className="hidden sm:block leading-tight">
                  <div className="text-sm font-medium truncate max-w-[120px]" style={{ color: "var(--pos-text)" }}>{staffUser?.name}</div>
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
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 grid h-16"
        data-testid="mobile-bottom-nav"
        style={{ background: "var(--pos-panel)", borderTop: "1px solid var(--pos-border)", paddingBottom: "env(safe-area-inset-bottom)", gridTemplateColumns: `repeat(${PRIMARY_NAV.length + 1}, minmax(0, 1fr))` }}>
        {PRIMARY_NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} data-testid={`mnav-${label.toLowerCase()}`}
            className={({ isActive }) => `relative flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${isActive ? "text-white" : ""}`}
            style={({ isActive }) => ({ color: isActive ? "var(--pos-accent)" : "var(--pos-muted)" })}>
            <Icon className="w-5 h-5" />
            {label}
            {to === `/${slug}/orders` && activeCount > 0 && (
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
            <span className="font-bold" style={{ color: "var(--pos-text)" }}>More</span>
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
            <button data-testid="mmore-theme-toggle" onClick={() => setTheme(toggleTheme())}
              className="pos-btn w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm"
              style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
            {canLockTill && (
              <button data-testid="mmore-lock-till" onClick={() => { setMoreOpen(false); lockTill(); }}
                className="pos-btn w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm"
                style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>
                <Lock className="w-4 h-4" /> Lock this till
              </button>
            )}
            <button data-testid="mmore-logout" onClick={() => { setMoreOpen(false); logout(); window.location.assign(`/pos/${slug}/login`); }}
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
