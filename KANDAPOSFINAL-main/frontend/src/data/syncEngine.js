import {
  menuApi, menuSchedulesApi, tablesApi, customersApi, inventoryApi, ordersApi,
} from "../api/client";
import * as repo from "./repo";

// How stale a sync cursor can be before we throw it away and do a full
// refetch instead of trusting `since=` — bounds how much drift a delta pull
// has to reconcile, and gives every collection a self-healing path if a
// terminal was offline for a long stretch.
const MAX_CURSOR_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Each syncable collection's server list call. Every one of these accepts
// an optional `since` ISO string and returns the full array when omitted.
const COLLECTION_APIS = {
  categories: (since) => menuApi.categories(since),
  menuItems: (since) => menuApi.items(since),
  inventory: (since) => inventoryApi.list(since),
  customers: (since) => customersApi.list(since),
  menuSchedules: (since) => menuSchedulesApi.list(since),
  diningTables: (since) => tablesApi.list(since),
};

function cursorIsUsable(lastSyncedAt) {
  if (!lastSyncedAt) return false;
  const age = Date.now() - new Date(lastSyncedAt).getTime();
  return age >= 0 && age < MAX_CURSOR_AGE_MS;
}

// Pull every collection's changes since its last synced cursor (or a full
// fetch if there's no usable cursor yet) and merge into the local cache.
// Safe to call whenever we're online: on boot, on reconnect, and on a
// periodic timer. Never throws — a failed collection just leaves its
// cursor unmoved so the next attempt retries from the same point.
export async function pullDeltas(tenantId) {
  const results = {};
  for (const [collection, fetchFn] of Object.entries(COLLECTION_APIS)) {
    try {
      const meta = await repo.getMeta(collection, tenantId);
      const useDelta = cursorIsUsable(meta.lastSyncedAt);
      // Captured *before* the request goes out — if something changes on
      // the server in the gap between this and the response landing, the
      // next sync will just see it again (harmless re-merge), never miss it.
      const requestStartedAt = new Date().toISOString();
      const records = await fetchFn(useDelta ? meta.lastSyncedAt : undefined);
      if (useDelta) {
        await repo.putMany(collection, tenantId, records);
      } else {
        await repo.replaceAll(collection, tenantId, records);
      }
      await repo.setMeta(collection, tenantId, { lastSyncedAt: requestStartedAt });
      results[collection] = { ok: true, count: records.length, full: !useDelta };
    } catch (err) {
      results[collection] = { ok: false, error: err };
    }
  }
  return results;
}

// ----- Outbox mutation dispatch -----
// Maps an outbox entry's `kind` to the real network call. `order.create` is
// special-cased by processOutbox itself (it needs the local->real id remap);
// everything else is a straightforward "replay this call against its real
// target id" — `orderId`/`tableId`/`itemId` are resolved to real server ids
// by processOutbox before dispatch if they were still local ones.
const MUTATION_HANDLERS = {
  "order.append": (m) => ordersApi.appendItems(m.orderId, m.payload.items),
  "order.status": (m) => ordersApi.setStatus(m.orderId, m.payload.status),
  "order.packed": (m) => ordersApi.setPacked(m.orderId, m.payload.packed),
  "table.status": (m) => tablesApi.update(m.tableId, { status: m.payload.status }),
  "inventory.adjust": (m) => inventoryApi.adjust(m.itemId, m.payload.delta),
};

// Replay every queued mutation for a tenant, in the order it was created.
// Stops at the first mutation that's still blocked on an unsynced parent
// (its dependsOnLocalId hasn't resolved yet) rather than skipping ahead out
// of order — the next call (next reconnect tick) picks up where this left
// off. Returns a summary for the caller to toast/log.
export async function processOutbox(tenantId, { onOrderSynced } = {}) {
  const pending = await repo.listPendingMutations(tenantId);
  const summary = { synced: 0, failed: 0, blocked: 0 };
  // localId -> real id, for order.create entries synced earlier in *this*
  // pass — lets a same-batch append/status change on a brand-new local
  // order resolve immediately instead of waiting for the next tick.
  const resolvedThisPass = new Map();

  for (const m of pending) {
    const dependsOn = m.dependsOnLocalId;
    if (dependsOn && !resolvedThisPass.has(dependsOn)) {
      // Parent order hasn't synced yet (in this pass or a prior one) —
      // leave it queued and stop here; retry order is preserved.
      summary.blocked += 1;
      break;
    }
    const realOrderId = dependsOn ? resolvedThisPass.get(dependsOn) : m.orderId;

    try {
      if (m.kind === "order.create") {
        const created = await ordersApi.create({ ...m.payload, client_ref: m.idempotencyKey });
        await repo.remapLocalOrderId(m.localOrderId, created, tenantId);
        await repo.remapDependentMutations(m.localOrderId, created.id);
        resolvedThisPass.set(m.localOrderId, created.id);
        onOrderSynced?.(m.localOrderId, created);
      } else {
        const handler = MUTATION_HANDLERS[m.kind];
        if (!handler) throw new Error(`Unknown outbox mutation kind "${m.kind}"`);
        await handler({ ...m, orderId: realOrderId });
      }
      await repo.markMutationSynced(m.seq);
      summary.synced += 1;
    } catch (err) {
      // 4xx = the request itself is bad (stale reference, validation) and
      // will never succeed by retrying as-is — surface it, don't spin on it
      // forever. Network errors / 5xx get retried on the next pass.
      const status = err?.response?.status;
      const permanent = typeof status === "number" && status >= 400 && status < 500 && status !== 429;
      await repo.markMutationFailed(m.seq, err, permanent);
      summary.failed += 1;
      if (!permanent) break; // likely offline again — stop, don't burn through the queue failing
    }
  }
  return summary;
}
