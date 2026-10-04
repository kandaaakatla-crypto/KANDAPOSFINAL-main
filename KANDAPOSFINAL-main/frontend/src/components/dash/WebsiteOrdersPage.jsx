import React, { useEffect, useState } from "react";
import { Globe, Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../api/client";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "../ui/alert-dialog";

export function CopyRow({ testid, value }) {
  return (
    <div className="flex gap-2">
      <input data-testid={testid} readOnly value={value} onFocus={(e) => e.target.select()}
        className="flex-1 h-10 px-3 rounded-md text-[11px] font-mono"
        style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
      <button data-testid={`${testid}-copy`} onClick={() => { navigator.clipboard.writeText(value); toast.success("Copied"); }}
        className="pos-btn h-10 px-3 rounded-md text-xs font-bold flex items-center gap-1.5 text-white"
        style={{ background: "var(--pos-accent)" }}>
        <Copy className="w-3.5 h-3.5" /> Copy
      </button>
    </div>
  );
}

const SAMPLE = `{
  "external_id": "WEB-10023",
  "type": "delivery",
  "customer": { "name": "Asha", "phone": "+919800000000", "address": "12 MG Road" },
  "items": [ { "sku": "PANEER-TIKKA", "qty": 2 } ],
  "paid": true,
  "delivery_fee": 40
}`;

// Lets the store's own website push its online orders onto the POS order
// board and KDS. The key is per store, shown once on creation, and only
// ever stored hashed (see backend routes/website_orders.py).
export default function WebsiteOrdersPage() {
  const [data, setData] = useState(null);
  const [freshKey, setFreshKey] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get("/integrations/website").then((r) => setData(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const generate = async () => {
    setBusy(true);
    try {
      const r = await api.post("/integrations/website/key");
      setFreshKey(r.data.key);
      toast.success("Website key created");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not create key");
    } finally { setBusy(false); }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      await api.delete("/integrations/website/key");
      setFreshKey(null);
      toast.success("Website orders turned off");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not turn off");
    } finally { setBusy(false); }
  };

  if (!data) return null;
  const muted = { color: "var(--pos-muted)" };

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <h1 className="text-lg font-bold mb-1" style={{ color: "var(--pos-text)" }}>Website Orders</h1>
      <p className="text-sm mb-5" style={muted}>
        Connect your own online shop so its orders appear on the POS and kitchen display, priced from your menu.
      </p>

      <div data-testid="website-orders-card" className="rounded-xl" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--pos-border)" }}>
          <span className="text-sm font-semibold flex items-center gap-1.5" style={{ color: "var(--pos-text)" }}>
            <Globe className="w-4 h-4" style={{ color: "var(--pos-accent)" }} />
            {data.enabled ? `Connected · key ending ${data.keyHint}` : "Not connected"}
          </span>
          <div className="flex gap-2">
            {data.enabled ? (
              <>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button data-testid="website-key-rotate" disabled={busy}
                      className="pos-btn h-8 px-2.5 rounded-md text-[11px] font-bold flex items-center gap-1.5"
                      style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)", border: "1px solid var(--pos-border)" }}>
                      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />} New key
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Replace the website key?</AlertDialogTitle>
                      <AlertDialogDescription>The current key stops working immediately. Update your website with the new one.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction data-testid="website-key-rotate-confirm" onClick={generate}>Replace</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button data-testid="website-key-revoke" disabled={busy}
                      className="pos-btn h-8 px-2.5 rounded-md text-[11px] font-bold flex items-center gap-1.5"
                      style={{ background: "var(--pos-panel-2)", color: "#fca5a5", border: "1px solid #7d2e2e" }}>
                      <Trash2 className="w-3 h-3" /> Turn off
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Stop accepting website orders?</AlertDialogTitle>
                      <AlertDialogDescription>Orders your website sends after this will be rejected until you create a new key.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction data-testid="website-key-revoke-confirm" onClick={revoke}>Turn off</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            ) : (
              <button data-testid="website-key-create" disabled={busy} onClick={generate}
                className="pos-btn h-8 px-3 rounded-md text-[11px] font-bold flex items-center gap-1.5 text-white"
                style={{ background: "var(--pos-accent)" }}>
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />} Connect website
              </button>
            )}
          </div>
        </div>

        <div className="p-4 space-y-4">
          {freshKey && (
            <label className="block">
              <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "#fbbf24" }}>
                Your key, shown only once. Copy it into your website's server settings now.
              </div>
              <CopyRow testid="website-key-value" value={freshKey} />
            </label>
          )}
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider mb-1.5" style={muted}>Order URL (POST)</div>
            <CopyRow testid="website-ingest-url" value={data.ingestUrl} />
          </label>
          <div>
            <div className="text-[10px] uppercase tracking-wider mb-1.5" style={muted}>Example request</div>
            <pre className="p-3 rounded-md text-[11px] font-mono overflow-x-auto"
              style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
{`${data.header}: wsk_…\n\n${SAMPLE}`}
            </pre>
          </div>
          <p className="text-[11px]" style={muted}>
            Send the key in the <code>{data.header}</code> header from your website's server, never from browser code.
            Each line uses your POS <code>item_id</code> or a <code>sku</code> that matches the item's barcode.
            Prices and GST come from your POS menu. Re-sending the same <code>external_id</code> never creates a duplicate.
            {data.lastOrderAt && <> Last order received {new Date(data.lastOrderAt).toLocaleString()}.</>}
          </p>
        </div>
      </div>
    </div>
  );
}
