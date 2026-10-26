import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Printer, ScanLine, Search, Loader2, CheckCircle2, Bluetooth, Usb, Keyboard, Cable, RefreshCw, Camera, Wifi,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Switch } from "../ui/switch";
import useScannerWatch from "../../hooks/useScannerWatch";
import { usePos } from "../../store/PosContext";
import { buildEscposReceipt } from "../../utils/escpos";
import {
  canDiscoverPrinters, discoverPrinters, getHardware, saveHardware, openCashDrawer, resolvePrinter,
  canSendTo, sendBytes, printerLabel,
} from "../../utils/hardware";
import { listWebDevices, pairWebDevice, webSupport } from "../../utils/webDevices";

const TEST_ORDER = {
  number: 0, type: "sale", items: [{ name: "Test print", qty: 1, price: 0 }], total: 0, subtotal: 0,
  placedAt: new Date().toISOString(), customer: {}, payment: "cash",
};

const BTN = { background: "var(--pos-panel-2)", color: "var(--pos-text)", border: "1px solid var(--pos-border)" };
const POLL_MS = 4000;

const KIND_ICON = { printer: Printer, serial: Cable, scanner: ScanLine, bluetooth: Bluetooth, usb: Usb, input: Keyboard, camera: Camera, network: Wifi };
const KIND_LABEL = { printer: "Printer", serial: "Serial port", scanner: "Barcode scanner", bluetooth: "Bluetooth device", usb: "USB device", input: "Keyboard / HID", network: "Network printer" };

/** Turns a listed device into the saved-printer shape, or null if it can't print. */
function toPrinter(d) {
  if (!d.printable) return null;
  if (d.transport === "network") return { transport: "network", host: d.host, port: d.port, name: d.name };
  if (d.transport === "queue" || d.transport === "serial") return { transport: d.transport, address: d.address, name: d.name };
  if (d.transport === "webusb") return { transport: "webusb", ...d.target, name: d.name };
  if (d.transport === "webserial") return { transport: "webserial", ...d.target, name: d.name };
  return null;
}

const samePrinter = (a, b) => !!a && !!b && a.transport === b.transport
  && (a.host || a.address || `${a.vendorId || a.usbVendorId}:${a.productId || a.usbProductId}`) === (b.host || b.address || `${b.vendorId || b.usbVendorId}:${b.productId || b.usbProductId}`);

/** Manager-facing "Devices" dialog. One list of everything connected or paired:
 *  printers (USB, Bluetooth, network), serial ports, scanners and other USB / Bluetooth
 *  devices. It refreshes by itself while open, so plugging something in makes it appear. */
