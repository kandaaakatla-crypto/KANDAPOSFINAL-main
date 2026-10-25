// Per-device hardware settings (this till's printer / cash drawer) and the
// helpers the Devices panel uses. Stored in localStorage because hardware is
// attached to the machine, not the store: two tills in one shop have
// different printers.
const KEY = "kanda_hw_v1";

// ESC p m t1 t2: pulse pin 2 for ~50ms. The standard way to pop a cash drawer
// wired to a receipt printer's RJ11 port (which is nearly every drawer).
export const DRAWER_KICK_BYTES = [0x1b, 0x70, 0x00, 0x19, 0xfa];

const DEFAULTS = { printer: null, drawerOnCash: false };

export function getHardware() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveHardware(patch) {
  const next = { ...getHardware(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked: setting just won't persist */ }
  return next;
}

const bridge = () => (typeof window !== "undefined" ? window.kandaDesktop : null);

/** True when the desktop app's printer scan is available (Electron build only). */
export function canDiscoverPrinters() {
  return !!(bridge()?.isElectron && bridge().discoverPrinters);
}

/** Scan the local network for printers; resolves to [{ host, port }]. */
export async function discoverPrinters() {
  if (!canDiscoverPrinters()) return [];
  return bridge().discoverPrinters();
}

/** The printer to use: the store-level setting wins, then this device's choice. */
export function resolvePrinter(store) {
  if (store?.printer_host) return { host: store.printer_host, port: store.printer_port || 9100 };
  return getHardware().printer;
}

/** Fire the cash drawer through the configured printer. Resolves false if it can't. */
export async function openCashDrawer(store) {
  const printer = resolvePrinter(store);
  const b = bridge();
  if (!printer || !b?.isElectron || !b.printEscpos) return false;
  try {
    await b.printEscpos(printer.host, printer.port || 9100, DRAWER_KICK_BYTES);
    return true;
  } catch {
    return false;
  }
}

/** Called after a cash sale: pops the drawer if this till is set up to. Never throws. */
export async function kickDrawerForCash(store) {
  if (!getHardware().drawerOnCash) return false;
  return openCashDrawer(store);
}
