import Dexie from "dexie";

// Local-first cache + write queue for offline survival. One IndexedDB
// database per browser origin, tenant-scoped rows inside shared tables
// (a single terminal is usually one tenant at a time, but the dashboard's
// store switcher means the same browser can hold more than one tenant's
// data, so every row and lookup carries tenant_id explicitly rather than
// relying on one DB per tenant).
export const db = new Dexie("kanda_pos_offline");

// Collections mirrored from the server via delta sync (see syncEngine.js).
// Keyed by the server's own `id` so upserts are trivial; tenant_id is a
// secondary index for scoping reads/writes to the active tenant.
const CACHE_STORES = {
  menuItems: "id, tenant_id, updated_at",
  categories: "id, tenant_id, updated_at",
  inventory: "id, tenant_id, updated_at",
  customers: "id, tenant_id, updated_at",
  menuSchedules: "id, tenant_id, updated_at",
  tables: "id, tenant_id, updated_at",
};

db.version(1).stores({
  ...CACHE_STORES,
  // Sync cursor per (tenant, collection) — advanced only after a delta
  // merge fully succeeds, so a failed/partial sync doesn't lose the next
  // delta (see syncEngine.js).
  syncMeta: "key", // key = `${tenantId}:${collection}`
  // Write queue — every mutation lands here first, gets applied optimistically
  // to local state, then replayed FIFO per tenant once back online.
  outbox: "++seq, tenantId, status, createdAt",
  // The POS's own view of orders: server-synced ones plus any still-local
  // (offline-created, not yet synced) ones, so the UI has one place to read
  // "today's orders" regardless of connectivity.
  localOrders: "id, tenant_id, placedAt",
});

export const CACHE_COLLECTIONS = Object.keys(CACHE_STORES);
