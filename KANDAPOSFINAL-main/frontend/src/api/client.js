import axios from "axios";

const BASE = `${process.env.REACT_APP_BACKEND_URL}/api`;
const TOKEN_KEY = "kanda_pos_token_v1";
const TENANT_KEY = "kanda_pos_tenant_slug";
const DASH_TOKEN_KEY = "kanda_dash_token_v1";

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

// In-memory only (never localStorage) — lets /demo/login use the "demo"
// tenant for its own calls without overwriting a real device's pinned
// restaurant. Cleared automatically on reload/tab-close, unlike everything
// else in tenantStore.
let ephemeralSlug = null;

/**
 * Resolve the tenant slug for the current browser session.
 * 1. Honour an in-memory-only ephemeral override (set by /demo/login) — never persisted.
 * 2. If the hostname looks like `<slug>.kanda.<tld>` (production) → return slug.
 * 3. Else honour a `?tenant=slug` query param (persisted so it survives once set —
 *    lets a single shareable link pin a tenant on hosts without subdomains, e.g. local/LAN dev).
 * 4. Else honour an explicit override in localStorage — this is how a POS device gets
 *    "registered" to a restaurant via the /pos/:slug/login screen.
 * 5. Else return null — no default tenant. Callers route through /pos/login's
 *    Restaurant ID gate instead of silently landing on someone else's data.
 */
function detectTenantSlug() {
  if (ephemeralSlug) return ephemeralSlug;
  if (typeof window === "undefined") return null;
  const host = window.location.hostname;
  const parts = host.split(".");
  if (parts.length >= 3 && parts[1] === "kanda") {
    return parts[0].toLowerCase();
  }
  const fromQuery = new URLSearchParams(window.location.search).get("tenant");
  if (fromQuery) {
    const slug = fromQuery.toLowerCase();
    localStorage.setItem(TENANT_KEY, slug);
    return slug;
  }
  const stored = localStorage.getItem(TENANT_KEY);
  return stored ? stored.toLowerCase() : null;
}

export const tenantStore = {
  get: detectTenantSlug,
  set: (slug) => localStorage.setItem(TENANT_KEY, slug),
  clear: () => localStorage.removeItem(TENANT_KEY),  // fall back to host detection / no tenant
  setEphemeral: (slug) => { ephemeralSlug = slug; },
  clearEphemeral: () => { ephemeralSlug = null; },
};

// Per-restaurant "this till is unlocked" token, issued once when a manager
// signs in on the till (POST /pos-devices/register) and kept until the till
// is removed from the dashboard. Keyed by restaurant slug so one browser can
// be unlocked for more than one restaurant without them overwriting each
// other. Sent as X-Device-Token; staff PIN sign-in and the time clock need it.
const DEVICE_KEY_PREFIX = "kanda_pos_device_v1:";
export const deviceStore = {
  get: (slug) => (slug ? localStorage.getItem(DEVICE_KEY_PREFIX + slug.toLowerCase()) : null),
  set: (slug, t) => localStorage.setItem(DEVICE_KEY_PREFIX + slug.toLowerCase(), t),
  clear: (slug) => slug && localStorage.removeItem(DEVICE_KEY_PREFIX + slug.toLowerCase()),
};

// True for the server's "this till isn't unlocked" refusal.
export const isDeviceLocked = (err) =>
  err?.response?.status === 403 && err?.response?.data?.detail?.code === "device_not_registered";

// Some screens under components/pos/ (Rota, Reports, and formerly Customers)
// are reused as-is for Dashboard routes that have no staff PIN session at
// all — only a dashboard login. The backend's get_current_user already
// accepts a dash JWT on these same endpoints (it synthesizes a Manager-role
// staff dict from it — see auth.py), so falling back to the dash token here
// when there's no POS token lets those shared screens work from the
// Dashboard without needing a parallel rewrite of each one. A real POS
// terminal always has a POS token once signed in, so this never overrides
// genuine staff-PIN auth — it only fires in the gap a POS-only session
// leaves empty.
function resolveAuthToken() {
  return tokenStore.get() || localStorage.getItem(DASH_TOKEN_KEY);
}
export { resolveAuthToken as authToken };

