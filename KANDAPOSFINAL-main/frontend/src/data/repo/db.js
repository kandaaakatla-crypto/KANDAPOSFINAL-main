import Dexie from "dexie";
import { CACHE_COLLECTIONS } from "./collections";

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
//
// Note: the dining-tables collection is named `diningTables`, not `tables`
// — Dexie instances expose their own reserved `db.tables` getter (the list
// of Table objects in the schema), so a store literally named "tables"
// gets shadowed by that and `db.tables.where(...)` silently isn't a table
// proxy anymore. Cost an afternoon to track down; don't reintroduce it.
const CACHE_STORES = Object.fromEntries(
  CACHE_COLLECTIONS.map((name) => [name, "id, tenant_id, updated_at"]),
);

const SHARED_STORES = {
  ...CACHE_STORES,
  // Sync cursor per (tenant, collection) — advanced only after a delta
  // merge fully succeeds, so a failed/partial sync doesn't lose the next
  // delta (see syncEngine.js).
  syncMeta: "key", // key = `${tenantId}:${collection}`
  // The POS's own view of orders: server-synced ones plus any still-local
  // (offline-created, not yet synced) ones, so the UI has one place to read
  // "today's orders" regardless of connectivity.
  localOrders: "id, tenant_id, placedAt",
};

db.version(1).stores({
  ...SHARED_STORES,
  outbox: "++seq, tenantId, status, createdAt",
});
// v2: outbox needs `dependsOnLocalId` indexed — remapDependentMutations()
// queries it directly, and Dexie throws on an unindexed where() clause
// (silently failing every order.append/status/packed mutation queued
// against a not-yet-synced local order, and — worse — leaving the
// order.create entry itself stuck "pending" forever even after its order
// was created server-side, since the throw happens after the create call
// succeeds but before markMutationSynced runs).
db.version(2).stores({
  ...SHARED_STORES,
  outbox: "++seq, tenantId, status, createdAt, dependsOnLocalId",
});

export { CACHE_COLLECTIONS };
