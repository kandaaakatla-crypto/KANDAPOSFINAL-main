import React, { useEffect, useState } from "react";
import { useDash, canAddLocation } from "../../store/DashContext";
import { MapPin, Plus, CheckCircle2, Pencil, Trash2, X, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "../ui/alert-dialog";
import PlanUpgradeDialog from "../PlanUpgradeDialog";
import { plansApi } from "../../api/client";

/**
 * Locations grid for the Restaurant Owner Dashboard.
 * Owners can add / edit / retire multiple stores under the same brand.
 * Managers/area-managers see only their scoped locations, read-only.
 */
export default function DashLocations() {
  const { user, api } = useDash();
  const [locations, setLocations] = useState([]);
  const [editing, setEditing] = useState(null);
  const [planInfo, setPlanInfo] = useState(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const load = () =>
    api.get("/locations").then((r) => {
      const allowed = user.location_ids && user.location_ids.length
        ? r.data.filter((l) => user.location_ids.includes(l.id))
        : r.data;
      setLocations(allowed);
    }).catch(() => {});

  const loadPlan = () => plansApi.list().then(setPlanInfo).catch(() => {});

  useEffect(() => { load(); loadPlan(); }, [api, user.location_ids]);

  const canManage = canAddLocation(user);

  const save = async () => {
    const body = { name: (editing.name || "").trim(), address: editing.address || "",
                   phone: editing.phone || "", store_number: editing.store_number || "",
                   is_default: !!editing.is_default, active: editing.active !== false };
    if (!body.name) { toast.error("Name is required"); return; }
    try {
      if (editing.id) {
        await api.patch(`/locations/${editing.id}`, body);
        toast.success("Location updated");
      } else {
        await api.post("/locations", body);
        toast.success("Location added to your brand");
      }
      setEditing(null);
      load();
      loadPlan();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      // Payment required for another location → open the pay-per-slot dialog.
      if (typeof detail === "object" && detail?.code === "payment_required") {
        setEditing(null);
        setShowUpgrade(true);
        toast.warning(`Add-on payment required for a new location (₹${Math.round(detail.price)}).`);
      } else {
        toast.error(typeof detail === "string" ? detail : "Save failed");
      }
    }
  };

  const remove = async (loc) => {
    try {
      await api.delete(`/locations/${loc.id}`);
      toast.success("Location deleted");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete failed");
    }
  };

  return (
    <div className="p-6 space-y-4" data-testid="dash-locations">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Locations</h1>
          <p className="text-sm" style={{ color: "var(--pos-muted)" }}>
            {canManage
              ? "All stores under your brand. Add as many as your plan allows."
              : "Stores you have access to."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {planInfo && (
            <div className="text-[11px] px-3 py-1.5 rounded-md flex items-center gap-1.5"
              style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
              <Sparkles className="w-3 h-3" style={{ color: "#a78bfa" }} />
              <span className="text-white">
                {planInfo.used}/{planInfo.total_slots} locations
              </span>
              <span style={{ color: "var(--pos-muted)" }}>
                · ₹{Math.round(planInfo.price_per_location)} each
              </span>
            </div>
          )}
          {canManage && (
            <button data-testid="dash-add-location"
              onClick={() => {
                if (planInfo && planInfo.remaining <= 0) { setShowUpgrade(true); return; }
                setEditing({ is_default: false, active: true });
              }}
              className="pos-btn h-10 px-4 rounded-md text-xs font-bold flex items-center gap-2 text-white"
              style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)" }}>
              <Plus className="w-4 h-4" /> Add location
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {locations.length === 0 && (
          <p className="text-sm col-span-full text-center py-8" style={{ color: "var(--pos-muted)" }}>No locations yet.</p>
        )}
        {locations.map((l) => (
          <div key={l.id} data-testid={`dash-loc-${l.id}`} className="rounded-xl p-4"
            style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <MapPin className="w-4 h-4 shrink-0" style={{ color: "var(--pos-accent)" }} />
                <span className="font-bold text-white truncate">{l.name}</span>
                {l.is_default && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "#0e2515", color: "#86efac" }}>Default</span>}
                {l.active === false && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "#2b1212", color: "#fca5a5" }}>Inactive</span>}
              </div>
              {canManage && (
                <div className="flex gap-1 shrink-0 ml-2">
                  <button data-testid={`edit-loc-${l.id}`} onClick={() => setEditing({ ...l })}
                    className="pos-btn p-1.5 rounded" style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  {!l.is_default && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button data-testid={`del-loc-${l.id}`}
                          className="pos-btn p-1.5 rounded" style={{ background: "var(--pos-panel-2)", color: "#f87171" }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete location?</AlertDialogTitle>
                          <AlertDialogDescription>Delete "{l.name}"? This can't be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction data-testid={`del-loc-confirm-${l.id}`} onClick={() => remove(l)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-1 text-xs" style={{ color: "var(--pos-muted)" }}>
              <div>📍 {l.address || "—"}</div>
              <div>📞 {l.phone || "—"}</div>
              <div>🏷 Store #{l.store_number || "—"}</div>
            </div>
            {l.active !== false && (
              <div className="mt-3 text-[10px] flex items-center gap-1" style={{ color: "#86efac" }}>
                <CheckCircle2 className="w-3 h-3" /> Active
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent data-testid="location-dialog" className="max-w-md border"
          style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
          <DialogHeader>
            <DialogTitle className="text-white">
              {editing?.id ? "Edit location" : "Add a new location"}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <Field label="Name *" testid="loc-name"
                value={editing.name || ""} onChange={(v) => setEditing({ ...editing, name: v })} />
              <Field label="Address" testid="loc-address"
                value={editing.address || ""} onChange={(v) => setEditing({ ...editing, address: v })} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Phone" testid="loc-phone"
                  value={editing.phone || ""} onChange={(v) => setEditing({ ...editing, phone: v })} />
                <Field label="Store #" testid="loc-storenum"
                  value={editing.store_number || ""} onChange={(v) => setEditing({ ...editing, store_number: v })} />
              </div>
              <label className="flex items-center gap-2 text-xs text-white cursor-pointer">
                <input type="checkbox" data-testid="loc-is-default" className="accent-purple-500"
                  checked={!!editing.is_default}
                  onChange={(e) => setEditing({ ...editing, is_default: e.target.checked })} />
                Make this the default location
              </label>
              {editing.id && (
                <label className="flex items-center gap-2 text-xs text-white cursor-pointer">
                  <input type="checkbox" data-testid="loc-active" className="accent-emerald-500"
                    checked={editing.active !== false}
                    onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
                  Active (uncheck to retire without deleting)
                </label>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button data-testid="loc-cancel" onClick={() => setEditing(null)}
                  className="pos-btn px-3 py-2 rounded text-xs text-white"
                  style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                  <X className="w-3 h-3 inline mr-1" /> Cancel
                </button>
                <button data-testid="loc-save" onClick={save}
                  className="pos-btn px-4 py-2 rounded text-xs font-bold text-white"
                  style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)" }}>
                  {editing.id ? "Save changes" : "Add location"}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <PlanUpgradeDialog open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        onUpgraded={() => { setShowUpgrade(false); loadPlan(); load(); }} />
    </div>
  );
}

function Field({ label, value, onChange, testid }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>{label}</label>
      <input data-testid={testid} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded px-3 py-2 text-sm text-white outline-none mt-1"
        style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} />
    </div>
  );
}
