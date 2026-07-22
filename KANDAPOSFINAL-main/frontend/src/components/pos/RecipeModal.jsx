import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { ChefHat, Plus, Trash2, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { usePos } from "../../store/PosContext";
import { menuApi } from "../../api/client";

/** Per-menu-item recipe editor. Supports either a single recipe (non-sized items)
 *  or one recipe per size (sm/md/lg) for pizzas + other sized items. */
export default function RecipeModal({ item, open, onClose }) {
  const { inventory } = usePos();
  const [activeSize, setActiveSize] = useState("default");
  const [recipes, setRecipes] = useState({}); // { size_key: [{inventory_id, qty}] }
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState("");

  const sizes = item?.isPizza ? ["sm", "md", "lg"] : [null];
  const sizeLabels = { sm: "Small", md: "Medium", lg: "Large", default: "Recipe" };

  useEffect(() => {
    if (!open || !item) return;
    setActiveSize(item.isPizza ? "sm" : "default");
    setBusy(true);
    menuApi.listRecipes(item.id)
      .then((rs) => {
        const next = {};
        for (const r of rs) {
          const key = r.size || "default";
          next[key] = r.ingredients || [];
        }
        setRecipes(next);
      })
      .catch(() => toast.error("Could not load recipes"))
      .finally(() => setBusy(false));
  }, [open, item]);

  if (!item) return null;
  const key = item.isPizza ? activeSize : "default";
  const list = recipes[key] || [];

  const addIngredient = () => {
    if (!picker) return;
    if (list.find((l) => l.inventory_id === picker)) {
      toast.warning("Already in recipe — edit qty instead");
      return;
    }
    setRecipes({ ...recipes, [key]: [...list, { inventory_id: picker, qty: 1 }] });
    setPicker("");
  };

  const updateQty = (idx, qty) => {
    const next = list.slice();
    next[idx] = { ...next[idx], qty: Number(qty) || 0 };
    setRecipes({ ...recipes, [key]: next });
  };

  const removeIngredient = (idx) => {
    setRecipes({ ...recipes, [key]: list.filter((_, i) => i !== idx) });
  };

  const save = async () => {
    setBusy(true);
    try {
      const payload = [];
      for (const s of sizes) {
        const k = s || "default";
        const ings = recipes[k] || [];
        if (ings.length > 0) {
          payload.push({ menu_item_id: item.id, size: s, ingredients: ings });
        }
      }
      await menuApi.saveRecipes(item.id, payload);
      toast.success(`Saved ${payload.length} recipe${payload.length === 1 ? "" : "s"}`);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save");
    } finally { setBusy(false); }
  };

  const invById = Object.fromEntries(inventory.map((i) => [i.id, i]));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} data-testid="recipe-modal">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2"><ChefHat className="w-4 h-4" /> Recipe — {item.name}</DialogTitle>
        </DialogHeader>

        {item.isPizza && (
          <div className="flex gap-1.5">
            {sizes.map((s) => (
              <button key={s} type="button" data-testid={`recipe-size-${s}`} onClick={() => setActiveSize(s)}
                className="pos-btn h-9 px-3 rounded-md text-xs font-bold flex-1"
                style={{
                  background: activeSize === s ? "var(--pos-accent)" : "var(--pos-panel-2)",
                  color: activeSize === s ? "#fff" : "var(--pos-muted)",
                  border: "1px solid var(--pos-border)",
                }}>
                {sizeLabels[s]} ({(recipes[s] || []).length})
              </button>
            ))}
          </div>
        )}

        <div className="space-y-2 max-h-[40vh] overflow-y-auto">
          {busy && list.length === 0 ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--pos-muted)" }}>
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : list.length === 0 ? (
            <div className="text-xs py-4 text-center" style={{ color: "var(--pos-muted)" }}>No ingredients yet. Add one below.</div>
          ) : list.map((ing, idx) => {
            const inv = invById[ing.inventory_id];
            return (
              <div key={idx} data-testid={`recipe-ingredient-${idx}`} className="flex items-center gap-2 rounded-md p-2"
                style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{inv?.name || ing.inventory_id}</div>
                  <div className="text-[10px]" style={{ color: "var(--pos-muted)" }}>
                    {inv ? `stock ${inv.stock}${inv.unit}` : "missing"}
                  </div>
                </div>
                <Input type="number" step="0.1" value={ing.qty} onChange={(e) => updateQty(idx, e.target.value)}
                  className="w-20 h-9 text-white text-right" style={{ background: "var(--pos-bg)", borderColor: "var(--pos-border)" }} />
                <span className="text-[11px] w-8" style={{ color: "var(--pos-muted)" }}>{inv?.unit || ""}</span>
                <button onClick={() => removeIngredient(idx)} className="pos-btn h-8 w-8 rounded-md flex items-center justify-center"
                  style={{ background: "var(--pos-panel)", color: "#fca5a5" }}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 pt-3" style={{ borderTop: "1px solid var(--pos-border)" }}>
          <select data-testid="recipe-ingredient-picker" value={picker} onChange={(e) => setPicker(e.target.value)}
            className="flex-1 h-10 px-3 rounded-md text-sm text-white"
            style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
            <option value="">Add ingredient…</option>
            {inventory.map((i) => (
              <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
            ))}
          </select>
          <button data-testid="recipe-add-ingredient" type="button" onClick={addIngredient} disabled={!picker}
            className="pos-btn h-10 px-3 rounded-md text-xs font-bold flex items-center gap-1 disabled:opacity-40"
            style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>

        <button data-testid="recipe-save" onClick={save} disabled={busy}
          className="pos-btn w-full h-11 rounded-lg font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
          style={{ background: "var(--pos-accent)" }}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save recipe
        </button>
      </DialogContent>
    </Dialog>
  );
}
