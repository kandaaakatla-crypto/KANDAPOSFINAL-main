import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { dashApi } from "../api/client";

const DashContext = createContext(null);
const STORAGE_TOKEN = "kanda_dash_token_v1";
const STORAGE_USER = "kanda_dash_user_v1";

export function DashProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_USER) || "null"); } catch { return null; }
  });
  const [boot, setBoot] = useState(user ? "ready" : "anon");

  // Re-validate the saved token at startup; if expired, clear it.
  useEffect(() => {
    const t = localStorage.getItem(STORAGE_TOKEN);
    if (!t || !user) return;
    dashApi.get("/dash/auth/me").then((r) => {
      setUser(r.data);
      localStorage.setItem(STORAGE_USER, JSON.stringify(r.data));
      setBoot("ready");
    }).catch(() => { logout(); });
  }, []); // eslint-disable-line

  const login = useCallback(async (email, password) => {
    const r = await dashApi.post("/dash/auth/login", { email, password });
    localStorage.setItem(STORAGE_TOKEN, r.data.token);
    localStorage.setItem(STORAGE_USER, JSON.stringify(r.data.user));
    // Mirror the token into the POS client's slot so existing screens (Menu,
    // Staff, Workforce, Coupons) that we reuse under /biz/* authenticate
    // transparently against the same backend endpoints.
    localStorage.setItem("kanda_pos_token_v1", r.data.token);
    // Tenant slug header is read by the POS client interceptor; make sure
    // it's set even when the manager logs in via /biz before visiting /pos.
    if (r.data.user?.tenant_slug) {
      localStorage.setItem("kanda_pos_tenant_slug", r.data.user.tenant_slug);
    }
    setUser(r.data.user);
    setBoot("ready");
    return r.data;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_USER);
    localStorage.removeItem("kanda_pos_token_v1");
    setUser(null);
    setBoot("anon");
  }, []);

  const changePassword = useCallback(async (current_password, new_password) => {
    await dashApi.post("/dash/auth/change-password", { current_password, new_password });
    // Re-fetch user (must_change_password flips false).
    const me = await dashApi.get("/dash/auth/me");
    setUser(me.data);
    localStorage.setItem(STORAGE_USER, JSON.stringify(me.data));
  }, []);

  return (
    <DashContext.Provider value={{ user, boot, login, logout, changePassword, api: dashApi }}>
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
