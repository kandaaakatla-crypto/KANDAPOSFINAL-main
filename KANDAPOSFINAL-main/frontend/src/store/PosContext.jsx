import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  auth, tokenStore, menuApi, tablesApi, customersApi,
  inventoryApi, ordersApi,
} from "../api/client";
import { connectWs } from "../api/ws";
import { toast } from "sonner";

const PosContext = createContext(null);

export function PosProvider({ children }) {
  const [bootState, setBootState] = useState("loading"); // loading | ready
  const [staffUser, setStaffUser] = useState(null);

  const [categories, setCategories] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [tables, setTables] = useState([]);
  const [inventory, setInventory] = useState([]);

  // Load all resources after auth confirmed
  const loadAll = useCallback(async () => {
    try {
      const [cats, items, ords, custs, tbls, inv] = await Promise.all([
        menuApi.categories(), menuApi.items(), ordersApi.list(),
        customersApi.list(), tablesApi.list(), inventoryApi.list(),
      ]);
      setCategories(cats);
      setMenuItems(items);
      setOrders(ords);
      setCustomers(custs);
      setTables(tbls);
      setInventory(inv);
    } catch (e) {
      // 401 handled by interceptor; surface other errors
      if (e?.response?.status !== 401) {
        toast.error("Could not load POS data");
      }
    }
  }, []);

  // Boot: if token, fetch me + data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const t = tokenStore.get();
      if (!t) { setBootState("ready"); return; }
      try {
        const me = await auth.me();
        if (cancelled) return;
        setStaffUser(me);
        await loadAll();
      } catch {
        tokenStore.clear();
      } finally {
        if (!cancelled) setBootState("ready");
      }
    })();
    return () => { cancelled = true; };
  }, [loadAll]);

  // Realtime updates — subscribe whenever a staff user is logged in.
  useEffect(() => {
    if (!staffUser) return undefined;
    const dispose = connectWs((evt) => {
      if (!evt || !evt.type) return;
      if (evt.type === "order.upserted") {
        const o = evt.data;
        setOrders((prev) => {
          const i = prev.findIndex((x) => x.id === o.id);
          if (i >= 0) { const copy = [...prev]; copy[i] = o; return copy; }
          return [o, ...prev];
        });
      } else if (evt.type === "table.updated") {
        setTables((prev) => prev.map((t) => (t.id === evt.data.id ? evt.data : t)));
      } else if (evt.type === "inventory.updated") {
        const { item, low } = evt.data;
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
      await loadAll();
      return user;
    } catch {
      return null;
    }
  }, [loadAll]);

  const logout = useCallback(() => {
    tokenStore.clear();
    setStaffUser(null);
    setOrders([]); setCustomers([]); setTables([]); setInventory([]); setMenuItems([]); setCategories([]);
  }, []);

  // ----- Orders -----
  const placeOrder = useCallback(async (order) => {
    try {
      const created = await ordersApi.create(order);
      setOrders((prev) => [created, ...prev]);
      // refresh tables + customers (counts may have changed)
      const [tbls, custs] = await Promise.all([tablesApi.list(), customersApi.list()]);
      setTables(tbls);
      setCustomers(custs);
      return created;
    } catch (e) {
      toast.error("Could not place order");
      throw e;
    }
  }, []);

  const appendToOrder = useCallback(async (orderId, items) => {
    try {
      const updated = await ordersApi.appendItems(orderId, items);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      return updated;
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not add items to bill");
      throw e;
    }
  }, []);

  const updateOrderStatus = useCallback(async (orderId, status) => {
    try {
      const updated = await ordersApi.setStatus(orderId, status);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      if (status === "completed") {
        const tbls = await tablesApi.list();
        setTables(tbls);
      }
    } catch {
      toast.error("Could not update order status");
    }
  }, []);

  const assignDriver = useCallback(async (orderId, driverName) => {
    try {
      const updated = await ordersApi.assignDriver(orderId, driverName);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      return updated;
    } catch {
      toast.error("Could not assign driver");
    }
  }, []);

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


  // ----- Tables -----
  const setTableStatus = useCallback(async (tableId, status) => {
    try {
      const updated = await tablesApi.update(tableId, { status });
      setTables((prev) => prev.map((t) => (t.id === tableId ? updated : t)));
    } catch {
      toast.error("Could not update table");
    }
  }, []);

  // ----- Inventory -----
  const adjustStock = useCallback(async (id, delta) => {
    try {
      const updated = await inventoryApi.adjust(id, delta);
      setInventory((prev) => prev.map((i) => (i.id === id ? updated : i)));
    } catch {
      toast.error("Could not adjust stock");
    }
  }, []);

  const reorderStock = useCallback(async (id) => {
    try {
      const updated = await inventoryApi.reorder(id);
      setInventory((prev) => prev.map((i) => (i.id === id ? updated : i)));
    } catch {
      toast.error("Could not place reorder");
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
    try { const fresh = await ordersApi.list(); setOrders(fresh); } catch {}
  }, []);

  const value = {
    bootState, staffUser, login, logout,
    categories,
    menuItems, upsertMenuItem, toggleItemAvailability,
    orders, placeOrder, appendToOrder, updateOrderStatus, assignDriver, reloadOrders,
    customers, upsertCustomer, deleteCustomer, refreshCustomers, refreshTables, refreshMenu,
    tables, setTableStatus,
    inventory, adjustStock, reorderStock,
  };

  return <PosContext.Provider value={value}>{children}</PosContext.Provider>;
}

export function usePos() {
  const ctx = useContext(PosContext);
  if (!ctx) throw new Error("usePos must be used within PosProvider");
  return ctx;
}
