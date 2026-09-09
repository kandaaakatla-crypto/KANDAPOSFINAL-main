import React, { useEffect, useState } from "react";
import { ownerData } from "../../api/ownerClient";
import { ChefHat, Package, Monitor, Copy, RotateCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "../ui/alert-dialog";

function TokenUrlRow({ testid, url }) {
  return (
    <div className="flex gap-2">
      <input data-testid={testid} readOnly value={url} onFocus={(e) => e.target.select()}
        className="flex-1 h-10 px-3 rounded-md text-[11px] font-mono"
        style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
      <button data-testid={`${testid}-copy`} onClick={() => { navigator.clipboard.writeText(url); toast.success("URL copied"); }}
        className="pos-btn h-10 px-3 rounded-md text-xs font-bold flex items-center gap-1.5 text-white"
        style={{ background: "var(--pos-accent)" }}>
        <Copy className="w-3.5 h-3.5" /> Copy
      </button>
    </div>
  );
}

/** Owner widget on TenantDetail — shows the tenant's long-lived kiosk token
 *  and lets the platform owner rotate / copy the tablet URLs for all three
 *  no-login kiosk screens that share it: Kitchen Display, Packing Station,
 *  and Customer Display (order status). */
export default function KdsTokenCard({ tenantId }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [station, setStation] = useState("all");

  const load = () => ownerData.kdsToken(tenantId).then(setData).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId]);

  const rotate = async () => {
    setBusy(true);
    try {
      const r = await ownerData.rotateKdsToken(tenantId);
      setData((d) => ({ ...(d || {}), ...r }));
      toast.success("Kiosk token rotated");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not rotate");
    } finally { setBusy(false); }
  };

  if (!data) return null;
  // Compose URLs relative to the current frontend host (preview URL or prod).
  const base = window.location.origin;
  const kdsPath = station === "all" ? "/kds" : `/kds/${station}`;
  const kdsUrl = `${base}${kdsPath}?token=${data.token}`;
  const packingUrl = `${base}/packing?token=${data.token}`;
  const displayUrl = `${base}/display?token=${data.token}`;

  return (
    <div data-testid="kds-token-card" className="rounded-xl" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--pos-border)" }}>
        <div className="flex items-center gap-2">
          <ChefHat className="w-4 h-4" style={{ color: "var(--pos-accent)" }} />
          <span className="text-sm font-semibold" style={{ color: "var(--pos-text)" }}>Kiosk tablet tokens</span>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button data-testid="kds-rotate" disabled={busy}
              className="pos-btn h-8 px-2.5 rounded-md text-[11px] font-bold flex items-center gap-1.5"
              style={{ background: "var(--pos-panel-2)", color: "#fca5a5", border: "1px solid #7d2e2e" }}>
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />} Rotate
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Rotate the kiosk token?</AlertDialogTitle>
              <AlertDialogDescription>
                Any Kitchen Display, Packing Station, or Customer Display tablet using the old URL will need to reload with the new one.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction data-testid="kds-rotate-confirm" onClick={rotate}>Rotate</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <div className="p-4 space-y-5">
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-bold" style={{ color: "var(--pos-text)" }}><ChefHat className="w-3.5 h-3.5" style={{ color: "var(--pos-accent)" }} /> Kitchen Display</div>
          <div>
            <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--pos-muted)" }}>Station</div>
            <div className="flex flex-wrap gap-1.5">
              {["all", ...(data.stations || [])].map((s) => (
                <button key={s} data-testid={`kds-station-pick-${s}`} type="button" onClick={() => setStation(s)}
                  className="pos-btn h-7 px-2.5 rounded-md text-[11px] font-bold capitalize"
                  style={{
                    background: station === s ? "var(--pos-accent)" : "var(--pos-panel-2)",
                    color: station === s ? "#fff" : "var(--pos-muted)",
                    border: "1px solid var(--pos-border)",
                  }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--pos-muted)" }}>Tablet URL</div>
            <TokenUrlRow testid="kds-url" url={kdsUrl} />
          </label>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold" style={{ color: "var(--pos-text)" }}><Package className="w-3.5 h-3.5" style={{ color: "var(--pos-accent)" }} /> Packing Station</div>
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--pos-muted)" }}>Tablet URL</div>
            <TokenUrlRow testid="packing-url" url={packingUrl} />
          </label>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold" style={{ color: "var(--pos-text)" }}><Monitor className="w-3.5 h-3.5" style={{ color: "var(--pos-accent)" }} /> Customer Display (order status)</div>
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--pos-muted)" }}>Tablet URL</div>
            <TokenUrlRow testid="display-url" url={displayUrl} />
          </label>
        </div>

        <p className="text-[11px]" style={{ color: "var(--pos-muted)" }}>
          Open the matching URL on each tablet to keep it permanently logged in — no staff PIN needed. All three share one token, so rotating it updates every screen at once.
        </p>
      </div>
    </div>
  );
}
