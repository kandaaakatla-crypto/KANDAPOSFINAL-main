import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { ShieldCheck, Plus, KeyRound, Loader2, Copy, Trash2 } from "lucide-react";
import { useDash, canManageTeam } from "../../store/DashContext";
import { teamApi } from "../../api/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Switch } from "../ui/switch";
import { Checkbox } from "../ui/checkbox";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "../ui/alert-dialog";

const ROLE_LABEL = { manager: "Store Manager", area_manager: "Area Manager" };
const INPUT_STYLE = { background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" };

/**
 * Restaurant Dashboard → Team & access (owner only). The owner decides who
 * gets a dashboard login, which stores each manager / area manager can reach
 * (a store manager gets exactly one), and which sections they can use. The
 * API enforces all of it (backend/dash_access.py), so this screen is only the
 * editor; changes apply to people already signed in on their next action.
 */
export default function DashTeam() {
  const { user } = useDash();
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null); // member draft, or {} for new
  const [saving, setSaving] = useState(false);
  const [tempPw, setTempPw] = useState(null); // {email, password}

  const load = () => teamApi.list().then(setData).catch((e) => toast.error(e?.response?.data?.detail || "Could not load team"));
  useEffect(() => { if (canManageTeam(user)) load(); }, []); // eslint-disable-line

  if (!canManageTeam(user)) return <Navigate to="/dashboard" replace />;

  const storeName = (id) => data?.stores.find((s) => s.id === id)?.name || id;

  const startNew = () => setEditing({
    isNew: true, email: "", name: "", dash_role: "manager",
    store_ids: data?.stores?.length ? [user.tenant_id] : [],
    permissions: defaultsFor("manager"),
  });

  const defaultsFor = (role) => Object.fromEntries((data?.permissions || []).map((p) =>
    [p.key, role === "area_manager" ? p.area_manager_default : p.manager_default]));

  const setRole = (role) => setEditing((d) => ({
    ...d, dash_role: role,
    // A store manager has exactly one store — keep the first one ticked.
    store_ids: role === "manager" ? d.store_ids.slice(0, 1) : d.store_ids,
    permissions: d.isNew ? defaultsFor(role) : d.permissions,
  }));

  const toggleStore = (id) => setEditing((d) => {
    if (d.dash_role === "manager") return { ...d, store_ids: [id] };
    const has = d.store_ids.includes(id);
    return { ...d, store_ids: has ? d.store_ids.filter((s) => s !== id) : [...d.store_ids, id] };
  });

  const save = async () => {
    if (!editing.store_ids.length) { toast.error("Pick at least one store"); return; }
    setSaving(true);
    try {
      if (editing.isNew) {
        const r = await teamApi.create({
          email: editing.email, name: editing.name, dash_role: editing.dash_role,
          store_ids: editing.store_ids, permissions: editing.permissions,
        });
        setTempPw({ email: r.member.email, password: r.temp_password });
        toast.success(`${r.member.name} added`);
      } else {
        await teamApi.update(editing.id, {
          name: editing.name, dash_role: editing.dash_role,
          store_ids: editing.store_ids, permissions: editing.permissions,
        });
        toast.success("Access updated");
      }
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (m, active) => {
    try {
      await teamApi.update(m.id, { active });
      toast.success(active ? `${m.name} can sign in again` : `${m.name} signed out and blocked`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update");
    }
  };

  const removeMember = async (m) => {
    try {
      await teamApi.remove(m.id);
      toast.success(`${m.name} removed`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not remove");
    }
  };

  const resetPassword = async (m) => {
    try {
      const r = await teamApi.resetPassword(m.id);
      setTempPw({ email: m.email, password: r.temp_password });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not reset password");
    }
  };

  return (
    <div className="p-6 space-y-4" data-testid="dash-team">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: "var(--pos-text)" }}>
            <ShieldCheck className="w-5 h-5" /> Team & access
          </h1>
          <p className="text-sm" style={{ color: "var(--pos-muted)" }}>
            Choose which stores and which parts of the dashboard each manager can see. Only you can see every store.
          </p>
        </div>
        <button data-testid="team-add-btn" onClick={startNew} disabled={!data}
          className="pos-btn h-9 px-3 rounded-md text-xs font-bold flex items-center gap-1.5 text-white shrink-0" style={{ background: "var(--pos-accent)" }}>
          <Plus className="w-3.5 h-3.5" /> Add manager
        </button>
      </div>

      {!data ? (
        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--pos-muted)" }}><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : data.members.length === 0 ? (
        <div className="rounded-lg p-6 text-sm" style={{ background: "var(--pos-panel)", color: "var(--pos-muted)" }}>
          No managers yet. Add a store manager or area manager to give them their own login.
        </div>
      ) : (
        <div className="space-y-2">
          {data.members.map((m) => {
            const allowed = data.permissions.filter((p) => m.permissions[p.key]).map((p) => p.label);
            return (
              <div key={m.id} data-testid={`team-member-${m.id}`} className="rounded-lg p-4 flex flex-col md:flex-row md:items-center gap-3"
                style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)", opacity: m.active ? 1 : 0.6 }}>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>
                    {m.name} <span className="text-[11px] font-medium" style={{ color: "var(--pos-muted)" }}>· {ROLE_LABEL[m.dash_role]}{!m.active && " · blocked"}</span>
                  </div>
                  <div className="text-xs" style={{ color: "var(--pos-muted)" }}>{m.email}</div>
                  <div className="text-xs mt-1" style={{ color: "var(--pos-text)" }}>
                    Stores: {m.store_ids.map(storeName).join(", ")}
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: "var(--pos-muted)" }}>
                    Can use: {allowed.length ? allowed.join(", ") : "day-to-day screens only"}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button data-testid={`team-edit-${m.id}`} onClick={() => setEditing({ ...m, permissions: { ...m.permissions } })}
                    className="pos-btn h-8 px-3 rounded-md text-xs font-bold" style={INPUT_STYLE}>Edit access</button>
                  <button data-testid={`team-reset-${m.id}`} onClick={() => resetPassword(m)} title="Reset password"
                    className="pos-btn h-8 w-8 rounded-md flex items-center justify-center" style={INPUT_STYLE}><KeyRound className="w-3.5 h-3.5" /></button>
                  <label className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--pos-muted)" }}>
                    <Switch data-testid={`team-active-${m.id}`} checked={m.active} onCheckedChange={(v) => setActive(m, v)} /> Active
                  </label>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button data-testid={`team-delete-${m.id}`} title="Remove manager" aria-label={`Remove ${m.name}`}
                        className="pos-btn h-8 w-8 rounded-md flex items-center justify-center" style={{ ...INPUT_STYLE, color: "#f87171" }}><Trash2 className="w-3.5 h-3.5" /></button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove {m.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Their dashboard login is deleted and any open session ends immediately. To keep the account but stop them signing in, turn off Active instead.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction data-testid={`team-delete-confirm-${m.id}`} onClick={() => removeMember(m)}>Remove</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }}>
          <DialogHeader><DialogTitle>{editing?.isNew ? "Add manager" : `Access for ${editing?.name}`}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              {editing.isNew && (
                <input data-testid="team-form-email" aria-label="Email" value={editing.email} placeholder="Email"
                  onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                  className="w-full rounded px-2 py-1.5 text-sm outline-none" style={INPUT_STYLE} />
              )}
              <input data-testid="team-form-name" aria-label="Name" value={editing.name} placeholder="Name"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="w-full rounded px-2 py-1.5 text-sm outline-none" style={INPUT_STYLE} />

              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--pos-muted)" }}>Role</div>
                <div className="flex gap-1.5">
                  {Object.entries(ROLE_LABEL).map(([role, label]) => (
                    <button key={role} data-testid={`team-role-${role}`} onClick={() => setRole(role)}
                      className="pos-btn flex-1 h-9 rounded text-xs font-bold"
                      style={{ ...INPUT_STYLE, background: editing.dash_role === role ? "var(--pos-accent)" : "var(--pos-panel-2)", color: editing.dash_role === role ? "#fff" : "var(--pos-muted)" }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--pos-muted)" }}>
                  {editing.dash_role === "manager" ? "Store (one)" : "Stores"}
                </div>
                <div className="space-y-1.5">
                  {data.stores.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox data-testid={`team-store-${s.id}`} checked={editing.store_ids.includes(s.id)} onCheckedChange={() => toggleStore(s.id)} />
                      {s.name}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--pos-muted)" }}>What they can see and change</div>
                <div className="space-y-1.5">
                  {data.permissions.map((p) => (
                    <label key={p.key} className="flex items-center justify-between gap-3 text-sm rounded p-2" style={{ background: "var(--pos-panel-2)" }}>
                      {p.label}
                      <Switch data-testid={`team-perm-${p.key}`} checked={!!editing.permissions[p.key]}
                        onCheckedChange={(v) => setEditing({ ...editing, permissions: { ...editing.permissions, [p.key]: v } })} />
                    </label>
                  ))}
                </div>
              </div>

              <button data-testid="team-form-save" onClick={save} disabled={saving}
                className="pos-btn w-full h-10 rounded-md text-sm font-bold text-white flex items-center justify-center gap-2" style={{ background: "var(--pos-accent)" }}>
                {saving && <Loader2 className="w-4 h-4 animate-spin" />} {editing.isNew ? "Add and create login" : "Save access"}
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!tempPw} onOpenChange={(o) => !o && setTempPw(null)}>
        <DialogContent className="max-w-sm" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }}>
          <DialogHeader><DialogTitle>Temporary password</DialogTitle></DialogHeader>
          {tempPw && (
            <div className="space-y-3 text-sm">
              <p style={{ color: "var(--pos-muted)" }}>
                Share this with {tempPw.email}. It's shown only once; they'll be asked to set their own password when they sign in.
              </p>
              <div className="flex items-center gap-2 rounded p-2 font-mono" style={INPUT_STYLE}>
                <span className="flex-1 break-all" data-testid="team-temp-password">{tempPw.password}</span>
                <button onClick={() => { navigator.clipboard?.writeText(tempPw.password); toast.success("Copied"); }}
                  className="pos-btn w-7 h-7 rounded flex items-center justify-center"><Copy className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
