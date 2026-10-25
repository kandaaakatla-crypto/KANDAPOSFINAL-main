import React, { useEffect, useState } from "react";
import { ChefHat, Package, Monitor, Copy, RotateCw, Loader2, Lock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, posDevicesApi } from "../../api/client";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "../ui/alert-dialog";
import { fmtDateTime } from "../../utils/formatDate";

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

// POS tills unlocked by a manager (components/pos/DeviceUnlock.jsx). Removing
// one locks it again: staff PINs stop working there until a manager unlocks
// it anew.
function UnlockedTillsCard() {
  const [tills, setTills] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const load = () => posDevicesApi.list()
    .then((t) => { setTills(t); setLoadError(false); })
    .catch(() => setLoadError(true));
  useEffect(() => { load(); }, []);

  const remove = async (id) => {
    try {
      await posDevicesApi.remove(id);
      toast.success("Till removed. It's locked until a manager unlocks it again.");
      load();
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Could not remove till");
    }
  };

  const fmt = (iso) => (iso ? fmtDateTime(iso) : "never");

  return (
    <div data-testid="pos-tills-card" className="rounded-xl mb-5" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
      <div className="px-4 py-3 flex items-center gap-1.5" style={{ borderBottom: "1px solid var(--pos-border)" }}>
        <Lock className="w-3.5 h-3.5" style={{ color: "var(--pos-accent)" }} />
        <span className="text-sm font-semibold" style={{ color: "var(--pos-text)" }}>Unlocked POS tills</span>
      </div>
      <div className="p-4">
        {loadError ? (
          <div className="text-xs flex items-center gap-2" style={{ color: "#f87171" }}>
            Couldn't load the list of tills.
            <button onClick={load} className="underline" style={{ color: "var(--pos-text)" }}>Try again</button>
          </div>
        ) : tills === null ? (
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--pos-muted)" }} />
        ) : tills.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--pos-muted)" }}>
            No tills unlocked yet. Open your restaurant's staff sign-in page on the till and sign in once with a manager's email and password.
          </p>
        ) : (
          <div className="space-y-2">
            {tills.map((t) => (
              <div key={t.id} data-testid={`pos-till-${t.id}`} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2"
                style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: "var(--pos-text)" }}>{t.name}</div>
                  <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>
                    Unlocked by {t.created_by} · {fmt(t.created_at)} · last used {fmt(t.last_seen_at)}
                  </div>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button data-testid={`pos-till-remove-${t.id}`} className="pos-btn h-8 px-2.5 rounded-md text-[11px] font-bold flex items-center gap-1.5 shrink-0"
                      style={{ background: "var(--pos-panel)", color: "#fca5a5", border: "1px solid #7d2e2e" }}>
                      <Trash2 className="w-3 h-3" /> Remove
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove "{t.name}"?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Staff won't be able to sign in or clock in on this till until a manager unlocks it again.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => remove(t.id)}>Remove</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Self-serve counterpart to the Platform Owner's KdsTokenCard.jsx — same
// shared kds_token, same three kiosk screens, but for the store's own
// owner/manager instead of requiring a Platform Owner support request.
// Scoped to whichever tenant the dashboard is currently switched to
// (StoreSwitcher), same as every other /dashboard page.
export default function KioskDevicesPage() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [station, setStation] = useState("all");

  const load = () => api.get("/kds/my-token").then((r) => setData(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const rotate = async () => {
    setBusy(true);
    try {
      const r = await api.post("/kds/my-token/rotate");
      setData((d) => ({ ...(d || {}), ...r.data }));
      toast.success("Kiosk token rotated");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not rotate");
    } finally { setBusy(false); }
  };

  if (!data) return null;
  const base = window.location.origin;
  const kdsPath = station === "all" ? "/kds" : `/kds/${station}`;
  const kdsUrl = `${base}${kdsPath}?token=${data.token}`;
  const packingUrl = `${base}/packing?token=${data.token}`;
  const displayUrl = `${base}/display?token=${data.token}`;

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <h1 className="text-lg font-bold mb-1" style={{ color: "var(--pos-text)" }}>Kiosk Devices</h1>
      <p className="text-sm mb-5" style={{ color: "var(--pos-muted)" }}>
        Set up a Kanda Display tablet by pasting one of these links into it — no staff PIN needed, and it stays signed in.
      </p>

      <UnlockedTillsCard />

      <div data-testid="kiosk-devices-card" className="rounded-xl" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--pos-border)" }}>
          <span className="text-sm font-semibold" style={{ color: "var(--pos-text)" }}>Kiosk tablet tokens</span>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button data-testid="kiosk-rotate" disabled={busy}
                className="pos-btn h-8 px-2.5 rounded-md text-[11px] font-bold flex items-center gap-1.5"
                style={{ background: "var(--pos-panel-2)", color: "#fca5a5", border: "1px solid #7d2e2e" }}>
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />} Rotate
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Rotate the kiosk token?</AlertDialogTitle>
                <AlertDialogDescription>
                  Any Kitchen Display, Packing Station, or Customer Display tablet using the old link will need to be set up again with the new one.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction data-testid="kiosk-rotate-confirm" onClick={rotate}>Rotate</AlertDialogAction>
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
                  <button key={s} data-testid={`kiosk-station-pick-${s}`} type="button" onClick={() => setStation(s)}
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
              <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--pos-muted)" }}>Tablet link</div>
              <TokenUrlRow testid="kiosk-kds-url" url={kdsUrl} />
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold" style={{ color: "var(--pos-text)" }}><Package className="w-3.5 h-3.5" style={{ color: "var(--pos-accent)" }} /> Packing Station</div>
            <label className="block">
              <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--pos-muted)" }}>Tablet link</div>
              <TokenUrlRow testid="kiosk-packing-url" url={packingUrl} />
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold" style={{ color: "var(--pos-text)" }}><Monitor className="w-3.5 h-3.5" style={{ color: "var(--pos-accent)" }} /> Customer Display (order status)</div>
            <label className="block">
              <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--pos-muted)" }}>Tablet link</div>
              <TokenUrlRow testid="kiosk-display-url" url={displayUrl} />
            </label>
          </div>

          <p className="text-[11px]" style={{ color: "var(--pos-muted)" }}>
            Open the matching link on each tablet (or paste it into the Kanda Display app's setup screen) to keep it permanently signed in. All three share one token, so rotating it updates every screen at once.
          </p>
        </div>
      </div>
    </div>
  );
}
