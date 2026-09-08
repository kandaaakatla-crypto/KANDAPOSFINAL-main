import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { usePos } from "../../store/PosContext";
import { menuApi } from "../../api/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Pencil, PlusCircle, ChefHat, LayoutGrid, Download, Upload, FileText, Eye, Trash2, ScanLine, Layers } from "lucide-react";
import { toast } from "sonner";
import RecipeModal from "./RecipeModal";
import CategoryManagerModal from "./CategoryManagerModal";

export default function MenuScreen() {
  const { menuItems, upsertMenuItem, toggleItemAvailability, refreshMenu, staffUser, features } = usePos();
  const location = useLocation();
  // Edit affordances live in the Restaurant Dashboard at /biz/menu. The /menu
  // route inside the POS is intentionally read-only — managers go to the
  // Dashboard to add/remove/toggle items per product spec.
  const isDashboard = location.pathname.startsWith("/biz");
  const editable = isDashboard; // controls visibility of Add/Edit/CSV/Categories
  const [cats, setCats] = useState([]);
  const [activeCat, setActiveCat] = useState(null);
  const [editing, setEditing] = useState(null);
  const [recipeFor, setRecipeFor] = useState(null);
  const [catModal, setCatModal] = useState(false);
  const isManager = staffUser?.role === "Manager" || isDashboard;

  const loadCats = () => menuApi.categories().then((cs) => {
    setCats(cs);
    if (!activeCat && cs.length) setActiveCat(cs[0].id);
  }).catch(() => {});
  useEffect(() => { loadCats(); /* eslint-disable-next-line */ }, []);

  const items = menuItems.filter((m) => m.catId === activeCat);

  const save = () => {
    if (!editing.name) { toast.error("Item name is required"); return; }
    if (isDealsCat && (editing.dealGroups || []).some((g) => !g.cat_id || !g.label.trim() || g.count < 1)) {
      toast.error("Every deal group needs a category, label, and count of at least 1");
      return;
    }
    if ((editing.variants || []).some((v) => !v.label.trim())) {
      toast.error("Every variant needs a label");
      return;
    }
    const item = { ...editing };
    if (item.isPizza) {
      item.sizes = { sm: parseFloat(item.sm) || 0, md: parseFloat(item.md) || 0, lg: parseFloat(item.lg) || 0 };
      delete item.sm; delete item.md; delete item.lg;
    } else {
      item.price = parseFloat(item.price) || 0;
    }
    item.variants = (item.variants || []).length
      ? item.variants.map((v) => ({ ...v, price: parseFloat(v.price) || 0 }))
      : null;
    item.barcode = (item.barcode || "").trim() || null;
    item.tax_rate = item.tax_rate === "" || item.tax_rate == null ? null : parseFloat(item.tax_rate);
    if (Number.isNaN(item.tax_rate)) item.tax_rate = null;
    upsertMenuItem(item);
    toast.success(editing.id ? "Item updated" : "Item added to menu");
    setEditing(null);
  };

  const openEdit = (item) => {
    const e = { ...item };
    if (item.isPizza) { e.sm = item.sizes.sm; e.md = item.sizes.md; e.lg = item.sizes.lg; }
    e.dealGroups = item.dealGroups || [];
    e.variants = item.variants || [];
    e.barcode = item.barcode || "";
    e.tax_rate = item.tax_rate ?? "";
    setEditing(e);
  };

  const openNew = () => {
    setEditing({ name: "", desc: "", catId: activeCat, price: "", available: true, isPizza: false, sm: "", md: "", lg: "", dealGroups: [], imageUrl: "", barcode: "", variants: [], tax_rate: "" });
  };

  const isDealsCat = editing?.catId === "deals";
  const activeCatTaxRate = editing ? cats.find((c) => c.id === editing.catId)?.tax_rate ?? null : null;
  const addDealGroup = () => setEditing({ ...editing, dealGroups: [...(editing.dealGroups || []), { cat_id: cats.find((c) => c.id !== "deals")?.id || "", label: "", count: 1, size: null }] });
  const updateDealGroup = (i, patch) => setEditing({ ...editing, dealGroups: editing.dealGroups.map((g, gi) => (gi === i ? { ...g, ...patch } : g)) });
  const removeDealGroup = (i) => setEditing({ ...editing, dealGroups: editing.dealGroups.filter((_, gi) => gi !== i) });

  const addVariant = () => setEditing({ ...editing, variants: [...(editing.variants || []), { label: "", price: "", sku: "", available: true }] });
  const updateVariant = (i, patch) => setEditing({ ...editing, variants: editing.variants.map((v, vi) => (vi === i ? { ...v, ...patch } : v)) });
  const removeVariant = (i) => setEditing({ ...editing, variants: editing.variants.filter((_, vi) => vi !== i) });

  const priceLabel = (m) => {
    if (m.isPizza) return `₹${m.sizes.sm.toFixed(2)} / ₹${m.sizes.md.toFixed(2)} / ₹${m.sizes.lg.toFixed(2)}`;
    if (Array.isArray(m.variants) && m.variants.length) return `From ₹${Math.min(...m.variants.map((v) => v.price)).toFixed(2)}`;
    return `₹${(m.price || 0).toFixed(2)}`;
  };

  const taxLabel = (m) => {
    if (m.tax_rate != null) return `${m.tax_rate}%`;
    const cat = cats.find((c) => c.id === m.catId);
    return cat?.tax_rate != null ? `${cat.tax_rate}% (auto)` : "auto";
  };

  const [importPreview, setImportPreview] = useState(null); // { file, body }
  const apiBase = `${process.env.REACT_APP_BACKEND_URL}/api`;
  const downloadCsv = async (path, filename) => {
    const token = localStorage.getItem("kanda_pos_token_v1");
    const r = await fetch(`${apiBase}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) { toast.error("Could not download"); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const uploadCsv = async (file) => {
    if (!file) return;
    const token = localStorage.getItem("kanda_pos_token_v1");
    const form = new FormData(); form.append("file", file);
    try {
      const r = await fetch(`${apiBase}/menu/import?dry_run=true`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
      });
      const body = await r.json();
      if (!r.ok) { toast.error(body.detail || "Preview failed"); return; }
      setImportPreview({ file, body });
    } catch (e) {
      toast.error("Upload failed");
    }
  };

  const applyImport = async () => {
    if (!importPreview) return;
    const token = localStorage.getItem("kanda_pos_token_v1");
    const form = new FormData(); form.append("file", importPreview.file);
    try {
      const r = await fetch(`${apiBase}/menu/import`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
      });
      const body = await r.json();
      if (!r.ok) { toast.error(body.detail || "Import failed"); return; }
      toast.success(`Imported · created ${body.created}, updated ${body.updated}, skipped ${body.skipped}`);
      if (refreshMenu) await refreshMenu();
      setImportPreview(null);
    } catch { toast.error("Apply failed"); }
  };

  return (
    <div className="h-full flex flex-col p-4 gap-4" data-testid="menu-screen">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold text-white">Menu Management</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {editable && (
            <>
              <button data-testid="manage-categories-btn" onClick={() => setCatModal(true)}
                className="pos-btn h-10 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5"
                style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                <LayoutGrid className="w-3.5 h-3.5" /> Categories
              </button>
              <button data-testid="menu-template-btn" onClick={() => downloadCsv("/menu/template.csv", "kanda-menu-template.csv")}
                className="pos-btn h-10 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5"
                style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                <FileText className="w-3.5 h-3.5" /> Template
              </button>
              <button data-testid="menu-export-btn" onClick={() => downloadCsv("/menu/export.csv", "kanda-menu.csv")}
                className="pos-btn h-10 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5"
                style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                <Download className="w-3.5 h-3.5" /> Export
              </button>
              <label className="pos-btn h-10 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                <Upload className="w-3.5 h-3.5" /> Import
                <input data-testid="menu-import-input" type="file" accept=".csv" className="hidden"
                  onChange={(e) => { uploadCsv(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
            </>
          )}
          {editable ? (
            <button data-testid="add-menu-item-btn" onClick={openNew}
              className="pos-btn h-10 px-4 rounded-lg text-sm font-bold text-white flex items-center gap-2" style={{ background: "var(--pos-accent)" }}>
              <PlusCircle className="w-4 h-4" /> Add Item
            </button>
          ) : (
            <span className="text-xs px-3 py-1.5 rounded-md flex items-center gap-2"
              style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
              <Eye className="w-3.5 h-3.5" /> View-only — manage menu in the Dashboard
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {cats.map((c) => (
          <button key={c.id} data-testid={`menu-cat-${c.id}`} onClick={() => setActiveCat(c.id)}
            className="pos-btn px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2"
            style={{ background: activeCat === c.id ? "var(--pos-panel-2)" : "var(--pos-panel)", color: activeCat === c.id ? "#fff" : "var(--pos-muted)", border: `1px solid ${activeCat === c.id ? c.color : "var(--pos-border)"}` }}>
            <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
            {c.name}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pos-scroll rounded-xl" style={{ border: "1px solid var(--pos-border)" }}>
        <table className="w-full text-sm hidden md:table">
          <thead>
            <tr style={{ background: "var(--pos-panel)" }}>
              {["Item", "Description", "Price", "GST", "Available", "actions"].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs uppercase tracking-wider font-semibold" style={{ color: "var(--pos-muted)", borderBottom: "1px solid var(--pos-border)" }}>{h === "actions" ? "" : h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id} data-testid={`menu-row-${m.id}`} style={{ borderBottom: "1px solid var(--pos-border)", opacity: m.available ? 1 : 0.55 }}>
                <td className="px-4 py-3 font-medium text-white">{m.name}</td>
                <td className="px-4 py-3 max-w-xs truncate" style={{ color: "var(--pos-muted)" }}>{m.desc || "—"}</td>
                <td className="px-4 py-3 tabular-nums font-semibold" style={{ color: "var(--pos-accent)" }}>
                  {priceLabel(m)}
                </td>
                <td className="px-4 py-3 text-xs tabular-nums" style={{ color: "var(--pos-muted)" }}>
                  {taxLabel(m)}
                </td>
                <td className="px-4 py-3">
                  <Switch data-testid={`toggle-${m.id}`} checked={m.available} onCheckedChange={() => { toggleItemAvailability(m.id); toast.info(`${m.name} ${m.available ? "marked unavailable" : "back on sale"}`); }} />
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {editable && isManager && (
                      <button data-testid={`recipe-btn-${m.id}`} onClick={() => setRecipeFor(m)} className="pos-btn p-2 rounded-lg" style={{ background: "var(--pos-panel-2)", color: "var(--pos-accent)" }} title="Manage recipe">
                        <ChefHat className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {editable && (
                      <button data-testid={`edit-menu-${m.id}`} onClick={() => openEdit(m)} className="pos-btn p-2 rounded-lg" style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Mobile card list */}
        <div className="md:hidden divide-y" style={{ borderColor: "var(--pos-border)" }}>
          {items.map((m) => (
            <div key={m.id} data-testid={`menu-row-${m.id}`} className="p-3 flex flex-col gap-2" style={{ opacity: m.available ? 1 : 0.55 }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-white text-sm">{m.name}</div>
                  {m.desc && <div className="text-xs truncate mt-0.5" style={{ color: "var(--pos-muted)" }}>{m.desc}</div>}
                </div>
                <Switch data-testid={`toggle-${m.id}`} checked={m.available} onCheckedChange={() => { toggleItemAvailability(m.id); toast.info(`${m.name} ${m.available ? "marked unavailable" : "back on sale"}`); }} className="shrink-0" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold tabular-nums" style={{ color: "var(--pos-accent)" }}>
                    {priceLabel(m)}
                  </div>
                  <div className="text-[11px] tabular-nums" style={{ color: "var(--pos-muted)" }}>GST {taxLabel(m)}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  {editable && isManager && (
                    <button data-testid={`recipe-btn-${m.id}`} onClick={() => setRecipeFor(m)} className="pos-btn w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-panel-2)", color: "var(--pos-accent)" }} title="Manage recipe">
                      <ChefHat className="w-4 h-4" />
                    </button>
                  )}
                  {editable && (
                    <button data-testid={`edit-menu-${m.id}`} onClick={() => openEdit(m)} className="pos-btn w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} data-testid="menu-item-modal">
          <DialogHeader><DialogTitle className="text-white">{editing?.id ? "Edit Item" : "New Menu Item"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <Input data-testid="menu-field-name" placeholder="Item name *" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="h-10 text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
              <Input data-testid="menu-field-desc" placeholder="Description" value={editing.desc || ""} onChange={(e) => setEditing({ ...editing, desc: e.target.value })}
                className="h-10 text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
              <div className="flex items-center gap-2">
                <Input data-testid="menu-field-image" placeholder="Image URL — shown on the QR ordering menu" value={editing.imageUrl || ""} onChange={(e) => setEditing({ ...editing, imageUrl: e.target.value })}
                  className="h-10 text-white flex-1" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
                {editing.imageUrl && (
                  <img src={editing.imageUrl} alt="" className="w-10 h-10 rounded-md object-cover shrink-0" style={{ border: "1px solid var(--pos-border)" }}
                    onError={(e) => { e.currentTarget.style.display = "none"; }} />
                )}
              </div>
              <div className="relative">
                <ScanLine className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--pos-muted)" }} />
                <Input data-testid="menu-field-barcode" placeholder="Barcode / SKU (optional)" value={editing.barcode || ""} onChange={(e) => setEditing({ ...editing, barcode: e.target.value })}
                  className="h-10 pl-9 text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
              </div>
              <Select value={editing.catId} onValueChange={(v) => setEditing({ ...editing, catId: v })}>
                <SelectTrigger data-testid="menu-field-cat" className="h-10 text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }}>
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {features.pizza_sizing && (
                <label className="flex items-center gap-2 text-xs text-white">
                  <Switch data-testid="menu-field-ispizza" checked={!!editing.isPizza} onCheckedChange={(v) => setEditing({ ...editing, isPizza: v })} />
                  Sized item (3 prices)
                </label>
              )}
              {editing.isPizza && features.pizza_sizing ? (
                <div className="grid grid-cols-3 gap-2">
                  {[{ k: "sm", l: 'Small ₹' }, { k: "md", l: 'Medium ₹' }, { k: "lg", l: 'Large ₹' }].map((s) => (
                    <Input key={s.k} data-testid={`menu-field-${s.k}`} type="number" placeholder={s.l} value={editing[s.k]} onChange={(e) => setEditing({ ...editing, [s.k]: e.target.value })}
                      className="h-10 text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
                  ))}
                </div>
              ) : (
                <Input data-testid="menu-field-price" type="number" placeholder="Price ₹ *" value={editing.price} onChange={(e) => setEditing({ ...editing, price: e.target.value })}
                  className="h-10 text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
              )}

              <label className="block">
                <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--pos-muted)" }}>
                  GST % — {activeCatTaxRate != null ? `auto: ${activeCatTaxRate}% from category` : "auto-resolved per item"}
                </div>
                <Input data-testid="menu-field-tax-rate" type="number" placeholder="Auto" value={editing.tax_rate}
                  onChange={(e) => setEditing({ ...editing, tax_rate: e.target.value })}
                  className="h-10 text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
              </label>

              {!editing.isPizza && (
                <div className="rounded-lg p-3 space-y-2" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                  <div className="text-xs uppercase tracking-wider font-semibold flex items-center gap-1.5" style={{ color: "var(--pos-muted)" }}>
                    <Layers className="w-3.5 h-3.5" /> Variants (size, colour, etc. — optional)
                  </div>
                  {(editing.variants || []).map((v, i) => (
                    <div key={i} className="flex items-center gap-1.5" data-testid={`variant-row-${i}`}>
                      <Input data-testid={`variant-label-${i}`} placeholder="Label (e.g. Medium, Red)" value={v.label} onChange={(e) => updateVariant(i, { label: e.target.value })}
                        className="h-9 text-white text-xs flex-1" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} />
                      <Input data-testid={`variant-price-${i}`} type="number" placeholder="₹" value={v.price} onChange={(e) => updateVariant(i, { price: e.target.value })}
                        className="h-9 text-white text-xs w-20 shrink-0" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} />
                      <Input data-testid={`variant-sku-${i}`} placeholder="SKU" value={v.sku || ""} onChange={(e) => updateVariant(i, { sku: e.target.value })}
                        className="h-9 text-white text-xs w-20 shrink-0" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} />
                      <button type="button" data-testid={`variant-remove-${i}`} onClick={() => removeVariant(i)} className="pos-btn w-9 h-9 shrink-0 rounded-md flex items-center justify-center" style={{ background: "var(--pos-panel)" }}>
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>
                  ))}
                  <button type="button" data-testid="variant-add" onClick={addVariant}
                    className="pos-btn w-full h-9 rounded-md text-xs font-bold flex items-center justify-center gap-1.5"
                    style={{ background: "var(--pos-panel)", color: "var(--pos-accent)", border: "1px dashed var(--pos-border)" }}>
                    <PlusCircle className="w-3.5 h-3.5" /> Add variant
                  </button>
                </div>
              )}

              {isDealsCat && features.meal_deals && (
                <div className="rounded-lg p-3 space-y-2" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                  <div className="text-xs uppercase tracking-wider font-semibold" style={{ color: "var(--pos-muted)" }}>
                    Deal components — what the customer picks
                  </div>
                  {(editing.dealGroups || []).map((g, i) => (
                    <div key={i} className="flex items-center gap-1.5" data-testid={`deal-group-row-${i}`}>
                      <Select value={g.cat_id} onValueChange={(v) => updateDealGroup(i, { cat_id: v, size: v === "pizzas" ? (g.size || "md") : null })}>
                        <SelectTrigger data-testid={`deal-group-cat-${i}`} className="h-9 text-white text-xs w-28 shrink-0" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
                          <SelectValue placeholder="Category" />
                        </SelectTrigger>
                        <SelectContent>
                          {cats.filter((c) => c.id !== "deals").map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {g.cat_id === "pizzas" && (
                        <Select value={g.size || "md"} onValueChange={(v) => updateDealGroup(i, { size: v })}>
                          <SelectTrigger data-testid={`deal-group-size-${i}`} className="h-9 text-white text-xs w-16 shrink-0" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="sm">Sm</SelectItem>
                            <SelectItem value="md">Md</SelectItem>
                            <SelectItem value="lg">Lg</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                      <Input data-testid={`deal-group-label-${i}`} placeholder="Label shown to staff" value={g.label} onChange={(e) => updateDealGroup(i, { label: e.target.value })}
                        className="h-9 text-white text-xs flex-1" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} />
                      <Input data-testid={`deal-group-count-${i}`} type="number" min={1} value={g.count} onChange={(e) => updateDealGroup(i, { count: parseInt(e.target.value) || 1 })}
                        className="h-9 text-white text-xs w-14 shrink-0" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} />
                      <button type="button" data-testid={`deal-group-remove-${i}`} onClick={() => removeDealGroup(i)} className="pos-btn w-9 h-9 shrink-0 rounded-md flex items-center justify-center" style={{ background: "var(--pos-panel)" }}>
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>
                  ))}
                  <button type="button" data-testid="deal-group-add" onClick={addDealGroup}
                    className="pos-btn w-full h-9 rounded-md text-xs font-bold flex items-center justify-center gap-1.5"
                    style={{ background: "var(--pos-panel)", color: "var(--pos-accent)", border: "1px dashed var(--pos-border)" }}>
                    <PlusCircle className="w-3.5 h-3.5" /> Add component
                  </button>
                </div>
              )}

              <div className="flex gap-2">
                {editing.id && isManager && (
                  <button type="button" data-testid="open-recipe-from-edit" onClick={() => { setRecipeFor(editing); setEditing(null); }}
                    className="pos-btn h-11 px-3 rounded-lg font-bold flex items-center gap-1.5"
                    style={{ background: "var(--pos-panel-2)", color: "var(--pos-accent)", border: "1px solid var(--pos-border)" }}>
                    <ChefHat className="w-4 h-4" /> Recipe
                  </button>
                )}
                <button data-testid="save-menu-item-btn" onClick={save} className="pos-btn flex-1 h-11 rounded-lg font-bold text-white" style={{ background: "var(--pos-accent)" }}>Save Item</button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <RecipeModal item={recipeFor} open={!!recipeFor} onClose={() => setRecipeFor(null)} />
      <CategoryManagerModal open={catModal} onClose={() => setCatModal(false)} onChanged={() => { loadCats(); refreshMenu && refreshMenu(); }} />

      <Dialog open={!!importPreview} onOpenChange={(o) => !o && setImportPreview(null)}>
        <DialogContent className="max-w-2xl border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} data-testid="csv-preview-modal">
          <DialogHeader><DialogTitle className="text-white">Import preview — {importPreview?.file?.name}</DialogTitle></DialogHeader>
          {importPreview && (
            <div className="space-y-3">
              <div className="flex gap-3 text-xs">
                <span className="px-2 py-1 rounded-full" style={{ background: "#0e2515", color: "#86efac" }}>Create {importPreview.body.created}</span>
                <span className="px-2 py-1 rounded-full" style={{ background: "#0e1a25", color: "#7dd3fc" }}>Update {importPreview.body.updated}</span>
                <span className="px-2 py-1 rounded-full" style={{ background: "#25190e", color: "#fcd34d" }}>Skip {importPreview.body.skipped}</span>
              </div>
              <div className="max-h-[50vh] overflow-auto rounded-md" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                <table className="w-full text-xs">
                  <thead><tr className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>
                    <th className="px-2 py-1 text-left">Row</th>
                    <th className="px-2 py-1 text-left">Action</th>
                    <th className="px-2 py-1 text-left">Name</th>
                    <th className="px-2 py-1 text-left">Category</th>
                  </tr></thead>
                  <tbody>
                    {(importPreview.body.changes || []).map((c) => (
                      <tr key={c.row} data-testid={`csv-preview-row-${c.row}`} style={{ borderTop: "1px solid var(--pos-border)" }}>
                        <td className="px-2 py-1 tabular-nums" style={{ color: "var(--pos-muted)" }}>{c.row}</td>
                        <td className="px-2 py-1 font-bold" style={{ color: c.action === "update" ? "#7dd3fc" : "#86efac" }}>{c.action}</td>
                        <td className="px-2 py-1 text-white">{c.name}</td>
                        <td className="px-2 py-1" style={{ color: "var(--pos-muted)" }}>{c.category}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {importPreview.body.errors?.length > 0 && (
                <div className="text-[11px] rounded-md p-2" style={{ background: "rgba(239,68,68,0.08)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.3)" }}>
                  {importPreview.body.errors.slice(0, 5).map((e, i) => <div key={i}>Row {e.row}: {e.reason}</div>)}
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <button onClick={() => setImportPreview(null)} className="pos-btn h-10 px-4 rounded-md text-xs font-bold"
                  style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>Cancel</button>
                <button data-testid="csv-apply-btn" onClick={applyImport} className="pos-btn h-10 px-4 rounded-md text-xs font-bold text-white"
                  style={{ background: "var(--pos-accent)" }}>Apply import</button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
