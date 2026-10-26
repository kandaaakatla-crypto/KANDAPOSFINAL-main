// Browser-side device discovery for Chrome / Edge (and the PWA), used when the
// Windows app's system scan isn't available. The browser only reveals devices
// the person has granted, so "Add USB / serial / Bluetooth device" opens the
// browser's own chooser (which lists everything currently connected) and
// remembers the pick; already-granted devices are listed without asking again.
const nav = () => (typeof navigator !== "undefined" ? navigator : {});

const hex = (n) => (typeof n === "number" ? n.toString(16).padStart(4, "0") : "----");

/** Which kinds of device this browser can see at all. */
export function webSupport() {
  const n = nav();
  return { usb: !!n.usb, serial: !!n.serial, hid: !!n.hid, bluetooth: !!n.bluetooth };
}

function usbKind(d) {
  const classes = [d.deviceClass, ...(d.configurations || []).flatMap((c) => c.interfaces.flatMap((i) => i.alternates.map((a) => a.interfaceClass)))];
  if (classes.includes(7)) return "printer";
  if (classes.includes(3)) return "input"; // HID: scanners and keyboards
  return "usb";
}

/** Devices this browser has permission for right now. Never prompts. */
export async function listWebDevices() {
  const n = nav();
  const out = [];
  try {
    if (n.usb) {
      for (const d of await n.usb.getDevices()) {
        const kind = usbKind(d);
        out.push({
          id: `webusb:${d.vendorId}:${d.productId}:${d.serialNumber || ""}`,
          kind, name: d.productName || `USB device ${hex(d.vendorId)}:${hex(d.productId)}`, connection: "USB",
          transport: kind === "printer" ? "webusb" : null,
          target: { vendorId: d.vendorId, productId: d.productId },
          printable: kind === "printer",
        });
      }
    }
  } catch { /* permission policy can block enumeration: just show fewer devices */ }
  try {
    if (n.serial) {
      for (const p of await n.serial.getPorts()) {
        const i = p.getInfo();
        out.push({
          id: `webserial:${i.usbVendorId ?? "bt"}:${i.usbProductId ?? ""}`,
          kind: "serial", name: i.usbVendorId ? `Serial device ${hex(i.usbVendorId)}:${hex(i.usbProductId)}` : "Bluetooth / serial port",
          connection: i.usbVendorId ? "USB" : "Bluetooth",
          transport: "webserial", target: { usbVendorId: i.usbVendorId, usbProductId: i.usbProductId }, printable: true,
        });
      }
    }
  } catch { /* see above */ }
  try {
    if (n.hid) {
      for (const d of await n.hid.getDevices()) {
        const scanner = /scanner|barcode|symbol|zebra|honeywell|datalogic/i.test(d.productName || "");
        out.push({ id: `webhid:${d.vendorId}:${d.productId}`, kind: scanner ? "scanner" : "input", name: d.productName || "HID device", connection: "USB", transport: null, printable: false });
      }
    }
  } catch { /* see above */ }
  try {
    if (n.bluetooth?.getDevices) {
      for (const d of await n.bluetooth.getDevices()) {
        out.push({ id: `webbt:${d.id}`, kind: "bluetooth", name: d.name || "Bluetooth device", connection: "Bluetooth", transport: null, printable: false });
      }
    }
  } catch { /* getDevices is behind a flag in some builds */ }
  return out;
}

/** Opens the browser's chooser. Must be called from a click. Resolves true if something was added. */
export async function pairWebDevice(type) {
  const n = nav();
  try {
    if (type === "usb") await n.usb.requestDevice({ filters: [] });
    else if (type === "serial") await n.serial.requestPort({});
    else if (type === "hid") await n.hid.requestDevice({ filters: [] });
    else if (type === "bluetooth") await n.bluetooth.requestDevice({ acceptAllDevices: true });
    else return false;
    return true;
  } catch {
    return false; // chooser dismissed
  }
}
