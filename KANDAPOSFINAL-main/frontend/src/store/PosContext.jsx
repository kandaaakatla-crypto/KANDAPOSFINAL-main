import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import {
  auth, tokenStore, tenantStore, menuApi, menuSchedulesApi, tablesApi, customersApi,
  inventoryApi, ordersApi, tenantApi, loyaltyApi, surgeRulesApi,
  isDeviceLocked,
  isStaffDeactivated,
} from "../api/client";
import { connectWs } from "../api/ws";
import * as repo from "../data/repo";
import { pullDeltas, processOutbox } from "../data/syncEngine";
import { isOnline, subscribeConnectivity } from "../data/connectivity";
import { toast } from "sonner";

const PosContext = createContext(null);

const DEFAULT_FEATURES = { tables: true, kitchen_display: true, packing_station: true, dispatch: true, meal_deals: true, pizza_sizing: true };
const DEFAULT_LOYALTY_CONFIG = { earn_rate: 100, redeem_value: 1, silver_threshold: 5000, gold_threshold: 20000, welcome_bonus_points: 0, silver_multiplier: 1, gold_multiplier: 1, birthday_bonus_points: 0 };

const STAFFUSER_CACHE_KEY = "kanda_pos_staffuser_v1";
// Aggregator surge rules aren't in the IndexedDB delta-sync set; the last
// fetched list is kept here (per tenant) so an offline terminal still prices
// Swiggy/Zomato orders the same way.
const surgeCacheKey = (tid) => `kanda_pos_surge_rules_v1_${tid}`;

function newLocalId() {
  const rand = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `lo_${rand}`;
}

let localOrderCounter = 0;
// Negative, monotonically-decreasing placeholder order numbers — every
// screen that renders `#${order.number}` already just interpolates it, so
// this stays visually distinct ("#-1") without needing every display spot
// touched. Replaced with the real server number the moment the order syncs.
function newLocalOrderNumber() {
  localOrderCounter -= 1;
  return localOrderCounter;
}

