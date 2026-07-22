import React, { useEffect, useState } from "react";
import { wasteApi, cashDrawerApi, tipsApi, inventoryApi } from "../../api/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { PlusCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Reusable panels previously housed under the now-removed "Operations" tab.
 *  - WastePanel       → rendered inside InventoryScreen
 *  - CashDrawerPanel  → rendered inside ReportsScreen
 *  - TipPoolPanel     → rendered inside ReportsScreen
 */

export function WastePanel() {
  const [list, setList] = useState([]);
  const [inv, setInv] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ inventory_id: "", qty: "", reason: "" });
  const load = () => {
    wasteApi.list().then(setList);
    inventoryApi.list().then(setInv);
  };
  useEffect(() => { load(); }, []);
  const save = async () => {
    if (!form.inventory_id || !form.qty || !form.reason.trim()) { toast.error("Fill all fields"); return; }
    try {
      await wasteApi.log({ inventory_id: form.inventory_id, qty: parseFloat(form.qty), reason: form.reason });
      toast.success("Logged");
      setOpen(false); setForm({ inventory_id: "", qty: "", reason: "" }); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  return (
    <div>
      <div className="flex justify-end mb-3">
        <button data-testid="waste-add-btn" onClick={() => setOpen(true)} className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white flex items-center gap-2" style={{ background: "var(--pos-accent)" }}>
          <PlusCircle className="w-4 h-4" /> Log waste
        </button>
      </div>
      <table className="w-full text-sm">
        <thead style={{ color: "var(--pos-muted)" }}>
          <tr style={{ borderBottom: "1px solid var(--pos-border)" }}>
            <th className="text-left py-2 px-3 uppercase text-[11px]">When</th>
            <th className="text-left py-2 px-3 uppercase text-[11px]">Item</th>
            <th className="text-right py-2 px-3 uppercase text-[11px]">Qty</th>
            <th className="text-left py-2 px-3 uppercase text-[11px]">Reason</th>
            <th className="text-left py-2 px-3 uppercase text-[11px]">By</th>
          </tr>
        </thead>
        <tbody className="text-white">
          {list.length === 0 && <tr><td colSpan={5} className="text-center py-8" style={{ color: "var(--pos-muted)" }}>No waste logged yet.</td></tr>}
          {list.map((w) => (
            <tr key={w.id} data-testid={`waste-row-${w.id}`} style={{ borderTop: "1px solid var(--pos-border)" }}>
              <td className="py-2 px-3" style={{ color: "var(--pos-muted)" }}>{new Date(w.at).toLocaleString()}</td>
              <td className="py-2 px-3">{w.inventory_name}</td>
              <td className="py-2 px-3 text-right tabular-nums">{w.qty} {w.unit}</td>
              <td className="py-2 px-3">{w.reason}</td>
              <td className="py-2 px-3" style={{ color: "var(--pos-muted)" }}>{w.by_user_name}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
          <DialogHeader><DialogTitle className="text-white">Log waste</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Select value={form.inventory_id} onValueChange={(v) => setForm({ ...form, inventory_id: v })}>
              <SelectTrigger data-testid="waste-item-select" className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }}>
                <SelectValue placeholder="Inventory item" />
              </SelectTrigger>
              <SelectContent>{inv.map((i) => <SelectItem key={i.id} value={i.id}>{i.name} ({i.stock} {i.unit})</SelectItem>)}</SelectContent>
            </Select>
            <Input data-testid="waste-qty-input" placeholder="Quantity wasted" type="number" step="0.1" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
            <Input data-testid="waste-reason-input" placeholder="Reason (e.g. expired, spilled)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="pos-btn h-9 px-4 rounded-md text-xs" style={{ background: "var(--pos-panel-2)", color: "white" }}>Cancel</button>
              <button data-testid="waste-save-btn" onClick={save} className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white" style={{ background: "var(--pos-accent)" }}>Save</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function CashDrawerPanel() {
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [openModal, setOpenModal] = useState(null); // 'open' | 'close' | null
  const [opening, setOpening] = useState("100");
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const load = () => {
    cashDrawerApi.current().then(setCurrent);
    cashDrawerApi.history().then(setHistory);
  };
  useEffect(() => { load(); }, []);
  const open = async () => {
    try { await cashDrawerApi.open({ opening_float: parseFloat(opening) }); setOpenModal(null); load(); toast.success("Drawer opened"); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  const close = async () => {
    try { await cashDrawerApi.close({ counted_cash: parseFloat(counted), notes }); setOpenModal(null); setCounted(""); setNotes(""); load(); toast.success("Drawer closed"); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  return (
    <div>
      <div className="rounded-lg p-4 mb-4" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
        {current ? (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Drawer open since {new Date(current.opened_at).toLocaleString()}</div>
              <div className="text-2xl font-bold text-white">Opening float: ₹{current.opening_float.toFixed(2)}</div>
              <div className="text-xs" style={{ color: "var(--pos-muted)" }}>Opened by {current.opened_by}</div>
            </div>
            <button data-testid="drawer-close-btn" onClick={() => setOpenModal("close")} className="pos-btn h-10 px-4 rounded-md text-xs font-bold text-white" style={{ background: "var(--pos-accent)" }}>Close drawer</button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>No drawer is open</div>
              <div className="text-lg text-white">Open the drawer at the start of the shift to track cash variance.</div>
            </div>
            <button data-testid="drawer-open-btn" onClick={() => setOpenModal("open")} className="pos-btn h-10 px-4 rounded-md text-xs font-bold text-white" style={{ background: "var(--pos-accent)" }}>Open drawer</button>
          </div>
        )}
      </div>
      <h2 className="text-sm font-bold text-white mb-2">History</h2>
      <table className="w-full text-sm">
        <thead style={{ color: "var(--pos-muted)" }}>
          <tr style={{ borderBottom: "1px solid var(--pos-border)" }}>
            <th className="text-left py-2 px-3 uppercase text-[11px]">Date</th>
            <th className="text-right py-2 px-3 uppercase text-[11px]">Float</th>
            <th className="text-right py-2 px-3 uppercase text-[11px]">Expected</th>
            <th className="text-right py-2 px-3 uppercase text-[11px]">Counted</th>
            <th className="text-right py-2 px-3 uppercase text-[11px]">Variance</th>
            <th className="text-left py-2 px-3 uppercase text-[11px]">Closed by</th>
          </tr>
        </thead>
        <tbody className="text-white">
          {history.length === 0 && <tr><td colSpan={6} className="text-center py-6" style={{ color: "var(--pos-muted)" }}>No history.</td></tr>}
          {history.map((d) => (
            <tr key={d.id} data-testid={`drawer-row-${d.id}`} style={{ borderTop: "1px solid var(--pos-border)" }}>
              <td className="py-2 px-3" style={{ color: "var(--pos-muted)" }}>{d.date}</td>
              <td className="py-2 px-3 text-right tabular-nums">₹{d.opening_float?.toFixed(2)}</td>
              <td className="py-2 px-3 text-right tabular-nums">{d.expected_cash != null ? `₹${d.expected_cash.toFixed(2)}` : "—"}</td>
              <td className="py-2 px-3 text-right tabular-nums">{d.counted_cash != null ? `₹${d.counted_cash.toFixed(2)}` : "—"}</td>
              <td className="py-2 px-3 text-right tabular-nums font-bold" style={{ color: d.variance == null ? "var(--pos-muted)" : d.variance === 0 ? "#86efac" : (d.variance > 0 ? "#7dd3fc" : "#fca5a5") }}>
                {d.variance != null ? `₹${d.variance.toFixed(2)}` : "—"}
              </td>
              <td className="py-2 px-3" style={{ color: "var(--pos-muted)" }}>{d.closed_by || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Dialog open={openModal === "open"} onOpenChange={(o) => !o && setOpenModal(null)}>
        <DialogContent className="max-w-sm border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
          <DialogHeader><DialogTitle className="text-white">Open drawer</DialogTitle></DialogHeader>
          <Input data-testid="drawer-opening-input" type="number" placeholder="Opening float (₹)" value={opening} onChange={(e) => setOpening(e.target.value)} className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => setOpenModal(null)} className="pos-btn h-9 px-4 rounded-md text-xs" style={{ background: "var(--pos-panel-2)", color: "white" }}>Cancel</button>
            <button data-testid="drawer-open-confirm" onClick={open} className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white" style={{ background: "var(--pos-accent)" }}>Open</button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={openModal === "close"} onOpenChange={(o) => !o && setOpenModal(null)}>
        <DialogContent className="max-w-sm border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
          <DialogHeader><DialogTitle className="text-white">Close drawer</DialogTitle></DialogHeader>
          <Input data-testid="drawer-counted-input" type="number" placeholder="Counted cash (₹)" value={counted} onChange={(e) => setCounted(e.target.value)} className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
          <Input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => setOpenModal(null)} className="pos-btn h-9 px-4 rounded-md text-xs" style={{ background: "var(--pos-panel-2)", color: "white" }}>Cancel</button>
            <button data-testid="drawer-close-confirm" onClick={close} className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white" style={{ background: "var(--pos-accent)" }}>Close</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function TipPoolPanel() {
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ shift_date: new Date().toISOString().slice(0, 10), total_pool: "" });
  const load = () => tipsApi.list().then(setList);
  useEffect(() => { load(); }, []);
  const create = async () => {
    if (!form.total_pool) { toast.error("Enter pool amount"); return; }
    try {
      await tipsApi.create({ shift_date: form.shift_date, total_pool: parseFloat(form.total_pool), notes: form.notes });
      toast.success("Tip pool distributed");
      setOpen(false); setForm({ shift_date: new Date().toISOString().slice(0, 10), total_pool: "" }); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  const del = async (id) => {
    if (!window.confirm("Delete this tip pool?")) return;
    await tipsApi.remove(id); load();
  };
  return (
    <div>
      <div className="flex justify-end mb-3">
        <button data-testid="tips-add-btn" onClick={() => setOpen(true)} className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white flex items-center gap-2" style={{ background: "var(--pos-accent)" }}>
          <PlusCircle className="w-4 h-4" /> New pool
        </button>
      </div>
      {list.length === 0 && <p className="text-sm text-center py-8" style={{ color: "var(--pos-muted)" }}>No tip pools recorded yet.</p>}
      <div className="space-y-3">
        {list.map((t) => (
          <div key={t.id} data-testid={`tip-pool-${t.id}`} className="rounded-lg p-4" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-bold text-white">{t.shift_date} · ₹{t.total_pool.toFixed(2)}</div>
                <div className="text-xs" style={{ color: "var(--pos-muted)" }}>By {t.created_by} · {new Date(t.at).toLocaleString()}</div>
              </div>
              <button onClick={() => del(t.id)} className="pos-btn p-2 rounded-md" style={{ background: "var(--pos-panel-2)" }}>
                <Trash2 className="w-4 h-4 text-white" />
              </button>
            </div>
            <div className="space-y-1">
              {t.allocations.map((a) => (
                <div key={a.user_id} className="flex justify-between text-xs">
                  <span className="text-white">{a.user_name} <span style={{ color: "var(--pos-muted)" }}>· {a.hours.toFixed(2)}h</span></span>
                  <span className="text-white tabular-nums">₹{a.share.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
          <DialogHeader><DialogTitle className="text-white">New tip pool</DialogTitle></DialogHeader>
          <Input type="date" value={form.shift_date} onChange={(e) => setForm({ ...form, shift_date: e.target.value })} className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
          <Input data-testid="tip-pool-input" type="number" placeholder="Total pool (₹)" value={form.total_pool} onChange={(e) => setForm({ ...form, total_pool: e.target.value })} className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
          <p className="text-xs" style={{ color: "var(--pos-muted)" }}>Shares are computed pro-rata from each employee's clocked hours that day.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="pos-btn h-9 px-4 rounded-md text-xs" style={{ background: "var(--pos-panel-2)", color: "white" }}>Cancel</button>
            <button data-testid="tip-pool-save" onClick={create} className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white" style={{ background: "var(--pos-accent)" }}>Distribute</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
