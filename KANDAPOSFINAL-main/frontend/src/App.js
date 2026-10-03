import React, { Suspense, lazy } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { Toaster } from "./components/ui/sonner";
import { PosProvider, usePos } from "./store/PosContext";
import { OwnerProvider, useOwner } from "./store/OwnerContext";
import { DashProvider, useDash } from "./store/DashContext";
import { tenantStore } from "./api/client";

// Eager: the marketing homepage and legal pages are the first thing a new
// visitor loads, so they stay in the main bundle. Everything below is
// app-only (needs a login) and is code-split — a visitor reading the
// homepage should not download the POS, Dashboard, KDS, and Owner Portal
// bundles before they've even signed up.
import LandingPage from "./components/LandingPage";
import PrivacyPolicy from "./components/legal/PrivacyPolicy";
import TermsAndConditions from "./components/legal/TermsAndConditions";
import NotFoundPage from "./components/NotFoundPage";

const RolePicker = lazy(() => import("./components/display/RolePicker"));

const LoginScreen = lazy(() => import("./components/pos/LoginScreen"));
const RestaurantGate = lazy(() => import("./components/pos/RestaurantGate"));
const TimeClockScreen = lazy(() => import("./components/pos/TimeClockScreen"));
const POSLayout = lazy(() => import("./components/pos/POSLayout"));
const HomeScreen = lazy(() => import("./components/pos/HomeScreen"));
const OrdersScreen = lazy(() => import("./components/pos/OrdersScreen"));
const TablesScreen = lazy(() => import("./components/pos/TablesScreen"));
const CustomersScreen = lazy(() => import("./components/pos/CustomersScreen"));
const InventoryScreen = lazy(() => import("./components/pos/InventoryScreen"));
const MenuScreen = lazy(() => import("./components/pos/MenuScreen"));
const ReportsScreen = lazy(() => import("./components/pos/ReportsScreen"));
const DispatchScreen = lazy(() => import("./components/pos/DispatchScreen"));
const PackingScreen = lazy(() => import("./components/pos/PackingScreen"));
const CustomerDisplayScreen = lazy(() => import("./components/pos/CustomerDisplayScreen"));
const StaffScreen = lazy(() => import("./components/pos/StaffScreen"));
const WorkforceScreen = lazy(() => import("./components/pos/WorkforceScreen"));
const DriverScreen = lazy(() => import("./components/pos/DriverScreen"));

const TableOrderPage = lazy(() => import("./components/storefront/TableOrderPage"));
const PickupOrderPage = lazy(() => import("./components/storefront/PickupOrderPage"));
const BirthdayLinkPage = lazy(() => import("./components/storefront/BirthdayLinkPage"));

const OwnerLogin = lazy(() => import("./components/owner/OwnerLogin"));
const OwnerTotp = lazy(() => import("./components/owner/OwnerTotp"));
const OwnerLayout = lazy(() => import("./components/owner/OwnerLayout"));
const OwnerDashboard = lazy(() => import("./components/owner/OwnerDashboard"));
const TenantsList = lazy(() => import("./components/owner/TenantsList"));
const TenantDetail = lazy(() => import("./components/owner/TenantDetail"));
const CreateTenant = lazy(() => import("./components/owner/CreateTenant"));
const ErrorLog = lazy(() => import("./components/owner/ErrorLog"));
const AuditLog = lazy(() => import("./components/owner/AuditLog"));
const SupportInbox = lazy(() => import("./components/owner/SupportInbox"));
const LeadsInbox = lazy(() => import("./components/owner/LeadsInbox"));

const KDSBoard = lazy(() => import("./components/kds/KDSBoard"));

const DashLogin = lazy(() => import("./components/dash/DashLogin"));
const DashLayout = lazy(() => import("./components/dash/DashLayout"));
const DashHome = lazy(() => import("./components/dash/DashHome"));
const DashChangePassword = lazy(() => import("./components/dash/DashChangePassword"));
const DashLocations = lazy(() => import("./components/dash/DashLocations"));
const DashBranding = lazy(() => import("./components/dash/DashBranding"));
const DashVoice = lazy(() => import("./components/dash/DashVoice"));
const DashDigest = lazy(() => import("./components/dash/DashDigest"));
const DashLoyalty = lazy(() => import("./components/dash/DashLoyalty"));
const DashSchedules = lazy(() => import("./components/dash/DashSchedules"));
const DashCoupons = lazy(() => import("./components/dash/DashCoupons"));
const DashGiftCards = lazy(() => import("./components/dash/DashGiftCards"));
const DashSms = lazy(() => import("./components/dash/DashSms"));
const DashWhatsApp = lazy(() => import("./components/dash/DashWhatsApp"));
const PayrollScreen = lazy(() => import("./components/dash/PayrollScreen"));
const BrandScreen = lazy(() => import("./components/dash/BrandScreen"));
const DashCentralSupply = lazy(() => import("./components/dash/DashCentralSupply"));
const KioskDevicesPage = lazy(() => import("./components/dash/KioskDevicesPage"));

