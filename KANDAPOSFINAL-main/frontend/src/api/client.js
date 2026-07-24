import axios from "axios";

const BASE = `${process.env.REACT_APP_BACKEND_URL}/api`;
const TOKEN_KEY = "kanda_pos_token_v1";
const TENANT_KEY = "kanda_pos_tenant_slug";

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

/**
 * Resolve the tenant slug for the current browser session.
 * 1. If the hostname looks like `<slug>.kanda.<tld>` (production) → return slug.
 * 2. Else honour an explicit override in localStorage.
 * 3. Else default to "demo" (preview / local dev / single-tenant deployments).
 */
function detectTenantSlug() {
  if (typeof window === "undefined") return "demo";
  const host = window.location.hostname;
  const parts = host.split(".");
  if (parts.length >= 3 && parts[1] === "kanda") {
    return parts[0].toLowerCase();
  }
  return (localStorage.getItem(TENANT_KEY) || "demo").toLowerCase();
}

export const tenantStore = {
  get: detectTenantSlug,
  set: (slug) => localStorage.setItem(TENANT_KEY, slug),
  clear: () => localStorage.removeItem(TENANT_KEY),  // fall back to host detection / "demo"
};

export const api = axios.create({ baseURL: BASE });

api.interceptors.request.use((cfg) => {
  const t = tokenStore.get();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  cfg.headers["X-Tenant-Slug"] = tenantStore.get();
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      tokenStore.clear();
      // bounce only if not on login already to avoid redirect loops
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        window.location.assign("/login");
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
const DASH_TOKEN_KEY = "kanda_dash_token_v1";
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
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/biz/login")) {
        window.location.assign("/biz/login");
      }
    }
    return Promise.reject(err);
  }
);

export const auth = {
  login: (pin) => api.post("/auth/login", { pin }).then((r) => r.data),
  me: () => api.get("/auth/me").then((r) => r.data),
};

export const menuApi = {
  categories: () => api.get("/menu/categories").then((r) => r.data),
  items: () => api.get("/menu/items").then((r) => r.data),
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

export const tablesApi = {
  list: () => api.get("/tables").then((r) => r.data),
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
  list: () => api.get("/customers").then((r) => r.data),
  trash: () => api.get("/customers/trash").then((r) => r.data),
  search: (phone) => api.get("/customers/search", { params: { phone } }).then((r) => r.data),
  create: (payload) => api.post("/customers", payload).then((r) => r.data),
  update: (id, payload) => api.put(`/customers/${id}`, payload).then((r) => r.data),
  remove: (id) => api.delete(`/customers/${id}`).then((r) => r.data),
  restore: (id) => api.post(`/customers/${id}/restore`).then((r) => r.data),
};

export const inventoryApi = {
  list: () => api.get("/inventory").then((r) => r.data),
  create: (payload) => api.post("/inventory", payload).then((r) => r.data),
  update: (id, payload) => api.patch(`/inventory/${id}`, payload).then((r) => r.data),
  remove: (id) => api.delete(`/inventory/${id}`).then((r) => r.data),
  adjust: (id, delta) => api.patch(`/inventory/${id}/adjust`, { delta }).then((r) => r.data),
  reorder: (id) => api.post(`/inventory/${id}/reorder`).then((r) => r.data),
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

export const shiftsApi = {
  list: (params = {}) => api.get("/shifts", { params }).then((r) => r.data),
  create: (payload) => api.post("/shifts", payload).then((r) => r.data),
  update: (id, payload) => api.patch(`/shifts/${id}`, payload).then((r) => r.data),
  remove: (id) => api.delete(`/shifts/${id}`).then((r) => r.data),
  publish: (start, end) => api.post("/shifts/publish", null, { params: { start, end } }).then((r) => r.data),
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

export const assistantApi = {
  chat: (payload) => api.post("/assistant/chat", payload).then((r) => r.data),
  transcribe: (blob, filename = "voice.webm") => {
    const fd = new FormData();
    fd.append("file", blob, filename);
    return api.post("/assistant/transcribe", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data);
  },
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
};