export const api = axios.create({ baseURL: BASE });

api.interceptors.request.use((cfg) => {
  // Always send the tenant slug when this browser knows one, signed in or
  // not. The unauthenticated calls need it most: /auth/login,
  // /tenant/public-info and the time clock resolve the restaurant from this
  // header alone, and the backend falls back to the "demo" tenant when it is
  // missing — so dropping it before sign-in silently logged every
  // /pos/:slug/login PIN pad into the demo restaurant. Authenticated
  // endpoints ignore it (the JWT carries tenant_id).
  const slug = tenantStore.get();
  if (slug) {
    cfg.headers["X-Tenant-Slug"] = slug;
    const device = deviceStore.get(slug);
    if (device) cfg.headers["X-Device-Token"] = device;
  }
  const t = tokenStore.get();
  if (t) {
    cfg.headers.Authorization = `Bearer ${t}`;
  } else {
    // No POS session in this browser — fall back to a dashboard session if
    // one exists (see resolveAuthToken above).
    const dashToken = localStorage.getItem(DASH_TOKEN_KEY);
    if (dashToken) cfg.headers.Authorization = `Bearer ${dashToken}`;
  }
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    // A 401 from a PIN check (staff sign-in, time clock punch) means "wrong
    // PIN", not "session expired" — it must not sign the till or dashboard
    // out or reload the page away from the keypad.
    const url = err?.config?.url || "";
    const isPinCheck = url.endsWith("/auth/login") || url.endsWith("/timeclock/punch");
    if (err?.response?.status === 401 && !isPinCheck) {
      const usedDashFallback = !tokenStore.get() && !!localStorage.getItem(DASH_TOKEN_KEY);
      if (usedDashFallback) {
        // The dash session itself is what's invalid here (POS token was
        // already absent) — bounce to the dashboard's own login, not the
        // POS one, and clear the dash session the same way dashApi does.
        localStorage.removeItem(DASH_TOKEN_KEY);
        localStorage.removeItem("kanda_dash_user_v1");
        if (typeof window !== "undefined" && !window.location.pathname.startsWith("/dashboard/login")) {
          window.location.assign("/dashboard/login");
        }
      } else {
        tokenStore.clear();
        // bounce only if not on login already to avoid redirect loops
        if (typeof window !== "undefined" && !window.location.pathname.startsWith("/pos/login")) {
          window.location.assign("/pos/login");
        }
      }
    }
    return Promise.reject(err);
  }
);

// Dedicated client for dashboard-only endpoints (Daily Digest, dash account
// routes) that require the strict dash JWT (`dash: true` claim). These must
// NOT go through the shared `api` instance above: that one reads whatever
// token last landed in the POS slot, which a staff PIN login in another tab
// can silently overwrite — leaving the dashboard 403'ing with no clear way
// to recover. Reading straight from the dash token slot avoids that.
export const dashApi = axios.create({ baseURL: BASE });
dashApi.interceptors.request.use((cfg) => {
  const t = localStorage.getItem(DASH_TOKEN_KEY);
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});
dashApi.interceptors.response.use(
  (r) => r,
  (err) => {
    // 401 = the dash session itself is gone/expired — bounce to re-login.
    // (403 is left alone: that's a validly-logged-in dash user who simply
    // lacks the role for this endpoint, which isn't fixed by logging out.)
    if (err?.response?.status === 401) {
      localStorage.removeItem(DASH_TOKEN_KEY);
      localStorage.removeItem("kanda_dash_user_v1");
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/dashboard/login")) {
        window.location.assign("/dashboard/login");
      }
    }
    return Promise.reject(err);
  }
);

