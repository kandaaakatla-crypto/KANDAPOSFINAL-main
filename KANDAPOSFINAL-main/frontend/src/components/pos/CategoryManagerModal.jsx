import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "../ui/alert-dialog";
import { Input } from "../ui/input";
import { LayoutGrid, Plus, Trash2, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { menuApi } from "../../api/client";

const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4", "#ec4899", "#84cc16"];
const STATIONS = ["", "kitchen", "pizza", "grill", "drinks", "desserts"];

/** Manager-only menu category manager: add / rename / recolor / delete / reorder. */
export default function CategoryManagerModal({ open, onClose, onChanged }) {
  const [cats, setCats] = useState([]);
  const [busy, setBusy] = useState(false);
  // null = the "add" row is closed; a string (even empty) = it is open.
  const [newName, setNewName] = useState(null);

  const load = () => menuApi.categories().then(setCats).catch(() => {});
  useEffect(() => { if (open) load(); }, [open]);

  const patch = (id, changes) => setCats((cs) => cs.map((c) => (c.id === id ? { ...c, ...changes } : c)));

  const save = async (c) => {
    try {
      const payload = { name: c.name, color: c.color, station: c.station || null };
      if (c.tax_rate !== "" && c.tax_rate != null) payload.tax_rate = parseFloat(c.tax_rate);
      await menuApi.updateCategory(c.id, payload);
      toast.success("Category saved");
      load();
      onChanged && onChanged();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not save"); }
  };

  const remove = async (c) => {
    try {
      await menuApi.removeCategory(c.id);
      toast.success("Category removed");
      load();
      onChanged && onChanged();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not delete"); }
  };

  const add = async () => {
    const name = (newName || "").trim();
    if (!name) { toast.error("Enter a category name"); return; }
    setBusy(true);
    try {
      await menuApi.createCategory({ name, color: COLORS[cats.length % COLORS.length], sort_order: (cats.length + 1) * 10 });
      toast.success("Category added");
      setNewName(null);
      load();
      onChanged && onChanged();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not add"); }
    finally { setBusy(false); }
  };

  const move = async (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= cats.length) return;
    const next = cats.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    setCats(next);
    await menuApi.reorderCategories(next.map((c) => c.id));
    onChanged && onChanged();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} data-testid="category-manager-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: "var(--pos-text)" }}><LayoutGrid className="w-4 h-4" /> Manage categories</DialogTitle>
        </DialogHeader>
        <p className="text-[11px] -mt-2" style={{ color: "var(--pos-muted)" }}>
          The last field is each category's GST %, auto-suggested for you — leave a row blank to keep it auto-resolved, or type a number to override. Confirm the correct rate for your products with your CA.
        </p>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {cats.map((c, i) => (
            <div key={c.id} data-testid={`category-row-${c.id}`} className="flex items-center gap-2 rounded-md p-2"
              style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
              <div className="flex flex-col gap-0.5">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="text-[10px] opacity-70 disabled:opacity-30">▲</button>
                <button onClick={() => move(i, +1)} disabled={i === cats.length - 1} className="text-[10px] opacity-70 disabled:opacity-30">▼</button>
              </div>
              <input type="color" value={c.color} onChange={(e) => patch(c.id, { color: e.target.value })}
                className="w-8 h-8 rounded cursor-pointer" style={{ background: "transparent", border: "1px solid var(--pos-border)" }} />
              <Input data-testid={`category-name-${c.id}`} value={c.name} onChange={(e) => patch(c.id, { name: e.target.value })}
                className="flex-1 h-9" style={{ background: "var(--pos-bg)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
              <select data-testid={`category-station-${c.id}`} value={c.station || ""} onChange={(e) => patch(c.id, { station: e.target.value || null })}
                className="h-9 px-2 rounded text-xs" style={{ background: "var(--pos-bg)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
                {STATIONS.map((s) => <option key={s || "auto"} value={s}>{s || "auto-route"}</option>)}
              </select>
              <Input data-testid={`category-tax-${c.id}`} type="number" placeholder="Auto" title="GST % for items in this category (blank = auto-resolved per item)"
                value={c.tax_rate ?? ""} onChange={(e) => patch(c.id, { tax_rate: e.target.value })}
                className="w-16 h-9 text-xs" style={{ background: "var(--pos-bg)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
              <button data-testid={`category-save-${c.id}`} onClick={() => save(c)} className="pos-btn h-9 w-9 rounded-md flex items-center justify-center"
                style={{ background: "var(--pos-accent)", color: "#fff" }}>
                <Save className="w-3.5 h-3.5" />
              </button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button data-testid={`category-delete-${c.id}`} className="pos-btn h-9 w-9 rounded-md flex items-center justify-center"
                    style={{ background: "var(--pos-panel)", color: "#fca5a5", border: "1px solid #7d2e2e" }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete category?</AlertDialogTitle>
                    <AlertDialogDescription>Delete category "{c.name}"?</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction data-testid={`category-delete-confirm-${c.id}`} onClick={() => remove(c)}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>
        {newName === null ? (
          <button data-testid="category-add" onClick={() => setNewName("")}
            className="pos-btn w-full h-10 rounded-md text-xs font-bold flex items-center justify-center gap-1.5 text-white"
            style={{ background: "var(--pos-accent)" }}>
            <Plus className="w-3.5 h-3.5" /> Add category
          </button>
        ) : (
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <Input data-testid="category-new-name" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
              aria-label="New category name" placeholder="New category name"
              className="flex-1 h-10" style={{ background: "var(--pos-bg)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
            <button type="button" onClick={() => setNewName(null)} disabled={busy}
              className="pos-btn h-10 px-3 rounded-md text-xs font-bold"
              style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)", border: "1px solid var(--pos-border)" }}>
              Cancel
            </button>
            <button data-testid="category-add" type="submit" disabled={busy}
              className="pos-btn h-10 px-4 rounded-md text-xs font-bold flex items-center justify-center gap-1.5 text-white"
              style={{ background: "var(--pos-accent)" }}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
