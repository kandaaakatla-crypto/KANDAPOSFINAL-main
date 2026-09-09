import React, { useEffect, useState } from "react";
import { reportsApi } from "../../api/client";
import { Star, Rabbit, Puzzle, Dog, HelpCircle } from "lucide-react";

const RANGE_OPTIONS = [7, 14, 30, 90];

const QUADRANTS = [
  { key: "star", label: "Stars", hint: "Popular & profitable — protect these, feature them", icon: Star, color: "#fcd34d" },
  { key: "plowhorse", label: "Plowhorses", hint: "Popular but low margin — try a small price increase or cheaper recipe", icon: Rabbit, color: "#7dd3fc" },
  { key: "puzzle", label: "Puzzles", hint: "Profitable but rarely ordered — reposition on the menu or promote", icon: Puzzle, color: "#c4b5fd" },
  { key: "dog", label: "Dogs", hint: "Neither popular nor profitable — candidates to cut", icon: Dog, color: "#fca5a5" },
  { key: "unknown", label: "No recipe costed", hint: "Add a recipe (Menu → Recipe) to classify these", icon: HelpCircle, color: "var(--pos-muted)" },
];

export default function MenuEngineeringTab() {
  const [range, setRange] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    reportsApi.menuEngineering(range).then((r) => { if (!cancel) setData(r); }).catch(() => {}).finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [range]);

  const items = data?.items || [];
  const byQuadrant = QUADRANTS.map((q) => ({ ...q, items: items.filter((it) => it.quadrant === q.key) }));

  return (
    <div className="space-y-4" data-testid="menu-engineering-tab">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-xs max-w-lg" style={{ color: "var(--pos-muted)" }}>
          Classic menu-engineering matrix — popularity vs. margin (selling price minus recipe cost), using the 70% popularity rule.
          {data?.avg_margin != null && <> Average margin across costed items: <span className="font-semibold" style={{ color: "var(--pos-text)" }}>₹{data.avg_margin.toFixed(2)}</span>.</>}
        </p>
        <div className="flex gap-1">
          {RANGE_OPTIONS.map((r) => (
            <button key={r} data-testid={`menu-eng-range-${r}d`} onClick={() => setRange(r)}
              className="pos-btn h-8 px-2.5 rounded-md text-[11px] font-bold"
              style={{ background: range === r ? "var(--pos-accent)" : "var(--pos-panel-2)", color: range === r ? "#fff" : "var(--pos-muted)" }}>
              {r}d
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="text-sm py-8 text-center" style={{ color: "var(--pos-muted)" }}>Loading…</div>}

      {!loading && items.length === 0 && (
        <div className="text-sm py-8 text-center rounded-xl" style={{ color: "var(--pos-muted)", background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          No sales in the last {range} days.
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {byQuadrant.map((q) => (
            <div key={q.key} data-testid={`quadrant-${q.key}`} className="rounded-xl p-4" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
              <div className="flex items-center gap-2 mb-1">
                <q.icon className="w-4 h-4" style={{ color: q.color }} />
                <div className="font-semibold" style={{ color: "var(--pos-text)" }}>{q.label}</div>
                <span className="text-xs tabular-nums ml-auto" style={{ color: "var(--pos-muted)" }}>{q.items.length}</span>
              </div>
              <div className="text-[11px] mb-3" style={{ color: "var(--pos-muted)" }}>{q.hint}</div>
              {q.items.length === 0 ? (
                <div className="text-xs py-3 text-center" style={{ color: "var(--pos-muted)" }}>—</div>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto pos-scroll">
                  {q.items.map((it) => (
                    <div key={it.name} data-testid={`menu-eng-item-${it.name}`} className="flex items-center justify-between gap-2 rounded-md px-2.5 py-2" style={{ background: "var(--pos-panel-2)" }}>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate" style={{ color: "var(--pos-text)" }}>{it.name}</div>
                        <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>
                          {it.qty_sold} sold · ₹{it.revenue.toFixed(0)} revenue
                          {it.has_recipe && <> · margin ₹{it.margin.toFixed(2)}</>}
                        </div>
                      </div>
                      {it.has_recipe ? (
                        <span className="text-xs font-bold tabular-nums shrink-0" style={{ color: it.margin >= 0 ? "#86efac" : "#fca5a5" }}>
                          ₹{it.avg_price.toFixed(0)} <span style={{ color: "var(--pos-muted)", fontWeight: 400 }}>−₹{it.cost.toFixed(0)}</span>
                        </span>
                      ) : (
                        <span className="text-[10px] shrink-0" style={{ color: "var(--pos-muted)" }}>no recipe</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