// Brand — franchise/multi-store management, owner-only. Uses dashApi since
// every /brand/* route requires the strict dash JWT (get_dash_user).
export const brandApi = {
  create: (payload) => dashApi.post("/brand", payload).then((r) => r.data),
  get: (id) => dashApi.get(`/brand/${id}`).then((r) => r.data),
  update: (id, payload) => dashApi.patch(`/brand/${id}`, payload).then((r) => r.data),
  listStores: (id) => dashApi.get(`/brand/${id}/stores`).then((r) => r.data),
  rollup: (id, params = {}) => dashApi.get(`/brand/${id}/rollup`, { params }).then((r) => r.data),
  royalties: (id, params = {}) => dashApi.get(`/brand/${id}/royalties`, { params }).then((r) => r.data),
  createStore: (id, payload) => dashApi.post(`/brand/${id}/stores`, payload).then((r) => r.data),
  pushMenuTemplate: (id) => dashApi.post(`/brand/${id}/menu-template/push`).then((r) => r.data),
  pushDefaults: (id) => dashApi.post(`/brand/${id}/defaults/push`).then((r) => r.data),
  listAssets: (id) => dashApi.get(`/brand/${id}/assets`).then((r) => r.data),
  createAsset: (id, payload) => dashApi.post(`/brand/${id}/assets`, payload).then((r) => r.data),
  deleteAsset: (id, assetId) => dashApi.delete(`/brand/${id}/assets/${assetId}`).then((r) => r.data),
  smsBroadcast: (id, payload) => dashApi.post(`/brand/${id}/marketing/sms-broadcast`, payload).then((r) => r.data),
  switchStore: (tenantId) => dashApi.post("/dash/brand/switch", { tenant_id: tenantId }).then((r) => r.data),

  // Pay-per-store billing
  billing: (id) => dashApi.get(`/brand/${id}/billing`).then((r) => r.data),
  purchaseStoreSlot: (id) => dashApi.post(`/brand/${id}/payments/purchase-store-slot`).then((r) => r.data),
  verifyStoreSlot: (id, payload) => dashApi.post(`/brand/${id}/payments/verify`, payload).then((r) => r.data),

  // Per-store royalty override
  updateStoreRoyalty: (id, tenantId, royaltyPercent) =>
    dashApi.patch(`/brand/${id}/stores/${tenantId}/royalty`, { royalty_percent: royaltyPercent }).then((r) => r.data),

  // Royalty invoices
  generateInvoices: (id, payload) => dashApi.post(`/brand/${id}/royalties/invoices/generate`, payload).then((r) => r.data),
  listInvoices: (id) => dashApi.get(`/brand/${id}/royalties/invoices`).then((r) => r.data),
  updateInvoiceStatus: (id, invoiceId, status) =>
    dashApi.patch(`/brand/${id}/royalties/invoices/${invoiceId}`, { status }).then((r) => r.data),
  downloadInvoicePdf: async (id, invoiceId) => {
    const r = await dashApi.get(`/brand/${id}/royalties/invoices/${invoiceId}/pdf`, { responseType: "blob" });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `royalty_invoice_${invoiceId}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },

  // Existing-store invites (sent, by the brand owner)
  sendInvite: (id, tenantSlug) => dashApi.post(`/brand/${id}/invites`, { tenant_slug: tenantSlug }).then((r) => r.data),
  listSentInvites: (id) => dashApi.get(`/brand/${id}/invites`).then((r) => r.data),
  cancelInvite: (id, inviteId) => dashApi.delete(`/brand/${id}/invites/${inviteId}`).then((r) => r.data),

  // Existing-store invites (received, by the invited store's own owner)
  myPendingInvites: () => dashApi.get("/dash/brand/invites").then((r) => r.data),
  acceptInvite: (inviteId) => dashApi.post(`/dash/brand/invites/${inviteId}/accept`).then((r) => r.data),
  declineInvite: (inviteId) => dashApi.post(`/dash/brand/invites/${inviteId}/decline`).then((r) => r.data),
};

export const centralSupplyApi = {
  listItems: (id) => dashApi.get(`/brand/${id}/supply/items`).then((r) => r.data),
  createItem: (id, payload) => dashApi.post(`/brand/${id}/supply/items`, payload).then((r) => r.data),
  updateItem: (id, itemId, payload) => dashApi.patch(`/brand/${id}/supply/items/${itemId}`, payload).then((r) => r.data),
  removeItem: (id, itemId) => dashApi.delete(`/brand/${id}/supply/items/${itemId}`).then((r) => r.data),
  restock: (id, itemId, delta) => dashApi.patch(`/brand/${id}/supply/items/${itemId}/restock`, { delta }).then((r) => r.data),
  push: (id, itemId, payload) => dashApi.post(`/brand/${id}/supply/items/${itemId}/push`, payload).then((r) => r.data),
  log: (id) => dashApi.get(`/brand/${id}/supply/log`).then((r) => r.data),
};

export const auth = {
  login: (pin) => api.post("/auth/login", { pin }).then((r) => r.data),
  me: () => api.get("/auth/me").then((r) => r.data),
};

export const tenantApi = {
  info: () => api.get("/tenant/info").then((r) => r.data),
  updateFeatures: (payload) => api.patch("/tenant/features", payload).then((r) => r.data),
};

export const menuApi = {
  categories: (since) => api.get("/menu/categories", { params: since ? { since } : undefined }).then((r) => r.data),
  items: (since) => api.get("/menu/items", { params: since ? { since } : undefined }).then((r) => r.data),
  create: (payload) => api.post("/menu/items", payload).then((r) => r.data),
  update: (id, payload) => api.put(`/menu/items/${id}`, payload).then((r) => r.data),
  remove: (id) => api.delete(`/menu/items/${id}`).then((r) => r.data),
  setAvailability: (id, available) =>
    api.patch(`/menu/items/${id}/availability`, { available }).then((r) => r.data),
  createCategory: (payload) => api.post("/menu/categories", payload).then((r) => r.data),
  updateCategory: (id, payload) => api.put(`/menu/categories/${id}`, payload).then((r) => r.data),
  removeCategory: (id) => api.delete(`/menu/categories/${id}`).then((r) => r.data),
  reorderCategories: (order) => api.patch("/menu/categories/reorder", { order }).then((r) => r.data),
  listRecipes: (itemId) => api.get(`/menu/items/${itemId}/recipes`).then((r) => r.data),
  saveRecipes: (itemId, recipes) => api.put(`/menu/items/${itemId}/recipes`, { recipes }).then((r) => r.data),
};

export const menuSchedulesApi = {
  list: (since) => api.get("/menu/schedules", { params: since ? { since } : undefined }).then((r) => r.data),
  create: (payload) => api.post("/menu/schedules", payload).then((r) => r.data),
  update: (id, payload) => api.put(`/menu/schedules/${id}`, payload).then((r) => r.data),
  remove: (id) => api.delete(`/menu/schedules/${id}`).then((r) => r.data),
};

export const tablesApi = {
  list: (since) => api.get("/tables", { params: since ? { since } : undefined }).then((r) => r.data),
  update: (id, payload) => api.patch(`/tables/${id}`, payload).then((r) => r.data),
  create: (payload) => api.post("/tables", payload).then((r) => r.data),
  remove: (id) => api.delete(`/tables/${id}`).then((r) => r.data),
  setPosition: (id, payload) => api.patch(`/tables/${id}/position`, payload).then((r) => r.data),
  listFloor: () => api.get("/tables/floor").then((r) => r.data),
  createFloor: (payload) => api.post("/tables/floor", payload).then((r) => r.data),
  updateFloor: (id, payload) => api.patch(`/tables/floor/${id}`, payload).then((r) => r.data),
  removeFloor: (id) => api.delete(`/tables/floor/${id}`).then((r) => r.data),
  qr: (id) => api.get(`/tables/${id}/qr`).then((r) => r.data),
  pickupQr: () => api.get("/tables/pickup-qr").then((r) => r.data),
};

export const kioskApi = {
  myToken: () => api.get("/kds/my-token").then((r) => r.data),
};

export const reservationsApi = {
  list: (params = {}) => api.get("/reservations", { params }).then((r) => r.data),
  create: (payload) => api.post("/reservations", payload).then((r) => r.data),
  update: (id, payload) => api.patch(`/reservations/${id}`, payload).then((r) => r.data),
  remove: (id) => api.delete(`/reservations/${id}`).then((r) => r.data),
};

export const customersApi = {
  list: (since) => api.get("/customers", { params: since ? { since } : undefined }).then((r) => r.data),
  trash: () => api.get("/customers/trash").then((r) => r.data),
  search: (phone) => api.get("/customers/search", { params: { phone } }).then((r) => r.data),
  create: (payload) => api.post("/customers", payload).then((r) => r.data),
  update: (id, payload) => api.put(`/customers/${id}`, payload).then((r) => r.data),
  remove: (id) => api.delete(`/customers/${id}`).then((r) => r.data),
  restore: (id) => api.post(`/customers/${id}/restore`).then((r) => r.data),
};

export const inventoryApi = {
  list: (since) => api.get("/inventory", { params: since ? { since } : undefined }).then((r) => r.data),
  create: (payload) => api.post("/inventory", payload).then((r) => r.data),
  update: (id, payload) => api.patch(`/inventory/${id}`, payload).then((r) => r.data),
  remove: (id) => api.delete(`/inventory/${id}`).then((r) => r.data),
  adjust: (id, delta) => api.patch(`/inventory/${id}/adjust`, { delta }).then((r) => r.data),
  reorder: (id) => api.post(`/inventory/${id}/reorder`).then((r) => r.data),
  transfer: (id, payload) => api.post(`/inventory/${id}/transfer`, payload).then((r) => r.data),
  transfers: () => api.get("/inventory/transfers").then((r) => r.data),
  downloadPoPdf: async (id, itemName) => {
    const r = await api.get(`/inventory/${id}/reorder.pdf`, { responseType: "blob" });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `PO_${(itemName || id).replace(/\s+/g, "_")}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
};

export const suppliersApi = {
  list: () => api.get("/suppliers").then((r) => r.data),
  create: (payload) => api.post("/suppliers", payload).then((r) => r.data),
  update: (id, payload) => api.patch(`/suppliers/${id}`, payload).then((r) => r.data),
  remove: (id) => api.delete(`/suppliers/${id}`).then((r) => r.data),
};

export const ordersApi = {
  list: () => api.get("/orders").then((r) => r.data),
  create: (payload) => api.post("/orders", payload).then((r) => r.data),
  appendItems: (id, items) => api.post(`/orders/${id}/append`, { items }).then((r) => r.data),
  setStatus: (id, status) => api.patch(`/orders/${id}/status`, { status }).then((r) => r.data),
  assignDriver: (id, driver) => api.patch(`/orders/${id}/driver`, { driver }).then((r) => r.data),
  setPayment: (id, payment) => api.patch(`/orders/${id}/payment`, { payment }).then((r) => r.data),
  claim: (id) => api.post(`/orders/${id}/claim`).then((r) => r.data),
  setPacked: (id, packed) => api.patch(`/orders/${id}/pack`, { packed }).then((r) => r.data),
  setCustomer: (id, customer) => api.patch(`/orders/${id}/customer`, customer).then((r) => r.data),
  setServiceCharge: (id, pct) => api.patch(`/orders/${id}/service-charge`, { pct }).then((r) => r.data),
};

export const usersApi = {
  drivers: () => api.get("/users/drivers").then((r) => r.data),
};

export const paymentsApi = {
  createRazorpayOrder: (orderId, amount) =>
    api.post("/payments/order", { orderId, amount }).then((r) => r.data),
  verify: (payload) => api.post("/payments/verify", payload).then((r) => r.data),
};

export const plansApi = {
  list: () => api.get("/plans").then((r) => r.data),
  purchaseLocation: () => api.post("/payments/purchase-location").then((r) => r.data),
  verify: (payload) => api.post("/payments/verify", payload).then((r) => r.data),
  status: (order_id) => api.get(`/payments/status/${order_id}`).then((r) => r.data),
};

export const reportsApi = {
  summary: () => api.get("/reports/summary").then((r) => r.data),
  dailyRollup: (days = 30) =>
    api.get("/reports/daily-rollup", { params: { days } }).then((r) => r.data),
  rebuildRollups: (days = 30) =>
    api.post("/reports/daily-rollup/rebuild", null, { params: { days } }).then((r) => r.data),
  menuEngineering: (days = 30) =>
    api.get("/reports/menu-engineering", { params: { days } }).then((r) => r.data),
};

export const billingApi = {
  status: () => api.get("/billing/status").then((r) => r.data),
};

export const supportApi = {
  create: (payload) => api.post("/support/tickets", payload).then((r) => r.data),
  list: () => api.get("/support/tickets").then((r) => r.data),
};

export const staffApi = {
  list: () => api.get("/staff").then((r) => r.data),
  create: (payload) => api.post("/staff", payload).then((r) => r.data),
  update: (id, payload) => api.put(`/staff/${id}`, payload).then((r) => r.data),
  remove: (id) => api.delete(`/staff/${id}`).then((r) => r.data),
};

export const posDevicesApi = {
  // Public — authorised by the manager's email + password in the body, for
  // the restaurant named by X-Tenant-Slug.
  register: (payload) => api.post("/pos-devices/register", payload).then((r) => r.data),
  list: () => api.get("/pos-devices").then((r) => r.data),
  remove: (id) => api.delete(`/pos-devices/${id}`).then((r) => r.data),
};

export const timeclockApi = {
  punch: (payload) =>
    // Public-ish endpoint — uses X-Tenant-Slug header from the interceptor.
    api.post("/timeclock/punch", payload).then((r) => r.data),
  current: () => api.get("/timeclock/current").then((r) => r.data),
  punches: (params = {}) => api.get("/timeclock/punches", { params }).then((r) => r.data),
  insertManual: (userId, payload) =>
    api.post(`/timeclock/punches/${userId}`, payload).then((r) => r.data),
  removePunch: (id) => api.delete(`/timeclock/punches/${id}`).then((r) => r.data),
  timesheet: (params = {}) => api.get("/timeclock/timesheet", { params }).then((r) => r.data),
};

export const payrollApi = {
  summary: (params = {}) => api.get("/payroll/summary", { params }).then((r) => r.data),
};

export const shiftsApi = {
  list: (params = {}) => api.get("/shifts", { params }).then((r) => r.data),
  create: (payload) => api.post("/shifts", payload).then((r) => r.data),
  update: (id, payload) => api.patch(`/shifts/${id}`, payload).then((r) => r.data),
  remove: (id) => api.delete(`/shifts/${id}`).then((r) => r.data),
  publish: (start, end) => api.post("/shifts/publish", null, { params: { start, end } }).then((r) => r.data),
  copyWeek: (sourceStart, targetStart) => api.post("/shifts/copy-week", { source_start: sourceStart, target_start: targetStart }).then((r) => r.data),
  exportPdfUrl: (start, end) => {
    const base = (process.env.REACT_APP_BACKEND_URL || "") + "/api";
    return `${base}/shifts.pdf?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  },
};

export const wasteApi = {
  list: (params = {}) => api.get("/waste", { params }).then((r) => r.data),
  log: (payload) => api.post("/waste", payload).then((r) => r.data),
};

export const cashDrawerApi = {
  current: () => api.get("/cashdrawer/current").then((r) => r.data),
  open: (payload) => api.post("/cashdrawer/open", payload).then((r) => r.data),
  close: (payload) => api.post("/cashdrawer/close", payload).then((r) => r.data),
  history: (params = {}) => api.get("/cashdrawer/history", { params }).then((r) => r.data),
};

export const tipsApi = {
  list: () => api.get("/tips").then((r) => r.data),
  create: (payload) => api.post("/tips", payload).then((r) => r.data),
  remove: (id) => api.delete(`/tips/${id}`).then((r) => r.data),
};

export const couponsApi = {
  list: () => api.get("/coupons").then((r) => r.data),
  create: (payload) => api.post("/coupons", payload).then((r) => r.data),
  update: (id, payload) => api.patch(`/coupons/${id}`, payload).then((r) => r.data),
  remove: (id) => api.delete(`/coupons/${id}`).then((r) => r.data),
  apply: (code, subtotal) => api.post("/coupons/apply", { code, subtotal }).then((r) => r.data),
};

export const locationsApi = {
  list: () => api.get("/locations").then((r) => r.data),
  create: (payload) => api.post("/locations", payload).then((r) => r.data),
  update: (id, payload) => api.patch(`/locations/${id}`, payload).then((r) => r.data),
  remove: (id) => api.delete(`/locations/${id}`).then((r) => r.data),
};

export const prepApi = {
  list: (horizon_hours = 24) =>
    api.get("/prep-list", { params: { horizon_hours } }).then((r) => r.data),
};

export const refundsApi = {
  refund: (orderId, payload) => api.post(`/orders/${orderId}/refund`, payload).then((r) => r.data),
  void: (orderId, payload) => api.post(`/orders/${orderId}/void`, payload).then((r) => r.data),
  log: () => api.get("/refunds/log").then((r) => r.data),
};

export const loyaltyApi = {
  get: (customerId) => api.get(`/customers/${customerId}/loyalty`).then((r) => r.data),
  adjust: (customerId, payload) => api.post(`/customers/${customerId}/loyalty/adjust`, payload).then((r) => r.data),
  lookup: (phone) => api.get("/loyalty/lookup", { params: { phone } }).then((r) => r.data),
  getConfig: () => api.get("/loyalty/config").then((r) => r.data),
  saveConfig: (cfg) => api.put("/loyalty/config", cfg).then((r) => r.data),
  overview: () => api.get("/loyalty/overview").then((r) => r.data),
  txns: (limit = 100) => api.get("/loyalty/txns", { params: { limit } }).then((r) => r.data),
  requestBirthdays: (customerIds = null) => api.post("/loyalty/birthday-request", { customer_ids: customerIds }).then((r) => r.data),
};

/** Fully public client for the birthday self-report link — no staff/dash
 *  token involved, mirrors storefrontApi's pattern. */
export const publicLoyaltyApi = {
  getBirthdayLink: (token) => axios.get(`${BASE}/loyalty/birthday-link/${token}`).then((r) => r.data),
  submitBirthday: (token, birthday) => axios.post(`${BASE}/loyalty/birthday-link/${token}`, { birthday }).then((r) => r.data),
};

export const storeCreditApi = {
  get: (customerId) => api.get(`/customers/${customerId}/credit`).then((r) => r.data),
  adjust: (customerId, payload) => api.post(`/customers/${customerId}/credit/adjust`, payload).then((r) => r.data),
  lookup: (phone) => api.get("/credit/lookup", { params: { phone } }).then((r) => r.data),
};

export const giftCardsApi = {
  list: () => api.get("/gift-cards").then((r) => r.data),
  create: (payload) => api.post("/gift-cards", payload).then((r) => r.data),
  lookup: (code) => api.get("/gift-cards/lookup", { params: { code } }).then((r) => r.data),
  cancel: (id) => api.patch(`/gift-cards/${id}/cancel`).then((r) => r.data),
};

export const voiceApi = {
  config: () => api.get("/voice/config").then((r) => r.data),
  saveConfig: (payload) => api.put("/voice/config", payload).then((r) => r.data),
  configureTwilio: () => api.post("/voice/configure-twilio").then((r) => r.data),
  calls: (limit = 50) => api.get("/voice/calls", { params: { limit } }).then((r) => r.data),
  call: (id) => api.get(`/voice/calls/${id}`).then((r) => r.data),
  activeCalls: () => api.get("/voice/calls/active").then((r) => r.data),
  whisper: (id, message) => api.post(`/voice/calls/${id}/whisper`, { message }).then((r) => r.data),
  testCall: (payload) => api.post("/voice/call", payload).then((r) => r.data),
  recordingUrl: (id) => `${BASE}/voice/calls/${id}/recording.mp3`,
  recordingBlob: (id) => api.get(`/voice/calls/${id}/recording.mp3`, { responseType: "blob" }).then((r) => r.data),
  searchNumbers: (params) => api.get("/voice/numbers/available", { params }).then((r) => r.data),
  ownedNumbers: () => api.get("/voice/numbers/owned").then((r) => r.data),
  purchaseNumber: (payload) => api.post("/voice/numbers/purchase", payload).then((r) => r.data),
};

// QR ordering branding (logo + background photo on the storefront) — a
// dashboard-only settings screen, so this goes through dashApi like
// digestApi below rather than the POS-only `api` client.
export const brandingApi = {
  upload: (field, file) => {
    const form = new FormData();
    form.append("field", field);
    form.append("file", file);
    return dashApi.post("/tenant/store/branding", form).then((r) => r.data);
  },
  clear: (field) => dashApi.delete("/tenant/store/branding", { params: { field } }).then((r) => r.data),
};

export const digestApi = {
  getConfig: () => dashApi.get("/digest/config").then((r) => r.data),
  saveConfig: (cfg) => dashApi.put("/digest/config", cfg).then((r) => r.data),
  preview: () => dashApi.get("/digest/preview").then((r) => r.data),
  sendNow: (payload = {}) => dashApi.post("/digest/send-now", payload).then((r) => r.data),
};

export const smsApi = {
  send: (to, body, customer_id = null) =>
    api.post("/sms/send", { to, body, customer_id }).then((r) => r.data),
  broadcast: (body, { customer_ids = [], phones = [] } = {}) =>
    api.post("/sms/broadcast", { body, customer_ids, phones }).then((r) => r.data),
  history: (limit = 100) => api.get("/sms/history", { params: { limit } }).then((r) => r.data),
};

export const whatsappApi = {
  conversations: () => api.get("/whatsapp/conversations").then((r) => r.data),
  messages: (convId, limit = 200) =>
    api.get(`/whatsapp/conversations/${convId}/messages`, { params: { limit } }).then((r) => r.data),
  markRead: (convId) => api.post(`/whatsapp/conversations/${convId}/read`).then((r) => r.data),
  send: (to, body) => api.post("/whatsapp/send", { to, body }).then((r) => r.data),
  start: (to) => api.post("/whatsapp/conversations/start", { to, body: "-" }).then((r) => r.data),
  sandboxInfo: () => api.get("/whatsapp/sandbox-info").then((r) => r.data),
  templates: () => api.get("/whatsapp/templates").then((r) => r.data),
  sendTemplate: (to, content_sid, variables = {}) =>
    api.post("/whatsapp/send-template", { to, content_sid, variables }).then((r) => r.data),
};

export const onboardingApi = {
  status: () => api.get("/onboarding/status").then((r) => r.data),
  dismiss: () => api.post("/onboarding/dismiss").then((r) => r.data),
};

export const labourApi = {
  today: () => api.get("/reports/labour").then((r) => r.data),
  rollup: (days = 30) => api.get("/reports/daily-rollup", { params: { days } }).then((r) => r.data),
};

export const receiptsApi = {
  json: (orderId) => api.get(`/orders/${orderId}/receipt`).then((r) => r.data),
  escposUrl: (orderId, kind = "customer") => {
    const t = tokenStore.get();
    // browser navigation download URL — backend allows query token fallback via interceptor not in scope,
    // so the easier path is fetch with auth header and trigger a blob download.
    return { orderId, kind, token: t };
  },
  downloadEscpos: async (orderId, kind = "customer") => {
    const r = await api.get(`/orders/${orderId}/receipt/escpos`, {
      params: { kind }, responseType: "blob",
    });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `receipt_${orderId}_${kind}.bin`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
  downloadInvoicePdf: async (orderId, orderNumber) => {
    const r = await api.get(`/orders/${orderId}/invoice.pdf`, { responseType: "blob" });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice_${orderNumber || orderId}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
};
