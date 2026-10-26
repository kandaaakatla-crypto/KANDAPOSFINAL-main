// Per-device hardware settings (this till's printer / cash drawer) and the
// transport layer that gets bytes to them. Stored in localStorage because
// hardware is attached to the machine, not the store: two tills in one shop
// have different printers.
//
// A printer is { transport, ...target, name }:
//   network   { host, port }                    Windows app, LAN printers
//   queue     { address: <Windows printer> }    Windows app, USB / Bluetooth / installed printers
//   serial    { address: "COM5" }               Windows app, Bluetooth SPP and USB-serial printers
//   webusb    { vendorId, productId }           Chrome / Edge, paired USB printers
//   webserial { usbVendorId, usbProductId }     Chrome / Edge, paired serial / Bluetooth-serial printers
// Older saves of just { host, port } mean "network".
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
const nav = () => (typeof navigator !== "undefined" ? navigator : {});

/** True when the desktop app's device scan is available (Electron build only). */
export function canDiscoverPrinters() {
  return !!(bridge()?.isElectron && bridge().discoverPrinters);
}

/** Scan the local network for printers; resolves to [{ host, port }]. */
export async function discoverPrinters() {
  if (!canDiscoverPrinters()) return [];
  return bridge().discoverPrinters();
}

function normalizePrinter(p) {
  if (!p) return null;
  if (p.transport) return p;
  if (p.host) return { transport: "network", host: p.host, port: p.port || 9100, name: p.host };
  return null;
}

/** The printer to use: the store-level setting wins, then this device's choice. */
export function resolvePrinter(store) {
  if (store?.printer_host) return { transport: "network", host: store.printer_host, port: store.printer_port || 9100, name: store.printer_host };
  return normalizePrinter(getHardware().printer);
}

/** Short human label, e.g. "EPSON TM-T82 (USB)". */
export function printerLabel(p) {
  if (!p) return "";
  if (p.transport === "network") return `${p.host}:${p.port || 9100}`;
  return p.name || p.address || "USB printer";
}

// ---- transports ---------------------------------------------------------

async function sendWebUsb(p, bytes) {
  const devices = await nav().usb.getDevices();
  const dev = devices.find((d) => d.vendorId === p.vendorId && d.productId === p.productId);
  if (!dev) throw new Error("USB printer not found. Pair it again in Devices.");
  if (!dev.opened) await dev.open();
  if (dev.configuration === null) await dev.selectConfiguration(1);
  const iface = dev.configuration.interfaces.find((i) => i.alternates.some((a) => a.interfaceClass === 7))
    || dev.configuration.interfaces[0];
  const alt = iface.alternates.find((a) => a.interfaceClass === 7) || iface.alternates[0];
  const out = alt.endpoints.find((e) => e.direction === "out" && e.type === "bulk");
  if (!out) throw new Error("This USB device has no print endpoint");
  if (!iface.claimed) await dev.claimInterface(iface.interfaceNumber);
  await dev.transferOut(out.endpointNumber, new Uint8Array(bytes));
}

async function sendWebSerial(p, bytes) {
  const ports = await nav().serial.getPorts();
  const port = ports.find((x) => {
    const i = x.getInfo();
    return i.usbVendorId === p.usbVendorId && i.usbProductId === p.usbProductId;
  });
  if (!port) throw new Error("Serial printer not found. Pair it again in Devices.");
  if (!port.readable && !port.writable) await port.open({ baudRate: 9600 });
  const writer = port.writable.getWriter();
  try { await writer.write(new Uint8Array(bytes)); } finally { writer.releaseLock(); }
}

/** True when this app/browser can actually deliver bytes to `printer`. */
export function canSendTo(printer) {
  if (!printer) return false;
  const t = printer.transport;
  if (t === "network" || t === "queue" || t === "serial") return !!(bridge()?.isElectron && (bridge().printRaw || (t === "network" && bridge().printEscpos)));
  if (t === "webusb") return !!nav().usb;
  if (t === "webserial") return !!nav().serial;
  return false;
}

/** Deliver raw bytes to a printer over whichever transport it uses. Throws on failure. */
export async function sendBytes(printer, bytes) {
  const t = printer.transport;
  const b = bridge();
  if (t === "network" || t === "queue" || t === "serial") {
    if (!b?.isElectron) throw new Error("This printer needs the Kanda POS Windows app");
    if (b.printRaw) return b.printRaw({ transport: t, host: printer.host, port: printer.port, address: printer.address }, bytes);
    if (t === "network") return b.printEscpos(printer.host, printer.port || 9100, bytes);
    throw new Error("Update the Kanda POS Windows app to print to this printer");
  }
  if (t === "webusb") return sendWebUsb(printer, bytes);
  if (t === "webserial") return sendWebSerial(printer, bytes);
  throw new Error("Unknown printer type");
}

/** Fire the cash drawer through the configured printer. Resolves false if it can't. */
export async function openCashDrawer(store) {
  const printer = resolvePrinter(store);
  if (!canSendTo(printer)) return false;
  try {
    await sendBytes(printer, DRAWER_KICK_BYTES);
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
