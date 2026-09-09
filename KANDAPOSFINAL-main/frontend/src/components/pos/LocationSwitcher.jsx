import React, { useEffect, useState } from "react";
import { locationsApi } from "../../api/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "../ui/alert-dialog";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { MapPin, Plus, ChevronDown, Trash2 } from "lucide-react";
import { toast } from "sonner";

const STORAGE_KEY = "kanda_pos_active_location_v1";

/**
 * Compact header dropdown showing the store name. Click to expand a popover
 * with the list of locations + "Add new" + "Manage" controls. The chosen
 * location is persisted to localStorage for downstream filtering (orders /
 * reports / shifts will gain a `?location_id=` filter in a follow-up).
 *
 * Per user direction: there's no "All stores" aggregated view — managers
 * operate on one location at a time.
 */
export default function LocationSwitcher({ storeName, isManager }) {
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => localStorage.getItem(STORAGE_KEY) || "");
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState({ name: "", address: "", phone: "", store_number: "", active: true, is_default: false });

  const load = async () => {
    try {
      const docs = await locationsApi.list();
      setList(docs);
      // First-time visit: lock on the default location.
      if (!active && docs.length) {
        const def = docs.find((l) => l.is_default) || docs[0];
        setActive(def.id);
        localStorage.setItem(STORAGE_KEY, def.id);
      }
    } catch { /* fail silently — header should never block */ }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

  const activeLoc = list.find((l) => l.id === active) || list[0];

  const choose = (id) => {
    setActive(id);
    localStorage.setItem(STORAGE_KEY, id);
    setOpen(false);
    // Notify the rest of the app — orders/reports may want to refetch.
    window.dispatchEvent(new CustomEvent("kanda:location-changed", { detail: { id } }));
    toast.success(`Now operating at ${list.find((l) => l.id === id)?.name}`);
  };

  const createLoc = async () => {
    if (!form.name.trim()) { toast.error("Name required"); return; }
    try {
      const fresh = await locationsApi.create(form);
      toast.success("Location added");
      setNewOpen(false);
      setForm({ name: "", address: "", phone: "", store_number: "", active: true, is_default: false });
      await load();
      choose(fresh.id);
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const removeLoc = async (id) => {
    try { await locationsApi.remove(id); await load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const setDefault = async (id) => {
    try { await locationsApi.update(id, { is_default: true }); await load(); toast.success("Default updated"); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  // If the tenant has exactly one location, show just the name with a small
  // discreet `+` so it doesn't visually distract.
  const single = list.length <= 1;

  return (
    <div className="relative">
      <button data-testid="location-switcher-btn" onClick={() => setOpen((v) => !v)}
        className="pos-btn flex items-center gap-2 rounded-md px-2 py-1.5 group"
        style={{ background: "transparent" }}>
        <MapPin className="w-3.5 h-3.5" style={{ color: "var(--pos-accent)" }} />
        <div className="text-left">
          <div className="text-[10px] uppercase tracking-wider leading-none" style={{ color: "var(--pos-muted)" }}>
            {single ? "Store" : "Active location"}
          </div>
          <div className="text-sm font-bold leading-tight" style={{ color: "var(--pos-text)" }} data-testid="location-active-name">
            {activeLoc?.name || storeName || "Store"}
          </div>
        </div>
        {!single && <ChevronDown className="w-3.5 h-3.5" style={{ color: "var(--pos-muted)" }} />}
      </button>

      {open && (
        <>
          {/* click-out shield */}
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-2 z-30 rounded-lg shadow-xl min-w-[280px]" data-testid="location-popover"
            style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
            <div className="p-2 max-h-64 overflow-y-auto">
              {list.map((l) => (
                <div key={l.id} className="flex items-center gap-2">
                  <button data-testid={`location-pick-${l.id}`} onClick={() => choose(l.id)}
                    className="pos-btn flex-1 text-left rounded-md px-3 py-2"
                    style={{ background: l.id === active ? "var(--pos-panel-2)" : "transparent" }}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm" style={{ color: "var(--pos-text)" }}>{l.name}</span>
                      {l.is_default && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "#0e2515", color: "#86efac" }}>Default</span>}
                    </div>
                    <div className="text-[10px]" style={{ color: "var(--pos-muted)" }}>{l.address || l.phone || "—"}</div>
                  </button>
                  {isManager && (
                    <>
                      {!l.is_default && (
                        <button onClick={() => setDefault(l.id)} title="Set default"
                          className="pos-btn text-[10px] px-1.5 py-0.5 rounded" style={{ color: "var(--pos-muted)" }}>Default</button>
                      )}
                      {list.length > 1 && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <button title="Delete location"
                              className="pos-btn p-1 rounded" style={{ color: "#fca5a5" }}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete location?</AlertDialogTitle>
                              <AlertDialogDescription>Delete "{l.name}"?</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => removeLoc(l.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
            {isManager && (
              <div className="p-2" style={{ borderTop: "1px solid var(--pos-border)" }}>
                <button data-testid="location-add-locked-btn" disabled
                  title="Adding a new location requires a paid plan upgrade — manage from the Dashboard at /biz."
                  className="pos-btn w-full flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-bold disabled:opacity-50"
                  style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)", border: "1px dashed var(--pos-border)" }}>
                  <span>🔒 Add location · go to Dashboard</span>
                </button>
              </div>
            )}
          </div>
        </>
      )}

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-md border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
          <DialogHeader><DialogTitle style={{ color: "var(--pos-text)" }}>Add new location</DialogTitle></DialogHeader>
          <Input data-testid="location-name-input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
          <Input placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
            <Input placeholder="Store #" value={form.store_number} onChange={(e) => setForm({ ...form, store_number: e.target.value })} style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
          </div>
          <div className="flex items-center justify-between rounded-md p-3" style={{ background: "var(--pos-panel-2)" }}>
            <span className="text-sm" style={{ color: "var(--pos-text)" }}>Set as default</span>
            <Switch checked={form.is_default} onCheckedChange={(v) => setForm({ ...form, is_default: v })} />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setNewOpen(false)} className="pos-btn h-9 px-4 rounded-md text-xs" style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)" }}>Cancel</button>
            <button data-testid="location-save-btn" onClick={createLoc} className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white" style={{ background: "var(--pos-accent)" }}>Create</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
