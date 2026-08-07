import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";
import { CACHE_COLLECTIONS } from "./collections";

// Native SQLite Repo backend — used by the Android (Capacitor) shell.
//
// Android's WebView storage (IndexedDB included) can be evicted by the OS
// under memory pressure, which is not acceptable for an outbox holding
// unsynced, money-bearing writes. This backend stores everything in a real
// SQLite file via @capacitor-community/sqlite instead, implementing the
// exact same function shapes as dexieRepo.js so PosContext/syncEngine never
// know which one they're talking to (see index.js's factory).
//
// Schema is JSON-blob-per-record, mirroring Dexie's schema-less-record
// style rather than mapping each collection to bespoke SQL columns — the 6
// cache collections' shapes are server-defined and evolve independently of
// this storage layer, so hand-maintaining a SQL schema per collection here
// would just be another thing to keep in sync. Columns are only promoted
// out of the JSON blob where a query needs to filter/sort on them
// (tenant_id, updated_at, and — for the outbox — status/dependsOnLocalId).
//
// Table names are prefixed `cache_`/deliberately avoid bare words like
// "tables" — a Dexie store literally named `tables` collided with Dexie's
// own reserved `db.tables` getter and cost an afternoon to debug (see
// db.js); there's no equivalent SQLite footgun, but the prefix costs
// nothing and rules the whole class of mistake out here too.

const DB_NAME = "kanda_pos_offline";

const sqlite = new SQLiteConnection(CapacitorSQLite);

function cacheTable(collection) {
  return `cache_${collection}`;
}

function assertCollection(collection) {
  if (!CACHE_COLLECTIONS.includes(collection)) {
    throw new Error(`Unknown offline-cache collection "${collection}"`);
  }
}

let readyPromise = null;

async function openDb() {
  const { result: isOpen } = await sqlite.isConnection(DB_NAME, false);
  const conn = isOpen
    ? await sqlite.retrieveConnection(DB_NAME, false)
    : await sqlite.createConnection(DB_NAME, false, "no-encryption", 1, false);
  await conn.open();

  const ddl = [
    ...CACHE_COLLECTIONS.flatMap((collection) => {
      const table = cacheTable(collection);
      return [
        `CREATE TABLE IF NOT EXISTS ${table} (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          updated_at TEXT,
          data TEXT NOT NULL
        );`,
        `CREATE INDEX IF NOT EXISTS idx_${table}_tenant ON ${table}(tenant_id);`,
      ];
    }),
    `CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      status TEXT NOT NULL,
      depends_on_local_id TEXT,
      data TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_outbox_tenant_status ON outbox(tenant_id, status);`,
    `CREATE INDEX IF NOT EXISTS idx_outbox_depends ON outbox(depends_on_local_id);`,
    `CREATE TABLE IF NOT EXISTS local_orders (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      data TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_local_orders_tenant ON local_orders(tenant_id);`,
  ].join("\n");

  await conn.execute(ddl);
  return conn;
}

function ensureDb() {
  if (!readyPromise) readyPromise = openDb();
  return readyPromise;
}

async function run(sql, values = []) {
  const conn = await ensureDb();
  return conn.run(sql, values, false);
}

async function query(sql, values = []) {
  const conn = await ensureDb();
  const res = await conn.query(sql, values);
  return res.values || [];
}

async function execSet(set) {
  if (!set.length) return;
  const conn = await ensureDb();
  await conn.executeSet(set, true);
}

// ----- Cached read-model (mirrors of server collections) -----

export async function getAll(collection, tenantId) {
  assertCollection(collection);
  const rows = await query(
    `SELECT data FROM ${cacheTable(collection)} WHERE tenant_id = ?;`,
    [tenantId],
  );
  return rows.map((row) => JSON.parse(row.data));
}

export async function getById(collection, id) {
  assertCollection(collection);
  const rows = await query(
    `SELECT data FROM ${cacheTable(collection)} WHERE id = ? LIMIT 1;`,
    [id],
  );
  return rows.length ? JSON.parse(rows[0].data) : undefined;
}

// See dexieRepo.js's putMany for why tenantId is stamped here rather than
// trusted from the payload, and why a `deleted_at` record is a delta-sync
// tombstone that gets removed instead of stored.
export async function putMany(collection, tenantId, records) {
  assertCollection(collection);
  if (!records || !records.length) return;
  const table = cacheTable(collection);
  const stamped = records.map((r) => ({ ...r, tenant_id: tenantId }));
  const toDelete = stamped.filter((r) => r.deleted_at);
  const toPut = stamped.filter((r) => !r.deleted_at);

  const set = toPut.map((r) => ({
    statement: `INSERT OR REPLACE INTO ${table} (id, tenant_id, updated_at, data) VALUES (?, ?, ?, ?);`,
    values: [r.id, tenantId, r.updated_at || null, JSON.stringify(r)],
  }));
  toDelete.forEach((r) => {
    set.push({ statement: `DELETE FROM ${table} WHERE id = ?;`, values: [r.id] });
  });
  await execSet(set);
}