export function PosProvider({ children }) {
  const [bootState, setBootState] = useState("loading"); // loading | ready
  const [staffUser, setStaffUser] = useState(null);
  const [tenantInfo, setTenantInfo] = useState(null); // { businessType, features, name, slug }

  const [categories, setCategories] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [tables, setTables] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [loyaltyConfig, setLoyaltyConfig] = useState(DEFAULT_LOYALTY_CONFIG);
  const [surgeRules, setSurgeRules] = useState([]);

  const [isOffline, setIsOffline] = useState(typeof navigator !== "undefined" && "onLine" in navigator ? !navigator.onLine : false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  // Mirrors `isOffline` for synchronous reads inside callbacks (runSync)
  // without pulling it into their dependency arrays.
  const isOfflineRef = useRef(false);
  useEffect(() => { isOfflineRef.current = isOffline; }, [isOffline]);

  // Resolved once per session (the tenant slug doubles as the tenant_id
  // convention used throughout this codebase's seed data) — every Repo call
  // needs it, so it's cheaper to resolve once than re-derive per call.
  const tenantIdRef = useRef(null);

  const refreshPendingCount = useCallback(async () => {
    const tid = tenantIdRef.current;
    if (!tid) return;
    try {
      const pending = await repo.listPendingMutations(tid);
      setPendingSyncCount(pending.length);
    } catch { /* ignore — IndexedDB unavailable is not fatal, just no badge */ }
  }, []);

  // Re-read the six delta-synced collections from the local cache into
  // React state — called right after boot (cache-first render) and after
  // every successful background sync.
  const hydrateFromCache = useCallback(async (tid) => {
    try {
      const [cats, items, inv, custs, scheds, tbls] = await Promise.all([
        repo.getAll("categories", tid), repo.getAll("menuItems", tid),
        repo.getAll("inventory", tid), repo.getAll("customers", tid),
        repo.getAll("menuSchedules", tid), repo.getAll("diningTables", tid),
      ]);
      setCategories(cats); setMenuItems(items); setInventory(inv);
      setCustomers(custs); setSchedules(scheds); setTables(tbls);
    } catch { /* IndexedDB unavailable — screens simply stay on whatever's already in state */ }
  }, []);

  const loadSurgeRules = useCallback(async (tid) => {
    try {
      const rules = await surgeRulesApi.list();
      setSurgeRules(rules);
      try { localStorage.setItem(surgeCacheKey(tid), JSON.stringify(rules)); } catch { /* ignore */ }
    } catch { /* offline — keep the cached rules */ }
  }, []);

  const hydrateOrders = useCallback(async (tid) => {
    try {
      const local = await repo.listLocalOrders(tid);
      local.sort((a, b) => (b.placedAt || "").localeCompare(a.placedAt || ""));
      setOrders(local);
    } catch { /* ignore */ }
  }, []);

  // Pull today's orders from the server (when reachable) into the local
  // cache, then re-render from the cache — this merges with whatever's
  // still locally queued (not yet synced) without clobbering it, since a
  // not-yet-synced order simply doesn't exist server-side yet to overwrite it.
  const syncOrdersFromServer = useCallback(async (tid) => {
    try {
      const serverOrders = await ordersApi.list();
      await Promise.all(serverOrders.map((o) => repo.upsertLocalOrder(o, tid)));
    } catch { /* offline or request failed — local cache is all we have right now */ }
    await hydrateOrders(tid);
  }, [hydrateOrders]);

  // Replay the write queue, then pull fresh reads — the order matters:
  // flushing local writes first means a delta pull right after sees a
  // server that already reflects what this terminal just did, rather than
  // racing its own not-yet-sent mutations.
  const runSync = useCallback(async (tid) => {
    if (!tid) return;
    if (isOfflineRef.current) return;
    try {
      await processOutbox(tid);
      await pullDeltas(tid);
      await Promise.all([hydrateFromCache(tid), syncOrdersFromServer(tid), loadSurgeRules(tid)]);
    } catch { /* best-effort background sync — the next tick/reconnect retries */ }
    await refreshPendingCount();
  }, [hydrateFromCache, syncOrdersFromServer, loadSurgeRules, refreshPendingCount]);

  const loadAll = useCallback(async () => {
    const tid = tenantStore.get();
    tenantIdRef.current = tid;
    // Cache first: renders instantly even offline, or while the network
    // calls below are still in flight / failing.
    await Promise.all([hydrateFromCache(tid), hydrateOrders(tid)]);
    try {
      const cached = localStorage.getItem(surgeCacheKey(tid));
      setSurgeRules(cached ? JSON.parse(cached) : []);
    } catch { setSurgeRules([]); }
    await refreshPendingCount();
    try {
      const [tenant, loyaltyCfg] = await Promise.all([
        tenantApi.info().catch(() => null),
        loyaltyApi.getConfig().catch(() => null),
      ]);
      if (tenant) setTenantInfo(tenant);
      if (loyaltyCfg) setLoyaltyConfig(loyaltyCfg);
    } catch { /* offline on first boot — tenantInfo/loyaltyConfig just stay at defaults for now */ }
    // Background: replay anything queued, then pull fresh deltas + orders.
    runSync(tid);
  }, [hydrateFromCache, hydrateOrders, refreshPendingCount, runSync]);

  const refreshTenantInfo = useCallback(async () => {
    try { setTenantInfo(await tenantApi.info()); } catch { /* ignore */ }
  }, []);

  // Boot: if a token is cached, try to confirm it against the server, but
  // don't sign the terminal out just because the network is down at
  // startup — only a genuine 401 (token actually rejected) clears it. A
  // network failure falls back to the last-known staff identity so the
  // terminal still opens straight to the cached menu/orders.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const t = tokenStore.get();
      if (!t) { setBootState("ready"); return; }
      try {
        const me = await auth.me();
        if (cancelled) return;
        setStaffUser(me);
        localStorage.setItem(STAFFUSER_CACHE_KEY, JSON.stringify(me));
        await loadAll();
      } catch (e) {
        if (e?.response?.status === 401) {
          tokenStore.clear();
        } else {
          // Offline (or backend unreachable) at boot — trust the cached
          // session and let the terminal open against local data.
          const cached = localStorage.getItem(STAFFUSER_CACHE_KEY);
          if (cached) {
            try {
              setStaffUser(JSON.parse(cached));
              await loadAll();
            } catch { tokenStore.clear(); }
          } else {
            tokenStore.clear();
          }
        }
      } finally {
        if (!cancelled) setBootState("ready");
      }
    })();
    return () => { cancelled = true; };
  }, [loadAll]);

  // Connectivity: flip the offline flag immediately on a connectivity change
  // (browser online/offline events on web/Electron, OS-level network status
  // via @capacitor/network on Android — see data/connectivity.js for why
  // Android can't just trust navigator.onLine), and kick a sync the moment
  // we're back so queued orders don't sit around waiting for the next
  // periodic tick. Also reconciles the synchronous initial guess against
  // the real state once it's known, since Capacitor's status check is async.
  useEffect(() => {
    let cancelled = false;
    isOnline().then((online) => { if (!cancelled) setIsOffline(!online); });
    const goOnline = () => { setIsOffline(false); if (staffUser) runSync(tenantIdRef.current); };
    const goOffline = () => setIsOffline(true);
    const unsubscribe = subscribeConnectivity((online) => (online ? goOnline() : goOffline()));
    return () => { cancelled = true; unsubscribe(); };
  }, [staffUser, runSync]);

  // Periodic background sync while logged in — catches changes made from
  // other terminals (delta pull) and flushes anything that got queued but
  // couldn't be sent immediately (e.g. the create succeeded but the reply
  // was lost, or a mutation failed transiently). WS pushes below give faster
  // updates when connected; this is the correctness backstop.
  useEffect(() => {
    if (!staffUser) return undefined;
    const id = setInterval(() => runSync(tenantIdRef.current), 30000);
    return () => clearInterval(id);
  }, [staffUser, runSync]);

  // Realtime updates — subscribe whenever a staff user is logged in. Pushes
  // patch both the in-memory state (instant UI update) and the local cache
  // (so a later offline boot / delta-sync cursor sees the same data).
  useEffect(() => {
    if (!staffUser) return undefined;
    const dispose = connectWs((evt) => {
      if (!evt || !evt.type) return;
      if (evt.type === "order.upserted") {
        const o = evt.data;
        repo.upsertLocalOrder(o, tenantIdRef.current).catch(() => {});
        setOrders((prev) => {
          const i = prev.findIndex((x) => x.id === o.id);
          if (i >= 0) { const copy = [...prev]; copy[i] = o; return copy; }
          return [o, ...prev];
        });
      } else if (evt.type === "table.updated") {
        repo.putMany("diningTables", tenantIdRef.current, [evt.data]).catch(() => {});
        setTables((prev) => prev.map((t) => (t.id === evt.data.id ? evt.data : t)));
      } else if (evt.type === "inventory.updated") {
        const { item, low } = evt.data;
        repo.putMany("inventory", tenantIdRef.current, [item]).catch(() => {});
        setInventory((prev) => prev.map((i) => (i.id === item.id ? item : i)));
        if (low) toast.warning(`Low stock alert: ${item.name} (${item.stock} ${item.unit} left)`);
      }
    });
    return dispose;
  }, [staffUser]);

  // ----- Auth -----
  const login = useCallback(async (pin) => {
    try {
      const { token, user } = await auth.login(pin);
      tokenStore.set(token);
      setStaffUser(user);
      localStorage.setItem(STAFFUSER_CACHE_KEY, JSON.stringify(user));
      await loadAll();
      return user;
    } catch (err) {
      // Let the PIN pad tell "this till isn't unlocked" apart from a wrong PIN.
      if (isDeviceLocked(err) || isStaffDeactivated(err)) throw err;
      return null;
    }
  }, [loadAll]);

  const logout = useCallback(() => {
    tokenStore.clear();
    setStaffUser(null);
    setOrders([]); setCustomers([]); setTables([]); setInventory([]); setMenuItems([]); setCategories([]);
    // Note: the IndexedDB cache/outbox is deliberately NOT cleared here — a
    // shift-change logout/login on the same terminal for the same tenant
    // should keep the offline cache warm, not throw it away.
  }, []);

  // ----- Orders -----
  // Optimistic-write helper shared by every order mutation below: apply the
  // change to local state + cache immediately, queue it for the outbox, and
  // kick an immediate sync attempt (a no-op if offline) so the common
  // "we're actually online" case still gets a fast real response.
  const enqueueOrderMutation = useCallback(async (mutation) => {
    const tid = tenantIdRef.current;
    await repo.enqueueMutation({ tenantId: tid, ...mutation });
    await refreshPendingCount();
    runSync(tid);
  }, [refreshPendingCount, runSync]);

  const placeOrder = useCallback(async (order) => {
    const tid = tenantIdRef.current;
    const localId = newLocalId();
    const optimistic = {
      ...order,
      id: localId,
      number: newLocalOrderNumber(),
      tenant_id: tid,
      placedAt: new Date().toISOString(),
      status: order.status || "new",
      refunded_amount: 0, voided: false, loyalty_earned: 0, loyalty_redeemed: 0,
      store_credit_redeemed: 0, gift_card_redeemed: 0, gift_card_code: null, packed: false,
      subtotal: order.total, taxTotal: 0, cgst: 0, sgst: 0,
      _pendingSync: true,
    };
    try {
      await repo.upsertLocalOrder(optimistic, tid);
      setOrders((prev) => [optimistic, ...prev]);
      await enqueueOrderMutation({ kind: "order.create", idempotencyKey: localId, localOrderId: localId, payload: order });
      return optimistic;
    } catch (e) {
      toast.error("Could not place order");
      throw e;
    }
  }, [enqueueOrderMutation]);

  const appendToOrder = useCallback(async (orderId, items) => {
    const target = orders.find((o) => o.id === orderId);
    if (!target) { toast.error("Order not found"); throw new Error("Order not found"); }
    const addedTotal = items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.qty) || 1), 0);
    const optimistic = { ...target, items: [...target.items, ...items], total: (target.total || 0) + addedTotal, status: "new" };
    try {
      await repo.upsertLocalOrder(optimistic, tenantIdRef.current);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? optimistic : o)));
      const isLocalOrder = orderId.startsWith("lo_");
      await enqueueOrderMutation({
        kind: "order.append",
        orderId: isLocalOrder ? undefined : orderId,
        dependsOnLocalId: isLocalOrder ? orderId : undefined,
        payload: { items },
      });
      return optimistic;
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not add items to bill");
      throw e;
    }
  }, [orders, enqueueOrderMutation]);

  const updateOrderStatus = useCallback(async (orderId, status) => {
    const target = orders.find((o) => o.id === orderId);
    if (!target) return;
    const optimistic = { ...target, status };
    try {
      await repo.upsertLocalOrder(optimistic, tenantIdRef.current);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? optimistic : o)));
      const isLocalOrder = orderId.startsWith("lo_");
      await enqueueOrderMutation({
        kind: "order.status",
        orderId: isLocalOrder ? undefined : orderId,
        dependsOnLocalId: isLocalOrder ? orderId : undefined,
        payload: { status },
      });
      if (status === "completed") {
        // Table release is server-computed (self-heals stale occupied
        // tables) — pull it fresh once the status change has a chance to land.
        runSync(tenantIdRef.current);
      }
    } catch {
      toast.error("Could not update order status");
    }
  }, [orders, enqueueOrderMutation, runSync]);

  const setOrderPacked = useCallback(async (orderId, packed) => {
    const target = orders.find((o) => o.id === orderId);
    if (!target) return;
    const optimistic = { ...target, packed };
    try {
      await repo.upsertLocalOrder(optimistic, tenantIdRef.current);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? optimistic : o)));
      const isLocalOrder = orderId.startsWith("lo_");
      await enqueueOrderMutation({
        kind: "order.packed",
        orderId: isLocalOrder ? undefined : orderId,
        dependsOnLocalId: isLocalOrder ? orderId : undefined,
        payload: { packed },
      });
      return optimistic;
    } catch {
      toast.error("Could not update packed status");
    }
  }, [orders, enqueueOrderMutation]);

  // Driver assignment is dispatch-side coordination, not part of the
  // take-an-order-and-get-paid critical path — stays a direct network call
  // (same as menu/customer edits below) rather than going through the outbox.
  const assignDriver = useCallback(async (orderId, driverName) => {
    try {
      const updated = await ordersApi.assignDriver(orderId, driverName);
      await repo.upsertLocalOrder(updated, tenantIdRef.current);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      return updated;
    } catch {
      toast.error("Could not assign driver");
    }
  }, []);

  // Bill edits that change the order's customer or totals after it was
  // placed — direct network calls (like assignDriver), since the server is
  // the one that recomputes the GST/total. An order still queued offline
  // has no server copy to edit yet.
  const editPlacedOrder = useCallback(async (orderId, call, failMsg) => {
    if (orderId.startsWith("lo_")) {
      toast.error("This order hasn't synced yet — try again once it has");
      return null;
    }
    try {
      const updated = await call();
      await repo.upsertLocalOrder(updated, tenantIdRef.current);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      return updated;
    } catch (e) {
      toast.error(e?.response?.data?.detail || failMsg);
      return null;
    }
  }, []);

  const setOrderCustomer = useCallback(
    (orderId, customer) => editPlacedOrder(orderId, () => ordersApi.setCustomer(orderId, customer), "Could not save customer details"),
    [editPlacedOrder],
  );

  const setOrderServiceCharge = useCallback(
    (orderId, pct) => editPlacedOrder(orderId, () => ordersApi.setServiceCharge(orderId, pct), "Could not update service charge"),
    [editPlacedOrder],
  );

  // ----- Customers -----
  const upsertCustomer = useCallback(async (cust) => {
    try {
      if (cust.id) {
        const updated = await customersApi.update(cust.id, cust);
        setCustomers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        return updated;
      }
      const created = await customersApi.create(cust);
      setCustomers((prev) => [created, ...prev]);
      return created;
    } catch {
      toast.error("Could not save customer");
    }
  }, []);

  const deleteCustomer = useCallback(async (id) => {
    try {
      await customersApi.remove(id);
      setCustomers((prev) => prev.filter((c) => c.id !== id));
    } catch {
      toast.error("Could not delete customer");
    }
  }, []);

  const refreshCustomers = useCallback(async () => {
    try {
      const list = await customersApi.list();
      setCustomers(list);
    } catch {}
  }, []);

  const refreshTables = useCallback(async () => {
    try {
      const list = await tablesApi.list();
      setTables(list);
    } catch {}
  }, []);

  const refreshMenu = useCallback(async () => {
    try {
      const list = await menuApi.items();
      setMenuItems(list);
    } catch {}
  }, []);

  const refreshInventory = useCallback(async () => {
    try {
      const list = await inventoryApi.list();
      setInventory(list);
    } catch {}
  }, []);


  // ----- Tables -----
  const setTableStatus = useCallback(async (tableId, status) => {
    const target = tables.find((t) => t.id === tableId);
    const optimistic = target ? { ...target, status } : null;
    try {
      if (optimistic) {
        await repo.putMany("diningTables", tenantIdRef.current, [optimistic]);
        setTables((prev) => prev.map((t) => (t.id === tableId ? optimistic : t)));
      }
      await enqueueOrderMutation({ kind: "table.status", tableId, payload: { status } });
    } catch {
      toast.error("Could not update table");
    }
  }, [tables, enqueueOrderMutation]);

  // ----- Inventory -----
  const adjustStock = useCallback(async (id, delta) => {
    const target = inventory.find((i) => i.id === id);
    const optimistic = target ? { ...target, stock: Math.max(0, Math.round((target.stock + delta) * 10) / 10) } : null;
    try {
      if (optimistic) {
        await repo.putMany("inventory", tenantIdRef.current, [optimistic]);
        setInventory((prev) => prev.map((i) => (i.id === id ? optimistic : i)));
      }
      await enqueueOrderMutation({ kind: "inventory.adjust", itemId: id, payload: { delta } });
    } catch {
      toast.error("Could not adjust stock");
    }
  }, [inventory, enqueueOrderMutation]);

  const reorderStock = useCallback(async (id) => {
    try {
      const updated = await inventoryApi.reorder(id);
      await repo.putMany("inventory", tenantIdRef.current, [updated]);
      setInventory((prev) => prev.map((i) => (i.id === id ? updated : i)));
      return updated;
    } catch {
      toast.error("Could not place reorder");
      return null;
    }
  }, []);

  const upsertInventoryItem = useCallback(async (item) => {
    try {
      if (item.id) {
        const updated = await inventoryApi.update(item.id, item);
        setInventory((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
        return updated;
      }
      const created = await inventoryApi.create(item);
      setInventory((prev) => [...prev, created]);
      return created;
    } catch {
      toast.error("Could not save inventory item");
    }
  }, []);

  const deleteInventoryItem = useCallback(async (id) => {
    try {
      await inventoryApi.remove(id);
      setInventory((prev) => prev.filter((i) => i.id !== id));
    } catch {
      toast.error("Could not delete inventory item");
    }
  }, []);

  // ----- Menu -----
  const upsertMenuItem = useCallback(async (item) => {
    try {
      if (item.id) {
        const updated = await menuApi.update(item.id, item);
        setMenuItems((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        return updated;
      }
      const created = await menuApi.create(item);
      setMenuItems((prev) => [...prev, created]);
      return created;
    } catch {
      toast.error("Could not save menu item");
    }
  }, []);

  const toggleItemAvailability = useCallback(async (id) => {
    const current = menuItems.find((m) => m.id === id);
    if (!current) return;
    try {
      const updated = await menuApi.setAvailability(id, !current.available);
      setMenuItems((prev) => prev.map((m) => (m.id === id ? updated : m)));
    } catch {
      toast.error("Could not toggle item");
    }
  }, [menuItems]);

  const reloadOrders = useCallback(async () => {
    await syncOrdersFromServer(tenantIdRef.current);
  }, [syncOrdersFromServer]);

  const businessType = tenantInfo?.businessType || "restaurant";
  const features = { ...DEFAULT_FEATURES, ...(tenantInfo?.features || {}) };

  const value = {
    bootState, staffUser, login, logout,
    tenantInfo, businessType, features, refreshTenantInfo,
    categories,
    menuItems, upsertMenuItem, toggleItemAvailability, schedules,
    orders, placeOrder, appendToOrder, updateOrderStatus, setOrderPacked, assignDriver, reloadOrders,
    setOrderCustomer, setOrderServiceCharge,
    customers, upsertCustomer, deleteCustomer, refreshCustomers, refreshTables, refreshMenu,
    tables, setTableStatus,
    inventory, adjustStock, reorderStock, upsertInventoryItem, deleteInventoryItem, refreshInventory,
    loyaltyConfig, surgeRules,
    isOffline, pendingSyncCount,
  };

  return <PosContext.Provider value={value}>{children}</PosContext.Provider>;
}

export function usePos() {
  const ctx = useContext(PosContext);
  if (!ctx) throw new Error("usePos must be used within PosProvider");
  return ctx;
}
