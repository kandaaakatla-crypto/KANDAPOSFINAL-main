import React, { useEffect, useState } from "react";
import { ownerData } from "../../api/ownerClient";
import { ChefHat, Copy, RotateCw, Loader2 } from "lucide-react";
import { toast } from "sonner";

/** Owner widget on TenantDetail — shows the current long-lived KDS token and
 *  lets the platform owner rotate / copy the kitchen-tablet URL. */
export default function KdsTokenCard({ tenantId }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [station, setStation] = useState("all");

  const load = () => ownerData.kdsToken(tenantId).then(setData).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId]);

  const rotate = async () => {
    if (!window.confirm("Rotate the KDS token? Any kitchen tablet using the old URL will need to reload with the new one.")) return;
    setBusy(true);
    try {
      const r = await ownerData.rotateKdsToken(tenantId);
      setData((d) => ({ ...(d || {}), ...r }));
      toast.success("KDS token rotated");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not rotate");
    } finally { setBusy(false); }
  };

  if (!data) return null;
  // Compose the URL relative to the current frontend host (preview URL or prod).
  const base = window.location.origin;
  const path = station === "all" ? "/kds" : `/kds/${station}`;
  const url = `${base}${path}?token=${data.token}`;

  return (
    <div data-testid="kds-token-card" className="rounded-xl" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--pos-border)" }}>
        <div className="flex items-center gap-2">
          <ChefHat className="w-4 h-4" style={{ color: "var(--pos-accent)" }} />
          <span className="text-sm font-semibold text-white">Kitchen Display token</span>
        </div>
        <button data-testid="kds-rotate" onClick={rotate} disabled={busy}
          className="pos-btn h-8 px-2.5 rounded-md text-[11px] font-bold flex items-center gap-1.5"
          style={{ background: "var(--pos-panel-2)", color: "#fca5a5", border: "1px solid #7d2e2e" }}>
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />} Rotate
        </button>
      </div>
      <div className="p-4 space-y-3">
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
          <div className="flex gap-2">
            <input data-testid="kds-url" readOnly value={url} onFocus={(e) => e.target.select()}
              className="flex-1 h-10 px-3 rounded-md text-[11px] text-white font-mono"
              style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} />
            <button data-testid="kds-copy" onClick={() => { navigator.clipboard.writeText(url); toast.success("URL copied"); }}
              className="pos-btn h-10 px-3 rounded-md text-xs font-bold flex items-center gap-1.5 text-white"
              style={{ background: "var(--pos-accent)" }}>
              <Copy className="w-3.5 h-3.5" /> Copy
            </button>
          </div>
        </label>
        <p className="text-[11px]" style={{ color: "var(--pos-muted)" }}>
          Open this URL on the kitchen tablet to keep it permanently logged in. Rotate the token any time you replace a device.
        </p>
      </div>
    </div>
  );
}