// Replace a tenant's entire local cache for a collection (used for the
// full-fetch fallback path — first install, or a stale/missing cursor).
export async function replaceAll(collection, tenantId, records) {
  assertCollection(collection);
  const table = cacheTable(collection);
  const stamped = (records || []).map((r) => ({ ...r, tenant_id: tenantId }));
  const set = [
    { statement: `DELETE FROM ${table} WHERE tenant_id = ?;`, values: [tenantId] },
    ...stamped.map((r) => ({
      statement: `INSERT OR REPLACE INTO ${table} (id, tenant_id, updated_at, data) VALUES (?, ?, ?, ?);`,
      values: [r.id, tenantId, r.updated_at || null, JSON.stringify(r)],
    })),
  ];
  await execSet(set);
}

// ----- Sync cursor -----

export async function getMeta(collection, tenantId) {
  const rows = await query(`SELECT data FROM sync_meta WHERE key = ? LIMIT 1;`, [
    `${tenantId}:${collection}`,
  ]);
  return rows.length ? JSON.parse(rows[0].data) : { lastSyncedAt: null };
}

export async function setMeta(collection, tenantId, meta) {
  await run(`INSERT OR REPLACE INTO sync_meta (key, data) VALUES (?, ?);`, [
    `${tenantId}:${collection}`,
    JSON.stringify(meta),
  ]);
}

// ----- Outbox (write queue) -----

export async function enqueueMutation(mutation) {
  const full = {
    status: "pending",
    attempts: 0,
    createdAt: new Date().toISOString(),
    ...mutation,
  };
  const result = await run(
    `INSERT INTO outbox (tenant_id, status, depends_on_local_id, data) VALUES (?, ?, ?, ?);`,
    [full.tenantId, full.status, full.dependsOnLocalId || null, JSON.stringify(full)],
  );
  return result.changes?.lastId;
}

// FIFO by insertion order (the auto-increment `seq` primary key), scoped to
// one tenant so a store-switcher session doesn't try to replay another
// tenant's queued writes.
export async function listPendingMutations(tenantId) {
  const rows = await query(
    `SELECT seq, data FROM outbox WHERE tenant_id = ? AND status = 'pending' ORDER BY seq ASC;`,
    [tenantId],
  );
  return rows.map((row) => ({ ...JSON.parse(row.data), seq: row.seq }));
}

export async function markMutationSynced(seq) {
  await run(`DELETE FROM outbox WHERE seq = ?;`, [seq]);
}

export async function markMutationFailed(seq, error, permanent = false) {
  const rows = await query(`SELECT data FROM outbox WHERE seq = ? LIMIT 1;`, [seq]);
  if (!rows.length) return;
  const m = JSON.parse(rows[0].data);
  const status = permanent ? "failed_permanent" : "pending";
  const updated = {
    ...m,
    status,
    attempts: (m.attempts || 0) + 1,
    lastError: error ? String(error?.message || error) : null,
  };
  await run(`UPDATE outbox SET status = ?, data = ? WHERE seq = ?;`, [
    status,
    JSON.stringify(updated),
    seq,
  ]);
}

// Re-point every queued mutation that depended on a local order's
// provisional id at its real, server-assigned one — called once by the
// outbox processor right after that order's own create mutation syncs.
export async function remapDependentMutations(oldLocalId, newId) {
  const rows = await query(
    `SELECT seq, data FROM outbox WHERE depends_on_local_id = ?;`,
    [oldLocalId],
  );
  const set = rows.map((row) => {
    const updated = { ...JSON.parse(row.data), dependsOnLocalId: newId, orderId: newId };
    return {
      statement: `UPDATE outbox SET depends_on_local_id = ?, data = ? WHERE seq = ?;`,
      values: [newId, JSON.stringify(updated), row.seq],
    };
  });
  await execSet(set);
}

// ----- Local orders (the POS's "today's orders" view) -----
// `tenantId` is required and stamped here for the same reason as putMany/
// replaceAll above: the Order API response never carries tenant_id, so
// listLocalOrders' tenant-scoped query would silently return nothing if we
// trusted the payload instead.

export async function upsertLocalOrder(order, tenantId) {
  const stamped = { ...order, tenant_id: tenantId };
  await run(`INSERT OR REPLACE INTO local_orders (id, tenant_id, data) VALUES (?, ?, ?);`, [
    stamped.id,
    tenantId,
    JSON.stringify(stamped),
  ]);
}

export async function listLocalOrders(tenantId) {
  const rows = await query(`SELECT data FROM local_orders WHERE tenant_id = ?;`, [tenantId]);
  return rows.map((row) => JSON.parse(row.data));
}

export async function getLocalOrder(id) {
  const rows = await query(`SELECT data FROM local_orders WHERE id = ? LIMIT 1;`, [id]);
  return rows.length ? JSON.parse(rows[0].data) : undefined;
}

export async function removeLocalOrder(id) {
  await run(`DELETE FROM local_orders WHERE id = ?;`, [id]);
}

// Swap a locally-created order's provisional id/number for the real ones
// once its create mutation has synced — single choke point so every screen
// (order list, KDS, receipt reprint) picks up the swap consistently.
export async function remapLocalOrderId(oldLocalId, newOrder, tenantId) {
  const stamped = { ...newOrder, tenant_id: tenantId };
  await execSet([
    { statement: `DELETE FROM local_orders WHERE id = ?;`, values: [oldLocalId] },
    {
      statement: `INSERT OR REPLACE INTO local_orders (id, tenant_id, data) VALUES (?, ?, ?);`,
      values: [stamped.id, tenantId, JSON.stringify(stamped)],
    },
  ]);
}
