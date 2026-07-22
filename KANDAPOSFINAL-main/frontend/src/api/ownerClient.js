import axios from "axios";
import { tokenStore as staffTokenStore, tenantStore as staffTenantStore } from "./client";

const BASE = `${process.env.REACT_APP_BACKEND_URL}/api/owner`;
const OWNER_TOKEN_KEY = "kanda_owner_token_v1";
const PRE2FA_KEY = "kanda_owner_pre2fa_v1";
const IMP_CTX_KEY = "kanda_owner_impersonation_ctx_v1";
const OWNER_TOKEN_BACKUP_KEY = "kanda_owner_token_backup_v1";

export const ownerToken = {
  get: () => localStorage.getItem(OWNER_TOKEN_KEY),
  set: (t) => localStorage.setItem(OWNER_TOKEN_KEY, t),
  clear: () => localStorage.removeItem(OWNER_TOKEN_KEY),
};

export const pre2faToken = {
  get: () => localStorage.getItem(PRE2FA_KEY),
  set: (t) => localStorage.setItem(PRE2FA_KEY, t),
  clear: () => localStorage.removeItem(PRE2FA_KEY),
};

/** Active impersonation context (null when not impersonating). */
export const impersonationCtx = {
  get: () => {
    try { return JSON.parse(localStorage.getItem(IMP_CTX_KEY) || "null"); }
    catch { return null; }
  },
  set: (ctx) => localStorage.setItem(IMP_CTX_KEY, JSON.stringify(ctx)),
  clear: () => localStorage.removeItem(IMP_CTX_KEY),
};

export const ownerApi = axios.create({ baseURL: BASE });
ownerApi.interceptors.request.use((cfg) => {
  const pre = pre2faToken.get();
  const tok = ownerToken.get();
  const isVerify = cfg.url?.endsWith("/auth/verify");
  if (isVerify && pre) cfg.headers.Authorization = `Bearer ${pre}`;
  else if (tok) cfg.headers.Authorization = `Bearer ${tok}`;
  return cfg;
});

export const ownerAuth = {
  login: (email, password) => ownerApi.post("/auth/login", { email, password }).then((r) => r.data),
  verify: (code) => ownerApi.post("/auth/verify", { code }).then((r) => r.data),
  me: () => ownerApi.get("/auth/me").then((r) => r.data),
};

export const ownerData = {
  kpis: () => ownerApi.get("/kpis").then((r) => r.data),
  tenants: () => ownerApi.get("/tenants").then((r) => r.data),
  tenant: (id) => ownerApi.get(`/tenants/${id}`).then((r) => r.data),
  createTenant: (payload) => ownerApi.post("/tenants", payload).then((r) => r.data),
  impersonate: (id, body) => ownerApi.post(`/tenants/${id}/impersonate`, body).then((r) => r.data),
  totpQr: () => ownerApi.get("/me/totp-qr").then((r) => r.data),
  // Subscriptions
  plans: () => ownerApi.get("/plans").then((r) => r.data),
  billing: (id) => ownerApi.get(`/tenants/${id}/billing`).then((r) => r.data),
  subscribe: (id, plan) => ownerApi.post(`/tenants/${id}/subscribe`, { plan }).then((r) => r.data),
  cancel: (id) => ownerApi.post(`/tenants/${id}/cancel-subscription`).then((r) => r.data),
  // KDS token
  kdsToken: (id) => ownerApi.get(`/tenants/${id}/kds-token`).then((r) => r.data),
  rotateKdsToken: (id) => ownerApi.post(`/tenants/${id}/kds-token/rotate`).then((r) => r.data),
  // Ops
  errors: (params = {}) => ownerApi.get("/ops/errors", { params }).then((r) => r.data),
  audit: (params = {}) => ownerApi.get("/ops/audit", { params }).then((r) => r.data),
  tickets: (params = {}) => ownerApi.get("/ops/support", { params }).then((r) => r.data),
  replyTicket: (id, body) => ownerApi.post(`/ops/support/${id}/reply`, { body }).then((r) => r.data),
  setTicketStatus: (id, status) => ownerApi.patch(`/ops/support/${id}/status`, { status }).then((r) => r.data),
};

/**
 * Begin an impersonation session — swaps the staff token + tenant slug for the
 * tenant-scoped one we just received, while stashing the original owner token
 * so the "Exit" button can restore it.
 */
export function beginImpersonation({ token, tenantSlug, tenantName, mode }) {
  // Stash the owner token + any staff token currently set so we can restore on exit.
  const owner = ownerToken.get();
  if (owner) localStorage.setItem(OWNER_TOKEN_BACKUP_KEY, owner);
  staffTokenStore.set(token);
  staffTenantStore.set(tenantSlug);
  impersonationCtx.set({ tenantSlug, tenantName, mode, startedAt: Date.now() });
}

export function endImpersonation() {
  staffTokenStore.clear();
  staffTenantStore.clear();  // <-- reset host-based tenant detection so /login uses the correct slug
  impersonationCtx.clear();
  const backup = localStorage.getItem(OWNER_TOKEN_BACKUP_KEY);
  if (backup) {
    ownerToken.set(backup);
    localStorage.removeItem(OWNER_TOKEN_BACKUP_KEY);
  }
}
