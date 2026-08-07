// Single source of truth for which server collections are mirrored locally
// via delta sync (see syncEngine.js). Shared by both Repo backends —
// dexieRepo.js (IndexedDB, web/Electron) and sqliteRepo.js (native SQLite,
// Android) — so they can never drift out of sync with each other.
export const CACHE_COLLECTIONS = [
  "menuItems",
  "categories",
  "inventory",
  "customers",
  "menuSchedules",
  "diningTables",
];
