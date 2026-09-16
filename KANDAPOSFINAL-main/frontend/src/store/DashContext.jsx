import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { dashApi, brandApi } from "../api/client";

const DashContext = createContext(null);
const STORAGE_TOKEN = "kanda_dash_token_v1";
const STORAGE_USER = "kanda_dash_user_v1";

const DEFAULT_FEATURES = {
  tables: true, kitchen_display: true, packing_station: true, dispatch: true, meal_deals: true, pizza_sizing: true,
  qr_ordering: true, online_payments: true, loyalty: true, customer_display: true,
  voice_agent: true, customer_sms: true, whatsapp: true, daily_digest: true, payroll: true,
};

export function DashProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_USER) || "null"); } catch { return null; }
  });
  const [boot, setBoot] = useState(user ? "ready" : "anon");
  const [tenantInfo, setTenantInfo] = useState(null);
  const [lowStockCount, setLowStockCount] = useState(0);

  const loadTenantInfo = useCallback(() => {
    dashApi.get("/tenant/info").then((r) => setTenantInfo(r.data)).catch(() => {});
  }, []);

  // Shared with the sidebar nav badge as well as the KPI row on DashHome —
  // fetched once here so both read the same number instead of two
  // independent polls of the same endpoint.
  const loadLowStock = useCallback(() => {
    dashApi.get("/inventory").then((r) => setLowStockCount(r.data.filter((i) => i.stock <= i.reorder).length)).catch(() => {});
  }, []);

  // Re-validate the saved token at startup; if expired, clear it.
  useEffect(() => {
    const t = localStorage.getItem(STORAGE_TOKEN);
    if (!t || !user) return;
    dashApi.get("/dash/auth/me").then((r) => {
      setUser(r.data);
      localStorage.setItem(STORAGE_USER, JSON.stringify(r.data));
      setBoot("ready");
      loadTenantInfo();
      loadLowStock();
    }).catch(() => { logout(); });
  }, []); // eslint-disable-line

  const login = useCallback(async (email, password) => {
    const r = await dashApi.post("/dash/auth/login", { email, password });
    localStorage.setItem(STORAGE_TOKEN, r.data.token);
    localStorage.setItem(STORAGE_USER, JSON.stringify(r.data.user));
    // Mirror the token into the POS client's slot so existing screens (Menu,
    // Staff, Workforce, Coupons) that we reuse under /dashboard/* authenticate
    // transparently against the same backend endpoints.
    localStorage.setItem("kanda_pos_token_v1", r.data.token);
    // Tenant slug header is read by the POS client interceptor; make sure
    // it's set even when the manager logs in via /dashboard before visiting /pos.
    if (r.data.user?.tenant_slug) {
      localStorage.setItem("kanda_pos_tenant_slug", r.data.user.tenant_slug);
    }
    setUser(r.data.user);
    setBoot("ready");
    loadTenantInfo();
    loadLowStock();
    return r.data;
  }, [loadTenantInfo, loadLowStock]);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_USER);
    localStorage.removeItem("kanda_pos_token_v1");
    setUser(null);
    setTenantInfo(null);
    setBoot("anon");
  }, []);

  const changePassword = useCallback(async (current_password, new_password) => {
    await dashApi.post("/dash/auth/change-password", { current_password, new_password });
    // Re-fetch user (must_change_password flips false).
    const me = await dashApi.get("/dash/auth/me");
    setUser(me.data);
    localStorage.setItem(STORAGE_USER, JSON.stringify(me.data));
  }, []);

  // Brand owners can switch their active store — mints a token scoped to a
  // different tenant under the same brand. Hard-reloads afterwards so every
  // screen's own local state (menu, staff, orders...) re-fetches fresh for
  // the newly-active store instead of showing data cached from the last one.
  const switchStore = useCallback(async (tenantId) => {
    const r = await brandApi.switchStore(tenantId);
    localStorage.setItem(STORAGE_TOKEN, r.token);
    localStorage.setItem(STORAGE_USER, JSON.stringify(r.user));
    localStorage.setItem("kanda_pos_token_v1", r.token);
    if (r.user?.tenant_slug) {
      localStorage.setItem("kanda_pos_tenant_slug", r.user.tenant_slug);
    }
    window.location.assign("/dashboard");
  }, []);

  const features = { ...DEFAULT_FEATURES, ...(tenantInfo?.features || {}) };
  const businessType = tenantInfo?.businessType || "restaurant";

  return (
    <DashContext.Provider value={{ user, boot, login, logout, changePassword, switchStore, api: dashApi, tenantInfo, features, businessType, lowStockCount, refreshLowStock: loadLowStock }}>
      {children}
    </DashContext.Provider>
  );
}

export function useDash() {
  const c = useContext(DashContext);
  if (!c) throw new Error("useDash must be used within DashProvider");
  return c;
}

// Role helpers consumed by route guards + nav.
export const canManageStaff = (u) => u && (u.dash_role === "owner" || u.dash_role === "area_manager");
export const canEditMenu = (u) => !!u; // all 3 roles can edit menu (per user spec — manager edits via dashboard)
export const canManageCoupons = (u) => !!u;
export const canManageWorkforce = (u) => !!u; // all roles see workforce; scope filtered by location_ids
export const canAddLocation = (u) => u && u.dash_role === "owner"; // payment-gated, owner only
export const canManagePayroll = (u) => u && (u.dash_role === "owner" || u.dash_role === "area_manager"); // wage data — same trust level as staff management
export const canManageLoyalty = (u) => u && (u.dash_role === "owner" || u.dash_role === "area_manager"); // program rules affect margin — same trust level as payroll
export const canManageGiftCards = (u) => u && (u.dash_role === "owner" || u.dash_role === "area_manager"); // issues real prepaid balance — same trust level as payroll/loyalty
