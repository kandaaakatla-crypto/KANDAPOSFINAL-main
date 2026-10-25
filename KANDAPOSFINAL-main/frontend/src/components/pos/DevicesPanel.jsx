import React, { useCallback, useState } from "react";
import { toast } from "sonner";
import { Printer, ScanLine, Search, Loader2, CheckCircle2, Vault } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Switch } from "../ui/switch";
import useScannerWatch from "../../hooks/useScannerWatch";
import { usePos } from "../../store/PosContext";
import { buildEscposReceipt } from "../../utils/escpos";
import {
  canDiscoverPrinters, discoverPrinters, getHardware, saveHardware, openCashDrawer, resolvePrinter,
} from "../../utils/hardware";

const TEST_ORDER = {
  number: 0, type: "sale", items: [{ name: "Test print", qty: 1, price: 0 }], total: 0, subtotal: 0,
  placedAt: new Date().toISOString(), customer: {}, payment: "cash",
};

const BTN = { background: "var(--pos-panel-2)", color: "var(--pos-text)", border: "1px solid var(--pos-border)" };

/** Manager-facing "Devices" dialog: finds the receipt printer (and so the cash
 *  drawer wired to it) on the network, and shows whether a barcode scanner has
 *  been seen. Nothing to type: scan, pick, done. */
export default function DevicesPanel({ open, onClose }) {
  const { tenantInfo } = usePos();
  const [hw, setHw] = useState(getHardware);
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState(null);
  const [lastScan, setLastScan] = useState(null);
  const desktop = canDiscoverPrinters();
  const printer = resolvePrinter(tenantInfo?.store);

  useScannerWatch(useCallback((code) => setLastScan({ code, at: new Date() }), []));

  const update = (patch) => setHw(saveHardware(patch));

  const scan = async () => {
    setScanning(true);
    setFound(null);
    try {
      const list = await discoverPrinters();
      setFound(list);
      if (list.length === 1 && !hw.printer) update({ printer: list[0] });
    } catch {
      toast.error("Could not scan the network");
      setFound([]);
    } finally {
      setScanning(false);
    }
  };

  const testPrint = async () => {
    try {
      const bytes = buildEscposReceipt(TEST_ORDER, tenantInfo?.store || {}, "customer");
      await window.kandaDesktop.printEscpos(printer.host, printer.port || 9100, bytes);
      toast.success("Test page sent");
    } catch {
      toast.error("The printer did not respond");
    }
  };

  const testDrawer = async () => {
    const ok = await openCashDrawer(tenantInfo?.store);
    if (ok) toast.success("Drawer signal sent");
    else toast.error("Could not reach the drawer. Check that it is plugged into the printer.");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} data-testid="devices-panel">
        <DialogHeader><DialogTitle style={{ color: "var(--pos-text)" }}>Devices</DialogTitle></DialogHeader>

        <section className="space-y-2" aria-labelledby="dev-printer">
          <h3 id="dev-printer" className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "var(--pos-muted)" }}>
            <Printer className="w-3.5 h-3.5" /> Receipt printer
          </h3>
          {printer ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--pos-text)" }} data-testid="printer-current">
              <CheckCircle2 className="w-4 h-4" style={{ color: "#16a34a" }} /> Connected to {printer.host}:{printer.port || 9100}
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--pos-muted)" }}>No printer chosen yet.</p>
          )}
          {desktop ? (
            <>
              <button data-testid="printer-scan" onClick={scan} disabled={scanning}
                className="pos-btn h-10 px-3 rounded-lg text-sm font-bold text-white flex items-center gap-2" style={{ background: "var(--pos-accent)" }}>
                {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                {scanning ? "Searching your network…" : "Find printers"}
              </button>
              {found && found.length === 0 && (
                <p className="text-xs" role="status" style={{ color: "var(--pos-muted)" }}>
                  No printers answered. Check that it is on, on the same Wi-Fi or cable as this till, and that raw printing (port 9100) is enabled.
                </p>
              )}
              {found && found.map((p) => (
                <div key={p.host} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm" style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)" }}>
                  <span>{p.host}:{p.port}</span>
                  <button data-testid={`printer-use-${p.host}`} onClick={() => update({ printer: p })}
                    className="pos-btn text-xs font-bold px-2.5 py-1 rounded"
                    style={{ background: hw.printer?.host === p.host ? "var(--pos-border)" : "var(--pos-accent)", color: "#fff" }}>
                    {hw.printer?.host === p.host ? "In use" : "Use this"}
                  </button>
                </div>
              ))}
              {printer && (
                <button data-testid="printer-test" onClick={testPrint} className="pos-btn h-9 px-3 rounded-lg text-xs font-bold" style={BTN}>
                  Print test page
                </button>
              )}
            </>
          ) : (
            <p className="text-xs" style={{ color: "var(--pos-muted)" }}>
              Automatic printer search runs in the Kanda POS Windows app. In a browser or on Android, receipts print through the system print dialog.
            </p>
          )}
        </section>

        <section className="space-y-2" aria-labelledby="dev-drawer">
          <h3 id="dev-drawer" className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "var(--pos-muted)" }}>
            <Vault className="w-3.5 h-3.5" /> Cash drawer
          </h3>
          <p className="text-xs" style={{ color: "var(--pos-muted)" }}>Drawers plug into the receipt printer, so once the printer is found the drawer is too.</p>
          <label className="flex items-center justify-between gap-3 text-sm" style={{ color: "var(--pos-text)" }}>
            Open drawer after cash sales
            <Switch data-testid="drawer-on-cash" aria-label="Open drawer after cash sales" checked={!!hw.drawerOnCash}
              disabled={!desktop || !printer} onCheckedChange={(v) => update({ drawerOnCash: v })} />
          </label>
          {desktop && printer && (
            <button data-testid="drawer-test" onClick={testDrawer} className="pos-btn h-9 px-3 rounded-lg text-xs font-bold" style={BTN}>
              Open drawer now
            </button>
          )}
        </section>

        <section className="space-y-2" aria-labelledby="dev-scanner">
          <h3 id="dev-scanner" className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "var(--pos-muted)" }}>
            <ScanLine className="w-3.5 h-3.5" /> Barcode scanner
          </h3>
          {lastScan ? (
            <div className="flex items-center gap-2 text-sm" data-testid="scanner-detected" style={{ color: "var(--pos-text)" }}>
              <CheckCircle2 className="w-4 h-4" style={{ color: "#16a34a" }} /> Scanner detected. Last scan: <b>{lastScan.code}</b>
            </div>
          ) : (
            <p className="text-sm" data-testid="scanner-waiting" style={{ color: "var(--pos-muted)" }}>
              Plug in the scanner and scan any barcode. It is detected automatically; nothing to set up.
            </p>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
