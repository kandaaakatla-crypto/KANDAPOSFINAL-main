import React, { useEffect, useMemo, useState } from "react";
import { usePos } from "../../store/PosContext";
import { Minus, Plus, AlertTriangle, PackageCheck, Truck, Trash, Search, PlusCircle, Pencil, Trash2, IndianRupee, Mail, Building2 } from "lucide-react";
import { toast } from "sonner";
import { WastePanel } from "./OpsPanels";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { suppliersApi } from "../../api/client";

const emptyForm = { name: "", unit: "", stock: "", reorder: "", supplier: "", cost_per_unit: "" };
const emptySupplierForm = { name: "", email: "", phone: "" };

export default function InventoryScreen() {
  const { inventory, adjustStock, reorderStock, upsertInventoryItem, deleteInventoryItem, staffUser } = usePos();
  const [view, setView] = useState("all");
  const [showWaste, setShowWaste] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null); // null | {} (new) | item (edit)
  const [form, setForm] = useState(emptyForm);
  const isManager = staffUser?.role === "Manager";

  const [suppliers, setSuppliers] = useState([]);
  const [suppliersOpen, setSuppliersOpen] = useState(false);
  const [supplierEditing, setSupplierEditing] = useState(null); // null | {} | supplier
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm);

  const loadSuppliers = () => suppliersApi.list().then(setSuppliers).catch(() => {});
  useEffect(() => { loadSuppliers(); }, []);

  const openNewSupplier = () => { setSupplierForm(emptySupplierForm); setSupplierEditing({}); };
  const openEditSupplier = (s) => { setSupplierForm({ name: s.name, email: s.email || "", phone: s.phone || "" }); setSupplierEditing(s); };
  const saveSupplier = async () => {
    if (!supplierForm.name.trim()) { toast.error("Supplier name is required"); return; }
    try {
      if (supplierEditing?.id) {
        await suppliersApi.update(supplierEditing.id, supplierForm);
        toast.success("Supplier updated");
      } else {
        await suppliersApi.create(supplierForm);
        toast.success("Supplier added");
      }
      setSupplierEditing(null);
      loadSuppliers();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save supplier");
    }
  };
  const removeSupplier = async (s) => {
    if (!window.confirm(`Delete supplier "${s.name}"?`)) return;
    try { await suppliersApi.remove(s.id); loadSuppliers(); toast.success("Supplier removed"); }
    catch (e) { toast.error(e?.response?.data?.detail || "Could not delete supplier"); }
  };

  const doReorder = async (item) => {
    const res = await reorderStock(item.id);
    if (!res) return; // reorderStock already toasted the failure
    if (res.supplier_emailed) {
      toast.success(`Purchase order sent for ${item.name} — emailed ${res.supplier_email}`);
    } else {
      toast.success(`Purchase order sent for ${item.name}`, {
        description: "No supplier email on file — add one in Manage Suppliers to auto-email next time.",
      });
    }
  };

  const lowItems = inventory.filter((i) => i.stock <= i.reorder);
  const filtered = (view === "low" ? lowItems : inventory).filter((i) =>
    !query.trim() || i.name.toLowerCase().includes(query.trim().toLowerCase())
  );
  const stockValue = useMemo(
    () => inventory.reduce((s, i) => s + i.stock * (i.cost_per_unit || 0), 0),
    [inventory]
  );

  const openNew = () => { setForm(emptyForm); setEditing({}); };
  const openEdit = (item) => {
    setForm({
      name: item.name, unit: item.unit, stock: item.stock, reorder: item.reorder,
      supplier: item.supplier, cost_per_unit: item.cost_per_unit || 0,
    });
    setEditing(item);
  };

  const save = async () => {
    if (!form.name.trim() || !form.unit.trim()) { toast.error("Name and unit are required"); return; }
    const payload = {
      name: form.name.trim(), unit: form.unit.trim(), supplier: form.supplier.trim(),
      reorder: parseFloat(form.reorder) || 0, cost_per_unit: parseFloat(form.cost_per_unit) || 0,
    };
    if (editing?.id) {
      const updated = await upsertInventoryItem({ id: editing.id, ...payload });
      if (updated) toast.success("Item updated");
    } else {
      const created = await upsertInventoryItem({ ...payload, stock: parseFloat(form.stock) || 0 });
      if (created) toast.success("Item added");
    }
    setEditing(null);
  };

  const remove = async (item) => {
    if (!window.confirm(`Delete "${item.name}" from inventory?`)) return;
    await deleteInventoryItem(item.id);
    toast.success("Item removed");
  };

  return (
    <div className="h-full flex flex-col p-4 gap-4" data-testid="inventory-screen">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold text-white">Inventory &amp; Stock</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--pos-muted)" }} />
            <Input data-testid="inv-search" placeholder="Search items…" value={query} onChange={(e) => setQuery(e.target.value)}
              className="h-8 pl-8 text-xs text-white w-40" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} />
          </div>
          <button data-testid="inv-filter-all" onClick={() => setView("all")} className="pos-btn px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: view === "all" ? "var(--pos-accent)" : "var(--pos-panel)", color: view === "all" ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
            All Items ({inventory.length})
          </button>
          <button data-testid="inv-filter-low" onClick={() => setView("low")} className="pos-btn px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"
            style={{ background: view === "low" ? "#b91c1c" : "var(--pos-panel)", color: view === "low" ? "#fff" : "#f87171", border: "1px solid var(--pos-border)" }}>
            <AlertTriangle className="w-3.5 h-3.5" /> Low Stock ({lowItems.length})
          </button>
          <button data-testid="inv-toggle-waste" onClick={() => setShowWaste((v) => !v)} className="pos-btn px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"
            style={{ background: showWaste ? "var(--pos-accent)" : "var(--pos-panel)", color: showWaste ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
            <Trash className="w-3.5 h-3.5" /> Wastage log
          </button>
          {isManager && (
            <>
              <button data-testid="inv-manage-suppliers-btn" onClick={() => setSuppliersOpen(true)} className="pos-btn px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                <Building2 className="w-3.5 h-3.5" /> Suppliers
              </button>
              <button data-testid="inv-add-btn" onClick={openNew} className="pos-btn px-3 py-1.5 rounded-lg text-xs font-bold text-white flex items-center gap-1.5" style={{ background: "var(--pos-accent)" }}>
                <PlusCircle className="w-3.5 h-3.5" /> Add Item
              </button>
            </>
          )}
        </div>
      </div>

      {isManager && (
        <div className="rounded-xl p-4 flex items-center gap-4" data-testid="stock-value-widget"
          style={{ background: "linear-gradient(135deg, #1c2438 0%, #101a30 100%)", border: "1px solid var(--pos-border)" }}>
          <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#34d39922" }}>
            <IndianRupee className="w-6 h-6" style={{ color: "#34d399" }} />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Total stock value</div>
            <div className="text-2xl font-bold text-white tabular-nums">₹{stockValue.toFixed(2)}</div>
          </div>
        </div>
      )}

      {showWaste && (
        <div className="rounded-xl p-4" data-testid="waste-section"
          style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
            <Trash className="w-4 h-4" /> Wastage / spoilage log
          </h3>
          <WastePanel />
        </div>
      )}

      {lowItems.length > 0 && view === "all" && (
        <div className="rounded-xl px-4 py-3 flex items-center gap-3 text-sm" style={{ background: "#33150e", border: "1px solid #7d3a2e", color: "#fca5a5" }} data-testid="low-stock-banner">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {lowItems.length} item{lowItems.length > 1 ? "s" : ""} at or below reorder level: {lowItems.map((i) => i.name).join(", ")}
        </div>
      )}

      <div className="flex-1 overflow-y-auto pos-scroll rounded-xl" style={{ border: "1px solid var(--pos-border)" }}>
        <table className="w-full text-sm hidden md:table">
          <thead>
            <tr style={{ background: "var(--pos-panel)" }}>
              {["Item", "In Stock", "Reorder Level", "Value", "Supplier", "Status", "Adjust"].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs uppercase tracking-wider font-semibold" style={{ color: "var(--pos-muted)", borderBottom: "1px solid var(--pos-border)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center py-8" style={{ color: "var(--pos-muted)" }}>No items match.</td></tr>
            )}
            {filtered.map((i) => {
              const low = i.stock <= i.reorder;
              return (
                <tr key={i.id} data-testid={`inv-row-${i.id}`} style={{ borderBottom: "1px solid var(--pos-border)", background: low ? "#2a141077" : "transparent" }}>
                  <td className="px-4 py-3 font-medium text-white">{i.name}</td>
                  <td className="px-4 py-3 tabular-nums font-bold" style={{ color: low ? "#f87171" : "#7ee2a8" }}>{i.stock} {i.unit}</td>
                  <td className="px-4 py-3 tabular-nums" style={{ color: "var(--pos-muted)" }}>{i.reorder} {i.unit}</td>
                  <td className="px-4 py-3 tabular-nums" style={{ color: "var(--pos-muted)" }}>₹{(i.stock * (i.cost_per_unit || 0)).toFixed(0)}</td>
                  <td className="px-4 py-3" style={{ color: "var(--pos-muted)" }}>{i.supplier}</td>
                  <td className="px-4 py-3">
                    {low ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full uppercase" style={{ background: "#3a1515", color: "#f87171" }}><AlertTriangle className="w-3 h-3" /> Reorder</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full uppercase" style={{ background: "#13271a", color: "#22c55e" }}><PackageCheck className="w-3 h-3" /> OK</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button data-testid={`stock-minus-${i.id}`} onClick={() => adjustStock(i.id, -1)} className="pos-btn w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}><Minus className="w-3.5 h-3.5 text-white" /></button>
                      <button data-testid={`stock-plus-${i.id}`} onClick={() => adjustStock(i.id, 1)} className="pos-btn w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}><Plus className="w-3.5 h-3.5 text-white" /></button>
                      {low && (
                        <button data-testid={`reorder-${i.id}`} onClick={() => doReorder(i)}
                          className="pos-btn h-8 px-3 rounded-lg text-xs font-bold text-white flex items-center gap-1" style={{ background: "var(--pos-blue)" }}>
                          <Truck className="w-3.5 h-3.5" /> Reorder
                        </button>
                      )}
                      {isManager && (
                        <>
                          <button data-testid={`inv-edit-${i.id}`} onClick={() => openEdit(i)} className="pos-btn w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}><Pencil className="w-3.5 h-3.5 text-white" /></button>
                          <button data-testid={`inv-delete-${i.id}`} onClick={() => remove(i)} className="pos-btn w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Mobile card list */}
        <div className="md:hidden divide-y" style={{ borderColor: "var(--pos-border)" }}>
          {filtered.length === 0 && (
            <div className="text-center py-8 text-sm" style={{ color: "var(--pos-muted)" }}>No items match.</div>
          )}
          {filtered.map((i) => {
            const low = i.stock <= i.reorder;
            return (
              <div key={i.id} data-testid={`inv-row-${i.id}`} className="p-3 flex flex-col gap-2" style={{ background: low ? "#2a141077" : "transparent", borderColor: "var(--pos-border)" }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-white text-sm">{i.name}</div>
                  {low ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full uppercase shrink-0" style={{ background: "#3a1515", color: "#f87171" }}><AlertTriangle className="w-3 h-3" /> Reorder</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full uppercase shrink-0" style={{ background: "#13271a", color: "#22c55e" }}><PackageCheck className="w-3 h-3" /> OK</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--pos-muted)" }}>
                  <span>Stock: <b style={{ color: low ? "#f87171" : "#7ee2a8" }}>{i.stock} {i.unit}</b></span>
                  <span>Reorder at: {i.reorder} {i.unit}</span>
                  <span>Value: ₹{(i.stock * (i.cost_per_unit || 0)).toFixed(0)}</span>
                  {i.supplier && <span>Supplier: {i.supplier}</span>}
                </div>
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <button data-testid={`stock-minus-${i.id}`} onClick={() => adjustStock(i.id, -1)} className="pos-btn w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}><Minus className="w-4 h-4 text-white" /></button>
                  <button data-testid={`stock-plus-${i.id}`} onClick={() => adjustStock(i.id, 1)} className="pos-btn w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}><Plus className="w-4 h-4 text-white" /></button>
                  {low && (
                    <button data-testid={`reorder-${i.id}`} onClick={() => doReorder(i)}
                      className="pos-btn h-10 px-3 rounded-lg text-xs font-bold text-white flex items-center gap-1" style={{ background: "var(--pos-blue)" }}>
                      <Truck className="w-4 h-4" /> Reorder
                    </button>
                  )}
                  {isManager && (
                    <>
                      <button data-testid={`inv-edit-${i.id}`} onClick={() => openEdit(i)} className="pos-btn w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}><Pencil className="w-4 h-4 text-white" /></button>
                      <button data-testid={`inv-delete-${i.id}`} onClick={() => remove(i)} className="pos-btn w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}><Trash2 className="w-4 h-4 text-red-400" /></button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-sm border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
          <DialogHeader><DialogTitle className="text-white">{editing?.id ? "Edit item" : "Add inventory item"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input data-testid="inv-form-name" placeholder="Item name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
            <div className="grid grid-cols-2 gap-3">
              <Input data-testid="inv-form-unit" placeholder="Unit (kg, pcs…)" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
              {!editing?.id && (
                <Input data-testid="inv-form-stock" type="number" placeholder="Starting stock" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input data-testid="inv-form-reorder" type="number" placeholder="Reorder level" value={form.reorder} onChange={(e) => setForm({ ...form, reorder: e.target.value })} className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
              <Input data-testid="inv-form-cost" type="number" placeholder="Cost per unit (₹)" value={form.cost_per_unit} onChange={(e) => setForm({ ...form, cost_per_unit: e.target.value })} className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
            </div>
            <Input data-testid="inv-form-supplier" list="supplier-names" placeholder="Supplier" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
            <datalist id="supplier-names">
              {suppliers.map((s) => <option key={s.id} value={s.name} />)}
            </datalist>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="pos-btn h-9 px-4 rounded-md text-xs" style={{ background: "var(--pos-panel-2)", color: "white" }}>Cancel</button>
              <button data-testid="inv-form-save" onClick={save} className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white" style={{ background: "var(--pos-accent)" }}>Save</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={suppliersOpen} onOpenChange={setSuppliersOpen}>
        <DialogContent className="max-w-lg border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
          <DialogHeader><DialogTitle className="text-white">Suppliers</DialogTitle></DialogHeader>
          <p className="text-xs -mt-2" style={{ color: "var(--pos-muted)" }}>
            Add a supplier's email so clicking <b>Reorder</b> on a matching item auto-sends them a purchase order.
          </p>
          <div className="space-y-2 max-h-64 overflow-y-auto pos-scroll">
            {suppliers.length === 0 && <p className="text-sm text-center py-6" style={{ color: "var(--pos-muted)" }}>No suppliers yet.</p>}
            {suppliers.map((s) => (
              <div key={s.id} data-testid={`supplier-row-${s.id}`} className="rounded-lg p-3 flex items-center justify-between gap-2" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">{s.name}</div>
                  <div className="text-xs flex items-center gap-1 mt-0.5" style={{ color: s.email ? "var(--pos-muted)" : "#f87171" }}>
                    <Mail className="w-3 h-3 shrink-0" /> {s.email || "No email on file"}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button data-testid={`supplier-edit-${s.id}`} onClick={() => openEditSupplier(s)} className="pos-btn w-8 h-8 rounded-md flex items-center justify-center" style={{ background: "var(--pos-panel)" }}><Pencil className="w-3.5 h-3.5 text-white" /></button>
                  <button data-testid={`supplier-delete-${s.id}`} onClick={() => removeSupplier(s)} className="pos-btn w-8 h-8 rounded-md flex items-center justify-center" style={{ background: "var(--pos-panel)" }}><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
                </div>
              </div>
            ))}
          </div>
          <button data-testid="supplier-add-btn" onClick={openNewSupplier}
            className="pos-btn w-full h-9 rounded-md text-xs font-bold flex items-center justify-center gap-1.5"
            style={{ background: "var(--pos-panel-2)", color: "var(--pos-accent)", border: "1px dashed var(--pos-border)" }}>
            <PlusCircle className="w-3.5 h-3.5" /> Add supplier
          </button>
        </DialogContent>
      </Dialog>

      <Dialog open={!!supplierEditing} onOpenChange={(o) => !o && setSupplierEditing(null)}>
        <DialogContent className="max-w-sm border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
          <DialogHeader><DialogTitle className="text-white">{supplierEditing?.id ? "Edit supplier" : "New supplier"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input data-testid="supplier-form-name" placeholder="Supplier name" value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
            <Input data-testid="supplier-form-email" type="email" placeholder="Email address" value={supplierForm.email} onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })} className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
            <Input data-testid="supplier-form-phone" placeholder="Phone (optional)" value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setSupplierEditing(null)} className="pos-btn h-9 px-4 rounded-md text-xs" style={{ background: "var(--pos-panel-2)", color: "white" }}>Cancel</button>
              <button data-testid="supplier-form-save" onClick={saveSupplier} className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white" style={{ background: "var(--pos-accent)" }}>Save</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
