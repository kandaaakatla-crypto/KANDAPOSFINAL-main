import React from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "./components/ui/sonner";
import { PosProvider, usePos } from "./store/PosContext";
import { OwnerProvider, useOwner } from "./store/OwnerContext";
import LandingPage from "./components/LandingPage";
import LoginScreen from "./components/pos/LoginScreen";
import POSLayout from "./components/pos/POSLayout";
import HomeScreen from "./components/pos/HomeScreen";
import OrdersScreen from "./components/pos/OrdersScreen";
import TablesScreen from "./components/pos/TablesScreen";
import CustomersScreen from "./components/pos/CustomersScreen";
import InventoryScreen from "./components/pos/InventoryScreen";
import MenuScreen from "./components/pos/MenuScreen";
import ReportsScreen from "./components/pos/ReportsScreen";
import DispatchScreen from "./components/pos/DispatchScreen";
import PackingScreen from "./components/pos/PackingScreen";
import CustomerDisplayScreen from "./components/pos/CustomerDisplayScreen";
import TableOrderPage from "./components/storefront/TableOrderPage";
import PickupOrderPage from "./components/storefront/PickupOrderPage";
import BirthdayLinkPage from "./components/storefront/BirthdayLinkPage";
import StaffScreen from "./components/pos/StaffScreen";
import WorkforceScreen from "./components/pos/WorkforceScreen";
import TimeClockScreen from "./components/pos/TimeClockScreen";
import OwnerLogin from "./components/owner/OwnerLogin";
import OwnerTotp from "./components/owner/OwnerTotp";
import OwnerLayout from "./components/owner/OwnerLayout";
import OwnerDashboard from "./components/owner/OwnerDashboard";
import TenantsList from "./components/owner/TenantsList";
import TenantDetail from "./components/owner/TenantDetail";
import CreateTenant from "./components/owner/CreateTenant";
import ErrorLog from "./components/owner/ErrorLog";
import AuditLog from "./components/owner/AuditLog";
import SupportInbox from "./components/owner/SupportInbox";
import KDSBoard from "./components/kds/KDSBoard";
import DriverScreen from "./components/pos/DriverScreen";
import { DashProvider, useDash } from "./store/DashContext";
import DashLogin from "./components/dash/DashLogin";
import DashLayout from "./components/dash/DashLayout";
import DashHome from "./components/dash/DashHome";
import DashChangePassword from "./components/dash/DashChangePassword";
import DashLocations from "./components/dash/DashLocations";
import DashVoice from "./components/dash/DashVoice";
import DashDigest from "./components/dash/DashDigest";
import DashLoyalty from "./components/dash/DashLoyalty";
import DashSchedules from "./components/dash/DashSchedules";
import DashCoupons from "./components/dash/DashCoupons";
import DashGiftCards from "./components/dash/DashGiftCards";
import DashSms from "./components/dash/DashSms";
import DashWhatsApp from "./components/dash/DashWhatsApp";
import PayrollScreen from "./components/dash/PayrollScreen";
import BrandScreen from "./components/dash/BrandScreen";
import DashCentralSupply from "./components/dash/DashCentralSupply";
import AIAssistant from "./components/AIAssistant";
import PrivacyPolicy from "./components/legal/PrivacyPolicy";
import TermsAndConditions from "./components/legal/TermsAndConditions";

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
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </BrowserRouter>
            <Toaster position="top-center" richColors />
          </PosProvider>
        </DashProvider>
      </OwnerProvider>
    </div>
  );
}

export default App;
