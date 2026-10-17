import React, { useEffect, useMemo, useState } from "react";
import { Search, PackageX } from "lucide-react";
import { toast } from "sonner";
import { useDash, canEditMenu } from "../../store/DashContext";
import { Switch } from "../ui/switch";
import EmptyState from "../ui/empty-state";

// One-tap "86" list: switch a menu item off when the kitchen runs out and
// back on when it's restocked, without opening the full menu editor. Uses the
// same availability endpoint the POS menu screen does, so the till, QR menu
// and website stop selling the item immediately.

export default function DashStock() {
  const { api, user } = useDash();
  const [items, setItems] = useState(null);
  const [cats, setCats] = useState([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [offOnly, setOffOnly] = useState(false);
  const [saving, setSaving] = useState({});
  const canEdit = canEditMenu(user);

  useEffect(() => {
    Promise.all([api.get("/menu/items"), api.get("/menu/categories")])
      .then(([i, c]) => { setItems(i.data || []); setCats(c.data || []); })
      .catch((e) => setError(e?.response?.data?.detail || "Could not load the menu"));
  }, [api]);

  // Optimistic: flip the switch now, roll back if the server refuses.
  const toggle = async (item, available) => {
    setSaving((s) => ({ ...s, [item.id]: true }));
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, available } : i)));
    try {
      await api.patch(`/menu/items/${item.id}/availability`, { available });
      toast.success(`${item.name} ${available ? "back on sale" : "marked out of stock"}`);
    } catch (e) {
      setItems((list) => list.map((i) => (i.id === item.id ? { ...i, available: !available } : i)));
      toast.error(e?.response?.data?.detail || `Could not update ${item.name}`);
    } finally {
      setSaving((s) => { const n = { ...s }; delete n[item.id]; return n; });
    }
  };

  const offCount = (items || []).filter((i) => !i.available).length;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = (items || []).filter((i) => (!offOnly || !i.available) && (!q || i.name.toLowerCase().includes(q)));
    const order = [...cats].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const byCat = order.map((c) => ({ id: c.id, name: c.name, color: c.color, items: shown.filter((i) => i.catId === c.id) }));
    const known = new Set(cats.map((c) => c.id));
    const orphans = shown.filter((i) => !known.has(i.catId));
    if (orphans.length) byCat.push({ id: "_other", name: "Other", color: "#93805f", items: orphans });
    return byCat.filter((g) => g.items.length);
  }, [items, cats, query, offOnly]);

  return (
    <div className="p-4 space-y-3" data-testid="dash-stock">
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--pos-text)" }}>Item stock</h1>
        <p className="text-xs" style={{ color: "var(--pos-muted)" }}>
          {items ? <>{offCount > 0 ? <span style={{ color: "#d97706" }}>{offCount} out of stock</span> : "Everything is on sale"} · {items.length} items</> : "Loading…"}
          {!canEdit && " · View only (ask the owner for menu access)"}
        </p>
      </div>

      <div className="lg-card rounded-2xl flex items-center gap-2 px-3 h-11">
        <Search className="w-4 h-4 shrink-0" style={{ color: "var(--pos-muted)" }} />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search items"
          data-testid="stock-search" className="flex-1 min-w-0 bg-transparent outline-none text-sm" style={{ color: "var(--pos-text)" }} />
      </div>

      <div className="lg-card rounded-full p-1 grid grid-cols-2 text-sm font-semibold" role="tablist">
        {[[false, "All items"], [true, `Out of stock (${offCount})`]].map(([k, label]) => (
          <button key={String(k)} type="button" role="tab" aria-selected={offOnly === k} data-testid={`stock-view-${k ? "off" : "all"}`} onClick={() => setOffOnly(k)}
            className="h-9 rounded-full" style={{ background: offOnly === k ? "var(--pos-accent)" : "transparent", color: offOnly === k ? "#fff" : "var(--pos-muted)" }}>
            {label}
          </button>
        ))}
      </div>

      {error && <div className="text-sm rounded-xl p-3" style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626" }}>{error}</div>}

      {items && groups.length === 0 && !error && (
        <EmptyState testid="stock-empty" icon={PackageX}
          title={offOnly ? "Nothing is out of stock" : "No items match"}
          description={offOnly ? "Every item is on sale right now." : "Try a different search."} />
      )}

      {groups.map((g) => (
        <div key={g.id} className="lg-card rounded-2xl overflow-hidden">
          <div className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: "var(--pos-muted)" }}>
            <span className="w-2 h-2 rounded-full" style={{ background: g.color || "var(--pos-accent)" }} /> {g.name}
          </div>
          {g.items.map((i, idx) => (
            <div key={i.id} data-testid={`stock-item-${i.id}`} className="flex items-center gap-3 px-4 py-2.5"
              style={{ borderTop: idx ? "1px solid var(--pos-border)" : "none" }}>
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate" style={{ color: i.available ? "var(--pos-text)" : "var(--pos-muted)", textDecoration: i.available ? "none" : "line-through" }}>{i.name}</div>
                {!i.available && <div className="text-[11px] font-semibold" style={{ color: "#d97706" }}>Out of stock</div>}
              </div>
              <Switch checked={!!i.available} disabled={!canEdit || !!saving[i.id]} onCheckedChange={(v) => toggle(i, v)}
                aria-label={`${i.name} on sale`} data-testid={`stock-toggle-${i.id}`} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
