import React, { Suspense, lazy } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "./components/ui/sonner";
import { PosProvider, usePos } from "./store/PosContext";
import { OwnerProvider, useOwner } from "./store/OwnerContext";
import { DashProvider, useDash } from "./store/DashContext";
import AIAssistant from "./components/AIAssistant";

// Eager: the marketing homepage and legal pages are the first thing a new
// visitor loads, so they stay in the main bundle. Everything below is
// app-only (needs a login) and is code-split — a visitor reading the
// homepage should not download the POS, Dashboard, KDS, and Owner Portal
// bundles before they've even signed up.
import LandingPage from "./components/LandingPage";
import PrivacyPolicy from "./components/legal/PrivacyPolicy";
import TermsAndConditions from "./components/legal/TermsAndConditions";
import NotFoundPage from "./components/NotFoundPage";

const LoginScreen = lazy(() => import("./components/pos/LoginScreen"));
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

const KDSBoard = lazy(() => import("./components/kds/KDSBoard"));

const DashLogin = lazy(() => import("./components/dash/DashLogin"));
const DashLayout = lazy(() => import("./components/dash/DashLayout"));
const DashHome = lazy(() => import("./components/dash/DashHome"));
const DashChangePassword = lazy(() => import("./components/dash/DashChangePassword"));
const DashLocations = lazy(() => import("./components/dash/DashLocations"));
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

function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--pos-bg)", color: "var(--pos-muted)" }}>
      Loading…
    </div>
  );
}

function Protected({ children }) {
  const { staffUser, bootState } = usePos();
  if (bootState === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--pos-bg)", color: "var(--pos-muted)" }}>
        Loading POS…
      </div>
    );
  }
  if (!staffUser) return <Navigate to="/" replace />;
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

function App() {
  return (
    <div className="App">
      <OwnerProvider>
        <DashProvider>
          <PosProvider>
            <BrowserRouter>
              <AIAssistant />
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
                  </Route>

                  {/* Restaurant Owner / Area Manager / Store Manager dashboard */}
                  <Route path="/biz/login" element={<DashLogin />} />
                  <Route path="/biz/account/password" element={<DashChangePassword />} />
                  <Route path="/biz" element={<DashLayout />}>
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
                    <Route path="voice" element={<DashVoice />} />
                    <Route path="digest" element={<DashDigest />} />
                    <Route path="loyalty" element={<DashLoyalty />} />
                    <Route path="coupons" element={<DashCoupons />} />
                    <Route path="gift-cards" element={<DashGiftCards />} />
                    <Route path="sms" element={<DashSms />} />
                    <Route path="whatsapp" element={<DashWhatsApp />} />
                    <Route path="locations" element={<DashLocations />} />
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
                  <Route path="/driver" element={<Protected><DriverScreen /></Protected>} />

                  {/* Public marketing landing page + portal picker */}
                  <Route path="/" element={<LandingPage />} />
                  <Route path="/start" element={<Navigate to="/" replace />} />
                  <Route path="/privacy" element={<PrivacyPolicy />} />
                  <Route path="/terms" element={<TermsAndConditions />} />

                  {/* Tenant POS */}
                  <Route path="/login" element={<LoginScreen />} />
                  <Route path="/clock" element={<TimeClockScreen />} />
                  <Route element={<Protected><POSLayout /></Protected>}>
                    <Route path="/pos" element={<HomeScreen />} />
                    <Route path="/orders" element={<OrdersScreen />} />
                    <Route path="/tables" element={<TablesScreen />} />
                    <Route path="/menu" element={<MenuScreen />} />
                    <Route path="/dispatch" element={<DispatchScreen />} />
                    <Route path="/workforce" element={<WorkforceScreen />} />
                  </Route>
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