function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--pos-bg)", color: "var(--pos-muted)" }}>
      Loading…
    </div>
  );
}

// Decides what "/" opens to. Set at build time via REACT_APP_APP_TARGET
// (see .github/workflows/build-android.yml / build-windows.yml / the new
// -display variants) — the same web bundle powers three different device
// identities:
//   web (default, unset) — the marketing homepage. Used by the plain web
//     deploy; the staff/KDS routes below still work here too (an
//     unadvertised fallback), this only changes what "/" shows.
//   pos — the "Kanda POS" native app (cashier/driver/clock-in): straight
//     to staff sign-in, no marketing page on a till.
//   display — the "Kanda Display" native app (KDS/packing/customer
//     display): a role picker, since this device has no staff PIN of its
//     own to log in with.
//   driver — the "Kanda Driver" native app: the same Restaurant ID + PIN
//     sign-in as pos, but LoginScreen only lets Driver-role staff through.
function RootRoute() {
  const target = process.env.REACT_APP_APP_TARGET;
  if (target === "pos" || target === "driver") return <Navigate to="/pos/login" replace />;
  if (target === "display") return <RolePicker />;
  return <LandingPage />;
}

function Protected({ children }) {
  const { staffUser, bootState } = usePos();
  const { slug } = useParams();
  if (bootState === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--pos-bg)", color: "var(--pos-muted)" }}>
        Loading POS…
      </div>
    );
  }
  // Also bounce back to login if the signed-in session belongs to a
  // different restaurant than the one named in the URL — e.g. a shared
  // kiosk device still signed into Restaurant A gets sent to Restaurant B's
  // login instead of silently rendering A's data under B's URL.
  if (!staffUser || tenantStore.get() !== slug) return <Navigate to={`/pos/${slug}/login`} replace />;
  return children;
}

function OwnerProtected({ children }) {
  const { owner, boot } = useOwner();
  if (boot === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--pos-bg)", color: "var(--pos-muted)" }}>
        Loading Owner Portal…
      </div>
    );
  }
  if (!owner) return <Navigate to="/owner/login" replace />;
  return children;
}

