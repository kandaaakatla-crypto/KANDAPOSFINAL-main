import React, { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { kdsApi } from "../../api/kdsClient";
import { ChefHat, CheckCircle2, Pizza } from "lucide-react";

/** Public, no-auth customer-facing screen — put it on a TV behind the counter.
 *  /display?token=<kds_token>  (same long-lived kiosk token as the KDS tablet)
 */
export default function CustomerDisplayScreen() {
  const [search] = useSearchParams();
  const token = search.get("token") || "";
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!token) { setError("Missing ?token= in the URL"); return; }
    try {
      const d = await kdsApi.display(token);
      setData(d);
      setError("");
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not load orders");
    }
  }, [token]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const preparing = (data?.orders || []).filter((o) => o.status === "preparing");
  const ready = (data?.orders || []).filter((o) => o.status === "ready");

  const OrderChip = ({ o }) => (
    <div data-testid={`display-order-${o.number}`} className="rounded-2xl px-6 py-4 text-center" style={{ background: "var(--pos-panel)", border: "2px solid var(--pos-border)" }}>
      <div className="text-4xl font-black text-white tabular-nums">#{o.number}</div>
      {o.table != null ? (
        <div className="text-sm mt-1 uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Table {o.table}</div>
      ) : (
        <div className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>{o.name || "Collection"}</div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen p-8" style={{ background: "var(--pos-bg)" }} data-testid="customer-display-screen">
      <div className="flex items-center justify-center gap-3 mb-10">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: "var(--pos-accent)" }}>
          <Pizza className="w-6 h-6 text-white" />
        </div>
        <div>
          <div className="text-2xl font-bold text-white tracking-tight">{data?.tenant?.name || "Kanda POS"}</div>
          <div className="text-xs uppercase tracking-[0.3em]" style={{ color: "var(--pos-muted)" }}>Order status</div>
        </div>
      </div>

      {error && (
        <div className="max-w-md mx-auto text-center text-sm p-4 rounded-xl" style={{ background: "rgba(220,38,38,0.15)", color: "#fca5a5" }}>{error}</div>
      )}

      {!error && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 max-w-5xl mx-auto">
          <div>
            <div className="flex items-center gap-2 justify-center mb-5">
              <ChefHat className="w-6 h-6" style={{ color: "#fcd34d" }} />
              <h2 className="text-xl font-bold uppercase tracking-wider" style={{ color: "#fcd34d" }}>Preparing</h2>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {preparing.length === 0 && <div className="col-span-2 text-center text-sm py-10" style={{ color: "var(--pos-muted)" }}>No orders in progress.</div>}
              {preparing.map((o) => <OrderChip key={o.number} o={o} />)}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 justify-center mb-5">
              <CheckCircle2 className="w-6 h-6" style={{ color: "#22c55e" }} />
              <h2 className="text-xl font-bold uppercase tracking-wider" style={{ color: "#22c55e" }}>Ready to Collect</h2>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {ready.length === 0 && <div className="col-span-2 text-center text-sm py-10" style={{ color: "var(--pos-muted)" }}>Nothing ready yet.</div>}
              {ready.map((o) => <OrderChip key={o.number} o={o} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