export default function DevicesPanel({ open, onClose }) {
  const { tenantInfo } = usePos();
  const [hw, setHw] = useState(getHardware);
  const [devices, setDevices] = useState([]);
  const [network, setNetwork] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [lastScan, setLastScan] = useState(null);
  const knownIds = useRef(null);
  const desktop = canDiscoverPrinters();
  const web = webSupport();
  const printer = resolvePrinter(tenantInfo?.store);

  useScannerWatch(useCallback((code) => setLastScan({ code, at: new Date() }), []));

  const update = (patch) => setHw(saveHardware(patch));

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = window.kandaDesktop?.listDevices ? await window.kandaDesktop.listDevices() : await listWebDevices();
      setDevices(list);
      setError("");
      // Say so when something new shows up after the panel was opened (the plug-in moment).
      const ids = new Set(list.map((d) => d.id));
      if (knownIds.current) {
        const fresh = list.filter((d) => !knownIds.current.has(d.id));
        if (fresh.length) toast.success(`New device: ${fresh[0].name}`);
      }
      knownIds.current = ids;
    } catch {
      setError("Could not read the connected devices.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) { knownIds.current = null; return undefined; }
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [open, refresh]);

  const scanNetwork = async () => {
    setScanning(true);
    try {
      const list = await discoverPrinters();
      setNetwork(list.map((p) => ({ id: `net:${p.host}`, kind: "printer", name: `Network printer ${p.host}`, connection: "Network", transport: "network", host: p.host, port: p.port, printable: true })));
      if (list.length === 0) toast.info("No network printers answered");
    } catch { toast.error("Could not scan the network"); } finally { setScanning(false); }
  };

  const pair = async (type) => {
    if (await pairWebDevice(type)) refresh();
  };

  const chooseAsPrinter = (d) => {
    const p = toPrinter(d);
    if (p) update({ printer: p });
  };

  const testPrint = async () => {
    try {
      await sendBytes(printer, buildEscposReceipt(TEST_ORDER, tenantInfo?.store || {}, "customer"));
      toast.success("Test page sent");
    } catch (e) {
      toast.error(e?.message || "The printer did not respond");
    }
  };

  const testDrawer = async () => {
    if (await openCashDrawer(tenantInfo?.store)) toast.success("Drawer signal sent");
    else toast.error("Could not reach the drawer. Check that it is plugged into the printer.");
  };

  const all = [...devices, ...network.filter((n) => !devices.some((d) => d.id === n.id))];
  const canPrintNow = canSendTo(printer);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} data-testid="devices-panel">
        <DialogHeader><DialogTitle style={{ color: "var(--pos-text)" }}>Devices</DialogTitle></DialogHeader>

        <section className="space-y-2" aria-labelledby="dev-active">
          <h3 id="dev-active" className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>In use on this till</h3>
          <div className="rounded-lg px-3 py-2.5 text-sm space-y-2" style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)" }}>
            <div className="flex items-center gap-2" data-testid="printer-current">
              <Printer className="w-4 h-4 shrink-0" />
              {printer ? <>Printer: <b className="truncate">{printerLabel(printer)}</b>{canPrintNow ? <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: "#16a34a" }} /> : <span className="text-xs" style={{ color: "#f59e0b" }}>(not reachable from this app)</span>}</> : <span style={{ color: "var(--pos-muted)" }}>No printer chosen. Pick one from the list below.</span>}
            </div>
            <div className="flex items-center gap-2" data-testid={lastScan ? "scanner-detected" : "scanner-waiting"}>
              <ScanLine className="w-4 h-4 shrink-0" />
              {lastScan ? <>Scanner working. Last scan: <b className="truncate">{lastScan.code}</b></> : <span style={{ color: "var(--pos-muted)" }}>Scan any barcode to confirm the scanner. Nothing to set up.</span>}
            </div>
            <label className="flex items-center justify-between gap-3">
              Open the cash drawer after cash sales
              <Switch data-testid="drawer-on-cash" aria-label="Open cash drawer after cash sales" checked={!!hw.drawerOnCash}
                disabled={!canPrintNow} onCheckedChange={(v) => update({ drawerOnCash: v })} />
            </label>
            {canPrintNow && (
              <div className="flex gap-2 pt-1">
                <button data-testid="printer-test" onClick={testPrint} className="pos-btn h-9 px-3 rounded-lg text-xs font-bold" style={BTN}>Print test page</button>
                <button data-testid="drawer-test" onClick={testDrawer} className="pos-btn h-9 px-3 rounded-lg text-xs font-bold" style={BTN}>Open drawer now</button>
              </div>
            )}
          </div>
          <p className="text-[11px]" style={{ color: "var(--pos-muted)" }}>Cash drawers plug into the receipt printer, so choosing the printer covers the drawer.</p>
        </section>

        <section className="space-y-2" aria-labelledby="dev-all">
          <div className="flex items-center justify-between gap-2">
            <h3 id="dev-all" className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Connected and paired devices</h3>
            <button data-testid="devices-refresh" onClick={refresh} aria-label="Refresh devices" className="pos-btn h-8 px-2.5 rounded-md text-xs font-bold flex items-center gap-1.5" style={BTN}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>

          {error && <p role="alert" className="text-xs" style={{ color: "#f87171" }}>{error}</p>}
          {!error && all.length === 0 && !loading && (
            <p className="text-sm" role="status" data-testid="devices-empty" style={{ color: "var(--pos-muted)" }}>
              Nothing found yet. Plug a device in or switch it on; it will appear here by itself.
            </p>
          )}

          <ul className="space-y-1.5" data-testid="devices-list">
            {all.map((d) => {
              const Icon = KIND_ICON[d.kind] || Usb;
              const p = toPrinter(d);
              const active = samePrinter(p, printer);
              return (
                <li key={d.id} data-testid={`device-${d.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)" }}>
                  <Icon className="w-4 h-4 shrink-0" style={{ color: "var(--pos-muted)" }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{d.name}</div>
                    <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>
                      {KIND_LABEL[d.kind] || "Device"} · {d.connection}{d.note ? ` · ${d.note}` : ""}
                    </div>
                  </div>
                  {p && (
                    <button data-testid={`device-use-${d.id}`} onClick={() => chooseAsPrinter(d)} disabled={active}
                      className="pos-btn text-xs font-bold px-2.5 py-1.5 rounded shrink-0"
                      style={{ background: active ? "var(--pos-border)" : "var(--pos-accent)", color: "#fff" }}>
                      {active ? "In use" : "Use as printer"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap gap-2 pt-1">
            {desktop && (
              <button data-testid="printer-scan" onClick={scanNetwork} disabled={scanning}
                className="pos-btn h-9 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5" style={BTN}>
                {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                {scanning ? "Searching…" : "Search network for printers"}
              </button>
            )}
            {!desktop && web.usb && <button data-testid="pair-usb" onClick={() => pair("usb")} className="pos-btn h-9 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5" style={BTN}><Usb className="w-3.5 h-3.5" /> Add USB device</button>}
            {!desktop && web.serial && <button data-testid="pair-serial" onClick={() => pair("serial")} className="pos-btn h-9 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5" style={BTN}><Cable className="w-3.5 h-3.5" /> Add serial / Bluetooth port</button>}
            {!desktop && web.bluetooth && <button data-testid="pair-bluetooth" onClick={() => pair("bluetooth")} className="pos-btn h-9 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5" style={BTN}><Bluetooth className="w-3.5 h-3.5" /> Add Bluetooth device</button>}
            {!desktop && web.hid && <button data-testid="pair-hid" onClick={() => pair("hid")} className="pos-btn h-9 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5" style={BTN}><Keyboard className="w-3.5 h-3.5" /> Add scanner / HID device</button>}
          </div>
          {!desktop && !web.usb && !web.serial && !web.bluetooth && (
            <p className="text-xs" style={{ color: "var(--pos-muted)" }}>This browser cannot see USB or Bluetooth devices. Use Chrome or Edge, or the Kanda POS Windows app. Receipts will still print through the system print dialog.</p>
          )}
          {!desktop && (web.usb || web.serial || web.bluetooth) && (
            <p className="text-[11px]" style={{ color: "var(--pos-muted)" }}>A browser only shows devices you allow. Use the buttons above once per device; the Windows app lists everything without asking.</p>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
