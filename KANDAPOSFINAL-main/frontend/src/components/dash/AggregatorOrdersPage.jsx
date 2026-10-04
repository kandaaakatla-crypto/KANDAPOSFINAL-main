import React, { useEffect, useState } from "react";
import { Bike, KeyRound, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../api/client";
import { CopyRow } from "./WebsiteOrdersPage";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "../ui/alert-dialog";

// Swiggy / Zomato orders via UrbanPiper. The store pastes the webhook URL and
// key into its UrbanPiper order webhook settings; orders then land on the POS
// order board and KDS. Same per-store, shown-once, hashed key as Website
// Orders (see backend routes/urbanpiper.py).
export default function AggregatorOrdersPage() {
  const [data, setData] = useState(null);
  const [freshKey, setFreshKey] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get("/integrations/urbanpiper").then((r) => setData(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const generate = async () => {
    setBusy(true);
    try {
      const r = await api.post("/integrations/urbanpiper/key");
      setFreshKey(r.data.key);
      toast.success("UrbanPiper key created");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not create key");
    } finally { setBusy(false); }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      await api.delete("/integrations/urbanpiper/key");
      setFreshKey(null);
      toast.success("Swiggy & Zomato orders turned off");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not turn off");
    } finally { setBusy(false); }
  };

  if (!data) return null;
  const muted = { color: "var(--pos-muted)" };
  const smallBtn = "pos-btn h-8 px-2.5 rounded-md text-[11px] font-bold flex items-center gap-1.5";

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <h1 className="text-lg font-bold mb-1" style={{ color: "var(--pos-text)" }}>Swiggy &amp; Zomato</h1>
      <p className="text-sm mb-5" style={muted}>
        Connect your UrbanPiper account so Swiggy, Zomato and other aggregator orders appear on the POS and kitchen display.
      </p>

      <div data-testid="aggregator-orders-card" className="rounded-xl" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--pos-border)" }}>
          <span className="text-sm font-semibold flex items-center gap-1.5" style={{ color: "var(--pos-text)" }}>
            <Bike className="w-4 h-4" style={{ color: "var(--pos-accent)" }} />
            {data.enabled ? `Connected · key ending ${data.keyHint}` : "Not connected"}
          </span>
          <div className="flex gap-2">
            {data.enabled ? (
              <>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button data-testid="urbanpiper-key-rotate" disabled={busy} className={smallBtn}
                      style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)", border: "1px solid var(--pos-border)" }}>
                      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />} New key
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Replace the UrbanPiper key?</AlertDialogTitle>
                      <AlertDialogDescription>The current key stops working immediately. Update the webhook header in UrbanPiper with the new one.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction data-testid="urbanpiper-key-rotate-confirm" onClick={generate}>Replace</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button data-testid="urbanpiper-key-revoke" disabled={busy} className={smallBtn}
                      style={{ background: "var(--pos-panel-2)", color: "#fca5a5", border: "1px solid #7d2e2e" }}>
                      <Trash2 className="w-3 h-3" /> Turn off
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Stop accepting Swiggy &amp; Zomato orders?</AlertDialogTitle>
                      <AlertDialogDescription>Orders UrbanPiper sends after this will be rejected until you create a new key.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction data-testid="urbanpiper-key-revoke-confirm" onClick={revoke}>Turn off</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            ) : (
              <button data-testid="urbanpiper-key-create" disabled={busy} onClick={generate}
                className="pos-btn h-8 px-3 rounded-md text-[11px] font-bold flex items-center gap-1.5 text-white"
                style={{ background: "var(--pos-accent)" }}>
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />} Connect UrbanPiper
              </button>
            )}
          </div>
        </div>

        <div className="p-4 space-y-4">
          {freshKey && (
            <label className="block">
              <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "#fbbf24" }}>
                Your key, shown only once. Paste it into UrbanPiper now.
              </div>
              <CopyRow testid="urbanpiper-key-value" value={freshKey} />
            </label>
          )}
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider mb-1.5" style={muted}>Order webhook URL</div>
            <CopyRow testid="urbanpiper-webhook-url" value={data.webhookUrl} />
          </label>
          <p className="text-[11px]" style={muted}>
            In UrbanPiper, set this URL as the store's order webhook and add a <code>{data.header}</code> header with your key.
            Each item's merchant ID in UrbanPiper should be the POS menu item ID, so orders go to the right kitchen station and use your GST rates.
            Orders keep the price the customer paid on the app; anything that doesn't match a POS item still comes through, flagged for review.
            {data.lastOrderAt && <> Last order received {new Date(data.lastOrderAt).toLocaleString()}.</>}
          </p>
        </div>
      </div>
    </div>
  );
}