// Every top-level path below also has to be listed in firebase.json's
// Hosting rewrites (as its own fast static "/index.html" rule, or a "/:slug/..."
// rule for tenant-scoped POS paths) — otherwise Firebase Hosting's catch-all
// falls through to the backend's soft-404 handler (server.py) and a real
// route gets served as a 404. Add new top-level routes to both places.
function App() {
  return (
    <div className="App">
      <OwnerProvider>
        <DashProvider>
          <PosProvider>
            <BrowserRouter>
              <Suspense fallback={<RouteLoading />}>
                <Routes>
                  {/* Owner portal */}
                  <Route path="/owner/login" element={<OwnerLogin />} />
                  <Route path="/owner/verify" element={<OwnerTotp />} />
                  <Route path="/owner" element={<OwnerProtected><OwnerLayout /></OwnerProtected>}>
                    <Route index element={<OwnerDashboard />} />
                    <Route path="tenants" element={<TenantsList />} />
                    <Route path="tenants/new" element={<CreateTenant />} />
                    <Route path="tenants/:id" element={<TenantDetail />} />
                    <Route path="ops/errors" element={<ErrorLog />} />
                    <Route path="ops/audit" element={<AuditLog />} />
                    <Route path="ops/support" element={<SupportInbox />} />
                    <Route path="ops/leads" element={<LeadsInbox />} />
                  </Route>

                  {/* Restaurant Owner / Area Manager / Store Manager dashboard */}
                  <Route path="/dashboard/login" element={<DashLogin />} />
                  <Route path="/dashboard/account/password" element={<DashChangePassword />} />
                  <Route path="/dashboard" element={<DashLayout />}>
                    <Route index element={<DashHome />} />
                    <Route path="menu" element={<MenuScreen />} />
                    <Route path="schedules" element={<DashSchedules />} />
                    <Route path="staff" element={<StaffScreen />} />
                    <Route path="brand" element={<BrandScreen />} />
                    <Route path="central-supply" element={<DashCentralSupply />} />
                    <Route path="payroll" element={<PayrollScreen />} />
                    <Route path="workforce" element={<WorkforceScreen />} />
                    <Route path="customers" element={<CustomersScreen />} />
                    <Route path="reports" element={<ReportsScreen />} />
                    <Route path="inventory" element={<InventoryScreen />} />
                    <Route path="devices" element={<KioskDevicesPage />} />
                    <Route path="voice" element={<DashVoice />} />
                    <Route path="digest" element={<DashDigest />} />
                    <Route path="loyalty" element={<DashLoyalty />} />
                    <Route path="coupons" element={<DashCoupons />} />
                    <Route path="gift-cards" element={<DashGiftCards />} />
                    <Route path="sms" element={<DashSms />} />
                    <Route path="whatsapp" element={<DashWhatsApp />} />
                    <Route path="locations" element={<DashLocations />} />
                    <Route path="branding" element={<DashBranding />} />
                  </Route>

                  {/* Kitchen Display — no auth, long-lived ?token= */}
                  <Route path="/kds" element={<KDSBoard />} />
                  <Route path="/kds/:station" element={<KDSBoard />} />

                  {/* Customer-facing order-status display — no auth, long-lived ?token= */}
                  <Route path="/display" element={<CustomerDisplayScreen />} />

                  {/* Packing station — no auth, long-lived ?token= (same as KDS/Display) */}
                  <Route path="/packing" element={<PackingScreen />} />

                  {/* Customer-facing QR ordering — fully public, no auth */}
                  <Route path="/order/:slug/table/:number" element={<TableOrderPage />} />
                  <Route path="/order/:slug/pickup" element={<PickupOrderPage />} />
                  <Route path="/loyalty/birthday/:token" element={<BirthdayLinkPage />} />

                  {/* Driver stripped POS view */}
                  <Route path="/:slug/driver" element={<Protected><DriverScreen /></Protected>} />

                  {/* Public marketing landing page on web; a native-app
                  identity's own starting screen on pos/display builds
                  (see RootRoute above). */}
                  <Route path="/" element={<RootRoute />} />
                  <Route path="/start" element={<Navigate to="/" replace />} />
                  <Route path="/privacy" element={<PrivacyPolicy />} />
                  <Route path="/terms" element={<TermsAndConditions />} />

                  {/* Tenant POS — /pos/login is the one-time Restaurant ID
                  gate, /pos/:slug/login the actual PIN pad for that
                  restaurant, /demo/login the public showcase (see
                  RestaurantGate.jsx / LoginScreen.jsx). */}
                  <Route path="/pos/login" element={<RestaurantGate />} />
                  <Route path="/pos/:slug/login" element={<LoginScreen />} />
                  <Route path="/demo/login" element={<LoginScreen isDemo />} />
                  <Route path="/clock" element={<TimeClockScreen />} />
                  <Route path="/:slug" element={<Protected><POSLayout /></Protected>}>
                    <Route index element={<Navigate to="pos" replace />} />
                    <Route path="pos" element={<HomeScreen />} />
                    <Route path="orders" element={<OrdersScreen />} />
                    <Route path="tables" element={<TablesScreen />} />
                    <Route path="menu" element={<MenuScreen />} />
                    <Route path="dispatch" element={<DispatchScreen />} />
                    <Route path="workforce" element={<WorkforceScreen />} />
                  </Route>
                  {/* Retired bare paths — a literal match here always outranks
                  the "/:slug" wildcard above, so these plain words don't get
                  mistaken for a restaurant slug and 404 cleanly instead. */}
                  <Route path="/pos" element={<NotFoundPage />} />
                  <Route path="/orders" element={<NotFoundPage />} />
                  <Route path="/tables" element={<NotFoundPage />} />
                  <Route path="/menu" element={<NotFoundPage />} />
                  <Route path="/dispatch" element={<NotFoundPage />} />
                  <Route path="/workforce" element={<NotFoundPage />} />
                  <Route path="/driver" element={<NotFoundPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
            <Toaster position="top-center" richColors />
          </PosProvider>
        </DashProvider>
      </OwnerProvider>
    </div>
  );
}

export default App;
