import { Capacitor } from "@capacitor/core";
import * as dexieRepo from "./dexieRepo";
import * as sqliteRepo from "./sqliteRepo";

// Local-first repository — the only thing PosContext/syncEngine talk to for
// reads and writes. Two implementations exist behind this same shape:
// dexieRepo.js (IndexedDB, web build + the future Electron shell) and
// sqliteRepo.js (native SQLite, Android — Capacitor's WebView storage isn't
// durable enough to trust with unsynced, money-bearing writes). This module
// just picks one at load time; every function below is re-exported as-is so
// callers (`import * as repo from "./repo"`) never need to know which.
const backend = Capacitor.getPlatform() === "android" ? sqliteRepo : dexieRepo;

export const {
  getAll,
  getById,
  putMany,
  replaceAll,
  getMeta,
  setMeta,
  enqueueMutation,
  listPendingMutations,
  markMutationSynced,
  markMutationFailed,
  remapDependentMutations,
  upsertLocalOrder,
  listLocalOrders,
  getLocalOrder,
  removeLocalOrder,
  remapLocalOrderId,
} = backend;
