import React, { useEffect, useMemo, useState } from "react";
import { Flame } from "lucide-react";
import { useDash } from "../../store/DashContext";
import EmptyState from "../ui/empty-state";

// Item performance for the owner's phone: what sells, what doesn't, and what
// earns. Reads the existing menu-engineering report (reports.menu_engineering),
// which already skips voided orders and works out margin from recipe costs.

const inr = (n) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

// Plain-words versions of the menu-engineering quadrants.
const QUADRANT = {
  star: { label: "Star", hint: "Sells well, good margin", color: "#16a34a" },
  plowhorse: { label: "Crowd pleaser", hint: "Sells well, thin margin", color: "#2563eb" },
  puzzle: { label: "Hidden gem", hint: "Good margin, slow seller", color: "#9333ea" },
  dog: { label: "Review", hint: "Slow seller, thin margin", color: "#dc2626" },
};

const SORTS = [
  { key: "top", label: "Top sellers", by: (a, b) => b.revenue - a.revenue },
  { key: "slow", label: "Slow movers", by: (a, b) => a.qty_sold - b.qty_sold || a.revenue - b.revenue },
  { key: "margin", label: "Best margin", by: (a, b) => (b.margin ?? -Infinity) - (a.margin ?? -Infinity) || b.revenue - a.revenue },
];

export default function DashItems() {
  const { api } = useDash();
  const [days, setDays] = useState(7);
  const [sort, setSort] = useState("top");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancel = false;
    setData(null);
    setError("");
    api.get("/reports/menu-engineering", { params: { days } })
      .then((r) => { if (!cancel) setData(r.data); })
      .catch((e) => { if (!cancel) setError(e?.response?.data?.detail || "Could not load item sales"); });
    return () => { cancel = true; };
  }, [api, days]);

  const items = useMemo(() => {
    const list = [...(data?.items || [])];
    return list.sort(SORTS.find((s) => s.key === sort).by);
  }, [data, sort]);
  const total = items.reduce((s, i) => s + i.revenue, 0);
  const costed = items.filter((i) => i.has_recipe).length;

  return (
    <div className="p-4 space-y-3" data-testid="dash-items">
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--pos-text)" }}>Item performance</h1>
        <p className="text-xs" style={{ color: "var(--pos-muted)" }}>
          {data ? `${items.length} items sold · ${inr(total)} in the last ${days} days` : "Loading…"}
        </p>
      </div>

      <div className="flex gap-2">
        {[7, 30].map((d) => (
          <button key={d} type="button" onClick={() => setDays(d)} data-testid={`items-days-${d}`}
            className="lg-press h-8 px-3 rounded-full text-xs font-semibold"
            style={days === d ? { background: "var(--pos-accent)", color: "#fff" } : { background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>
            {d} days
          </button>
        ))}
      </div>
      <div className="flex gap-2 overflow-x-auto -mx-4 px-4">
        {SORTS.map((s) => (
          <button key={s.key} type="button" onClick={() => setSort(s.key)} data-testid={`items-sort-${s.key}`}
            className="lg-press h-8 px-3 rounded-full text-xs font-semibold shrink-0"
            style={sort === s.key ? { background: "var(--pos-text)", color: "var(--pos-bg, #fff)" } : { background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>
            {s.label}
          </button>
        ))}
      </div>

      {error && <div className="text-sm rounded-xl p-3" style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626" }}>{error}</div>}

      {data && items.length === 0 && !error ? (
        <EmptyState testid="items-empty" icon={Flame} title="No sales yet" description={`Nothing sold in the last ${days} days.`} />
      ) : (
        <div className="space-y-2">
          {items.map((it, i) => {
            const q = QUADRANT[it.quadrant];
            const share = total ? Math.round((it.revenue / total) * 100) : 0;
            return (
              <div key={it.name} className="lg-card rounded-2xl p-3" data-testid={`item-row-${i}`}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate" style={{ color: "var(--pos-text)" }}>{it.name}</div>
                    <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>
                      {it.qty_sold} sold · {share}% of sales{it.margin != null ? ` · ${inr(it.margin)} margin each` : ""}
                    </div>
                  </div>
                  <div className="text-sm font-bold tabular-nums shrink-0" style={{ color: "var(--pos-text)" }}>{inr(it.revenue)}</div>
                </div>
                {q && (
                  <div className="mt-1.5 text-[11px] font-semibold" style={{ color: q.color }}>
                    {q.label} <span className="font-normal" style={{ color: "var(--pos-muted)" }}>· {q.hint}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {data && items.length > 0 && costed < items.length && (
        <p className="text-[11px] text-center" style={{ color: "var(--pos-muted)" }}>
          Margin shows for items with a recipe cost ({costed} of {items.length}). Add recipes on the POS to see the rest.
        </p>
      )}
    </div>
  );
}
