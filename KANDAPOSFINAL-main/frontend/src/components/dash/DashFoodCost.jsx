import React, { useEffect, useState } from "react";
import { Trash2, ChefHat } from "lucide-react";
import { useDash } from "../../store/DashContext";

// Waste and food cost for the owner's phone (reports.report_food_cost): what
// was thrown away in rupees, and what the food on sold dishes cost against
// what it sold for. Logging waste stays on the POS inventory screen.

const inr = (n) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;
const qty = (n) => (Number.isInteger(n) ? n : n.toFixed(2).replace(/0+$/, ""));

export default function DashFoodCost() {
  const { api } = useDash();
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancel = false;
    setData(null);
    setError("");
    api.get("/reports/food-cost", { params: { days } })
      .then((r) => { if (!cancel) setData(r.data); })
      .catch((e) => { if (!cancel) setError(typeof e?.response?.data?.detail === "string" ? e.response.data.detail : "Could not load waste and food cost"); });
    return () => { cancel = true; };
  }, [api, days]);

  const food = data?.food;
  const waste = data?.waste;

  return (
    <div className="p-4 space-y-3" data-testid="dash-food-cost">
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--pos-text)" }}>Waste & food cost</h1>
        <p className="text-xs" style={{ color: "var(--pos-muted)" }}>Last {days} days</p>
      </div>
      <div className="flex gap-2">
        {[7, 30].map((d) => (
          <button key={d} type="button" onClick={() => setDays(d)} data-testid={`food-days-${d}`}
            className="lg-press h-8 px-3 rounded-full text-xs font-semibold"
            style={days === d ? { background: "var(--pos-accent)", color: "#fff" } : { background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>
            {d} days
          </button>
        ))}
      </div>

      {error && <div className="text-sm rounded-xl p-3" style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626" }}>{error}</div>}
      {!data && !error && <div className="text-sm" style={{ color: "var(--pos-muted)" }}>Loading…</div>}

      {data && (
        <>
          <div className="lg-card rounded-2xl p-4" data-testid="food-cost-card">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: "var(--pos-muted)" }}>
              <ChefHat className="w-3.5 h-3.5" /> Food cost
            </div>
            {food.pct == null ? (
              <p className="text-sm mt-2" style={{ color: "var(--pos-text)" }} data-testid="food-cost-none">
                No dishes with a recipe cost sold yet. Add recipes on the POS to see food cost.
              </p>
            ) : (
              <>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-[34px] font-bold tabular-nums" style={{ color: "var(--pos-text)" }} data-testid="food-cost-pct">{food.pct}%</span>
                  <span className="text-xs" style={{ color: "var(--pos-muted)" }}>{inr(food.cost)} of food on {inr(food.revenue)} sold</span>
                </div>
                {food.coveragePct < 100 && (
                  <p className="text-[11px] mt-1" style={{ color: "var(--pos-muted)" }}>
                    Based on dishes with a recipe cost: {food.coveragePct}% of item sales.
                  </p>
                )}
              </>
            )}
          </div>

          <div className="lg-card rounded-2xl p-4" data-testid="waste-card">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: "var(--pos-muted)" }}>
              <Trash2 className="w-3.5 h-3.5" /> Waste
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-[34px] font-bold tabular-nums" style={{ color: waste.value ? "#dc2626" : "var(--pos-text)" }} data-testid="waste-value">{inr(waste.value)}</span>
              <span className="text-xs" style={{ color: "var(--pos-muted)" }}>{waste.entries} {waste.entries === 1 ? "entry" : "entries"} logged</span>
            </div>
            {waste.byReason.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {waste.byReason.map((r) => (
                  <span key={r.reason} className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)" }}>
                    {r.reason} · {inr(r.value)}
                  </span>
                ))}
              </div>
            )}
            {waste.byItem.length > 0 ? (
              <div className="mt-3 space-y-2">
                {waste.byItem.map((w) => (
                  <div key={w.name} className="flex items-center text-sm gap-2">
                    <span className="flex-1 min-w-0 truncate" style={{ color: "var(--pos-text)" }}>{w.name}</span>
                    <span className="text-[11px]" style={{ color: "var(--pos-muted)" }}>{qty(w.qty)} {w.unit}</span>
                    <span className="w-20 text-right font-semibold tabular-nums" style={{ color: "var(--pos-text)" }}>{inr(w.value)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs mt-2" style={{ color: "var(--pos-muted)" }}>Nothing logged. Staff log waste from Inventory on the POS.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
