import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { useDash } from "../../store/DashContext";
import { centralSupplyApi, brandApi } from "../../api/client";
import { Warehouse, Plus, Loader2, Trash2, Pencil, Send, History, PackagePlus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "../ui/alert-dialog";
import { Input } from "../ui/input";

const EMPTY = { name: "", unit: "", stock: "", cost_per_unit: "", reorder: "" };

/**
 * Restaurant Dashboard → Central Supply. A brand-owned warehouse catalog —
 * separate from any single store's inventory, since each brand store is its
 * own tenant with its own independent inventory collection. Owners stock
 * this catalog, then push quantities out to one or more member stores; a
 * push finds-or-creates the matching item in each target store's own
 * inventory (see routes/central_supply.py for the exact match rule).
 */
export default function DashCentralSupply() {
  const { user } = useDash();
  const brandId = user?.brand_id;
  const [items, setItems] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pushFor, setPushFor] = useState(null); // central item being pushed
  const [pushTenantIds, setPushTenantIds] = useState([]);
  const [pushQty, setPushQty] = useState("");
  const [pushNote, setPushNote] = useState("");
  const [pushBusy, setPushBusy] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [log, setLog] = useState([]);

  const load = () => {
    if (!brandId) { setLoading(false); return; }
    setLoading(true);
    Promise.all([centralSupplyApi.listItems(brandId), brandApi.listStores(brandId)])
      .then(([i, s]) => { setItems(i); setStores(s); })
      .catch(() => toast.error("Could not load central supply"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [brandId]); // eslint-disable-line

  const startNew = () => { setEditingId(null); setForm(EMPTY); };
  const startEdit = (i) => {
    setEditingId(i.id);
    setForm({ name: i.name, unit: i.unit, stock: i.stock, cost_per_unit: i.cost_per_unit || "", reorder: i.reorder || "" });
  };

  const save = async () => {
    if (!form.name.trim() || !form.unit.trim()) { toast.error("Name and unit are required"); return; }
    setSaving(true);
    try {
      if (editingId) {
        await centralSupplyApi.updateItem(brandId, editingId, {
          name: form.name.trim(), unit: form.unit.trim(),
          cost_per_unit: parseFloat(form.cost_per_unit) || 0, reorder: parseFloat(form.reorder) || 0,
        });
        toast.success("Item updated");
      } else {
        await centralSupplyApi.createItem(brandId, {
          name: form.name.trim(), unit: form.unit.trim(), stock: parseFloat(form.stock) || 0,
          cost_per_unit: parseFloat(form.cost_per_unit) || 0, reorder: parseFloat(form.reorder) || 0,
        });
        toast.success("Item added to central catalog");
      }
      startNew();
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save item");
    } finally { setSaving(false); }
  };

  const remove = async (i) => {
    try { await centralSupplyApi.removeItem(brandId, i.id); toast.success("Item removed"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Could not delete item"); }
  };

  const restock = async (i, delta) => {
    try {
      await centralSupplyApi.restock(brandId, i.id, delta);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not restock"); }
  };

  const openPush = (i) => { setPushFor(i); setPushTenantIds([]); setPushQty(""); setPushNote(""); };
  const toggleTarget = (tid) => setPushTenantIds((ids) => (ids.includes(tid) ? ids.filter((x) => x !== tid) : [...ids, tid]));
  const submitPush = async () => {
    const qty = parseFloat(pushQty);
    if (!(qty > 0)) { toast.error("Enter a quantity per store"); return; }
    if (!pushTenantIds.length) { toast.error("Select at least one store"); return; }
    setPushBusy(true);
    try {
      const res = await centralSupplyApi.push(brandId, pushFor.id, { tenant_ids: pushTenantIds, qty_per_store: qty, note: pushNote || null });
      toast.success(`Pushed ${qty} ${pushFor.unit} to ${res.pushed_to} store${res.pushed_to === 1 ? "" : "s"}`);
      setPushFor(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not push stock");
    } finally { setPushBusy(false); }
  };

  const openLog = () => { setLogOpen(true); centralSupplyApi.log(brandId).then(setLog).catch(() => {}); };

  if (!brandId) {
    return (
      <div className="p-6">
        <div className="rounded-xl p-6 text-center" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          <Warehouse className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--pos-muted)" }} />
          <div className="text-white font-semibold">Central supply needs a brand</div>
          <div className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>Set up a brand from the Brand screen first, then come back here to stock a shared warehouse for your stores.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="dash-central-supply">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Warehouse className="w-6 h-6" style={{ color: "#7dd3fc" }} />
            Central Supply
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>
            A brand-owned warehouse — stock it here, then push quantities out to any of your stores. Each push adds to (or creates) the matching item in that store's own inventory.
          </p>
        </div>
        <button data-testid="central-supply-log-btn" onClick={openLog} className="pos-btn h-9 px-3 rounded-md text-xs font-bold flex items-center gap-1.5"
          style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
          <History className="w-3.5 h-3.5" /> Push log
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* List */}
        <div className="lg:col-span-2 rounded-xl overflow-hidden" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--pos-border)" }}>
            <div className="text-sm font-bold text-white">Central catalog</div>
          </div>
          <div className="p-5">
            {loading && <div className="text-sm" style={{ color: "var(--pos-muted)" }}>Loading…</div>}
            {!loading && items.length === 0 && (
              <div className="text-sm text-center py-8" style={{ color: "var(--pos-muted)" }}>No central items yet — add one on the right.</div>
            )}
            <div className="space-y-1.5">
              {items.map((i) => (
                <div key={i.id} data-testid={`central-item-row-${i.id}`} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 flex-wrap"
                  style={{ background: editingId === i.id ? "var(--pos-bg)" : "var(--pos-panel-2)", border: editingId === i.id ? "1px solid var(--pos-accent)" : "1px solid transparent" }}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-bold">{i.name}</span>
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: i.stock <= i.reorder ? "#3a1515" : "var(--pos-panel)", color: i.stock <= i.reorder ? "#f87171" : "var(--pos-muted)" }}>
                        {i.stock} {i.unit} in stock
                      </span>
                      {i.cost_per_unit > 0 && <span className="text-[11px]" style={{ color: "var(--pos-muted)" }}>₹{i.cost_per_unit}/{i.unit}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button data-testid={`central-item-restock-down-${i.id}`} onClick={() => restock(i, -10)} className="pos-btn h-7 w-7 rounded-md flex items-center justify-center" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>−</button>
                    <button data-testid={`central-item-restock-up-${i.id}`} onClick={() => restock(i, 10)} className="pos-btn h-7 w-7 rounded-md flex items-center justify-center" title="Add 10 to central stock" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}><PackagePlus className="w-3.5 h-3.5" style={{ color: "var(--pos-accent)" }} /></button>
                    <button data-testid={`central-item-push-${i.id}`} onClick={() => openPush(i)} disabled={!stores.length} className="pos-btn h-7 px-2.5 rounded-md text-[11px] font-bold flex items-center gap-1 disabled:opacity-40" style={{ background: "var(--pos-accent)", color: "#fff" }}>
                      <Send className="w-3 h-3" /> Push
                    </button>
                    <button data-testid={`central-item-edit-${i.id}`} onClick={() => startEdit(i)} className="pos-btn h-7 w-7 rounded-md flex items-center justify-center" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
                      <Pencil className="w-3.5 h-3.5" style={{ color: "var(--pos-muted)" }} />
                    </button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button data-testid={`central-item-delete-${i.id}`} className="pos-btn w-7 h-7 rounded-md flex items-center justify-center" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete central item?</AlertDialogTitle>
                          <AlertDialogDescription>Delete "{i.name}" from the central catalog?</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction data-testid={`central-item-delete-confirm-${i.id}`} onClick={() => remove(i)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Create / edit */}
        <div className="rounded-xl overflow-hidden h-fit" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--pos-border)" }}>
            <div className="text-sm font-bold text-white">{editingId ? "Edit item" : "New central item"}</div>
            {editingId && <button onClick={startNew} className="text-[11px]" style={{ color: "var(--pos-accent)" }}>+ New instead</button>}
          </div>
          <div className="p-5 space-y-3">
            <Input data-testid="central-form-name" placeholder="Item name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
            <div className="grid grid-cols-2 gap-3">
              <Input data-testid="central-form-unit" placeholder="Unit (kg, pcs…)" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
              {!editingId && (
                <Input data-testid="central-form-stock" type="number" placeholder="Starting stock" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })}
                  className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input data-testid="central-form-cost" type="number" placeholder="Cost/unit (₹)" value={form.cost_per_unit} onChange={(e) => setForm({ ...form, cost_per_unit: e.target.value })}
                className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
              <Input data-testid="central-form-reorder" type="number" placeholder="Reorder level" value={form.reorder} onChange={(e) => setForm({ ...form, reorder: e.target.value })}
                className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
            </div>
            <button data-testid="central-form-save" onClick={save} disabled={saving}
              className="pos-btn w-full mt-1 px-3 py-2 rounded-lg text-xs text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
              style={{ background: "var(--pos-accent)" }}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} {editingId ? "Save changes" : "Add item"}
            </button>
          </div>
        </div>
      </div>

      {/* Push modal */}
      <Dialog open={!!pushFor} onOpenChange={(o) => !o && setPushFor(null)}>
        <DialogContent className="max-w-sm border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} data-testid="push-modal">
          <DialogHeader><DialogTitle className="text-white">Push {pushFor?.name}</DialogTitle></DialogHeader>
          {pushFor && (
            <div className="space-y-3">
              <div className="text-xs" style={{ color: "var(--pos-muted)" }}>{pushFor.stock} {pushFor.unit} available centrally</div>
              <div>
                <label className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Target stores</label>
                <div className="max-h-40 overflow-y-auto pos-scroll space-y-1 rounded p-2 mt-1" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                  {stores.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-xs text-white" data-testid={`push-target-${s.id}`}>
                      <input type="checkbox" checked={pushTenantIds.includes(s.id)} onChange={() => toggleTarget(s.id)} />
                      {s.name}
                    </label>
                  ))}
                </div>
              </div>
              <Input data-testid="push-form-qty" type="number" min={0} placeholder={`Qty per store (${pushFor.unit})`} value={pushQty} onChange={(e) => setPushQty(e.target.value)}
                className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
              <Input data-testid="push-form-note" placeholder="Note (optional)" value={pushNote} onChange={(e) => setPushNote(e.target.value)}
                className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
              {pushTenantIds.length > 0 && pushQty && (
                <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>
                  Total: {(parseFloat(pushQty) || 0) * pushTenantIds.length} {pushFor.unit} across {pushTenantIds.length} store{pushTenantIds.length === 1 ? "" : "s"}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button onClick={() => setPushFor(null)} disabled={pushBusy} className="pos-btn h-9 px-4 rounded-md text-xs" style={{ background: "var(--pos-panel-2)", color: "white" }}>Cancel</button>
                <button data-testid="push-submit-btn" onClick={submitPush} disabled={pushBusy}
                  className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white disabled:opacity-40" style={{ background: "var(--pos-accent)" }}>
                  {pushBusy ? "Pushing…" : "Push stock"}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Push log */}
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-w-lg border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} data-testid="push-log-modal">
          <DialogHeader><DialogTitle className="text-white">Push log</DialogTitle></DialogHeader>
          <div className="space-y-2 max-h-96 overflow-y-auto pos-scroll">
            {log.length === 0 && <p className="text-sm text-center py-6" style={{ color: "var(--pos-muted)" }}>No pushes yet.</p>}
            {log.map((l) => (
              <div key={l.id} data-testid={`push-log-row-${l.id}`} className="rounded-lg p-3" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                <div className="text-sm font-semibold text-white">{l.item_name} — {l.qty} {l.unit} → {l.store_name}</div>
                <div className="text-[11px] mt-0.5" style={{ color: "var(--pos-muted)" }}>
                  {l.by_user_name && <>by {l.by_user_name} · </>}{new Date(l.at).toLocaleString("en-GB")}{l.note && <> · {l.note}</>}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
