import { db, CACHE_COLLECTIONS } from "./db";

// Local-first repository — the only thing PosContext talks to for reads and
// writes. Two implementations exist behind this same shape: this one
// (Dexie/IndexedDB, used by the web build and the future Electron shell) and
// a SQLite-backed one for the future Capacitor Android shell, which needs a
// more durable native store than a mobile WebView's IndexedDB.

function assertCollection(collection) {
  if (!CACHE_COLLECTIONS.includes(collection)) {
    throw new Error(`Unknown offline-cache collection "${collection}"`);
  }
}

// ----- Cached read-model (mirrors of server collections) -----

export async function getAll(collection, tenantId) {
  assertCollection(collection);
  return db[collection].where("tenant_id").equals(tenantId).toArray();
}

export async function getById(collection, id) {
  assertCollection(collection);
  return db[collection].get(id);
}

// Upsert a batch of server records into the local cache. A record with
// `deleted_at` set is a delta-sync tombstone — remove it from the cache
// instead of storing it.
export async function putMany(collection, records) {
  assertCollection(collection);
  if (!records || !records.length) return;
  const toDelete = records.filter((r) => r.deleted_at).map((r) => r.id);
  const toPut = records.filter((r) => !r.deleted_at);
  await db.transaction("rw", db[collection], async () => {
    if (toPut.length) await db[collection].bulkPut(toPut);
    if (toDelete.length) await db[collection].bulkDelete(toDelete);
  });
}

// Replace a tenant's entire local cache for a collection (used for the
// full-fetch fallback path — first install, or a stale/missing cursor).
export async function replaceAll(collection, tenantId, records) {
  assertCollection(collection);
  await db.transaction("rw", db[collection], async () => {
    await db[collection].where("tenant_id").equals(tenantId).delete();
    if (records && records.length) await db[collection].bulkPut(records);
  });
}

// ----- Sync cursor -----

export async function getMeta(collection, tenantId) {
  const row = await db.syncMeta.get(`${tenantId}:${collection}`);
  return row || { lastSyncedAt: null };
}

export async function setMeta(collection, tenantId, meta) {
  await db.syncMeta.put({ key: `${tenantId}:${collection}`, ...meta });
}

// ----- Outbox (write queue) -----

export async function enqueueMutation(mutation) {
  return db.outbox.add({
    status: "pending",
    attempts: 0,
    createdAt: new Date().toISOString(),
    ...mutation,
  });
}

// FIFO by insertion order (the auto-increment `seq` primary key), scoped to
// one tenant so a store-switcher session doesn't try to replay another
// tenant's queued writes.
export async function listPendingMutations(tenantId) {
  const rows = await db.outbox.where("tenantId").equals(tenantId).sortBy("seq");
  return rows.filter((m) => m.status === "pending");
}

export async function markMutationSynced(seq) {
  await db.outbox.delete(seq);
}

export async function markMutationFailed(seq, error, permanent = false) {
  const m = await db.outbox.get(seq);
  if (!m) return;
  await db.outbox.put({
    ...m,
    status: permanent ? "failed_permanent" : "pending",
    attempts: (m.attempts || 0) + 1,
    lastError: error ? String(error?.message || error) : null,
  });
}

// Re-point every queued mutation that depended on a local order's
// provisional id at its real, server-assigned one — called once by the
// outbox processor right after that order's own create mutation syncs.
export async function remapDependentMutations(oldLocalId, newId) {
  const rows = await db.outbox.where("dependsOnLocalId").equals(oldLocalId).toArray();
  await Promise.all(
    rows.map((m) => db.outbox.update(m.seq, { dependsOnLocalId: newId, orderId: newId })),
  );
}

// ----- Local orders (the POS's "today's orders" view) -----

export async function upsertLocalOrder(order) {
  await db.localOrders.put(order);
}

export async function listLocalOrders(tenantId) {
  return db.localOrders.where("tenant_id").equals(tenantId).toArray();
}

export async function getLocalOrder(id) {
  return db.localOrders.get(id);
}

export async function removeLocalOrder(id) {
  await db.localOrders.delete(id);
}

// Swap a locally-created order's provisional id/number for the real ones
// once its create mutation has synced — single choke point so every screen
// (order list, KDS, receipt reprint) picks up the swap consistently.
export async function remapLocalOrderId(oldLocalId, newOrder) {
  await db.transaction("rw", db.localOrders, async () => {
    await db.localOrders.delete(oldLocalId);
    await db.localOrders.put(newOrder);
  });
}
