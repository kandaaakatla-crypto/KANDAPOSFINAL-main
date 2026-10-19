import React, { useState, useEffect } from "react";
import { staffApi } from "../../api/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "../ui/alert-dialog";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Pencil, PlusCircle, Trash2, KeyRound } from "lucide-react";
import { toast } from "sonner";

const ROLES = ["Manager", "Cashier", "Driver", "Kitchen"];
const EMPTY = { name: "", role: "Cashier", pin: "", phone: "", pay_type: "monthly", monthly_pay: "", hourly_rate: "", active: true };

export default function StaffScreen() {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [isNew, setIsNew] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const load = () => {
    setLoading(true);
    staffApi.list().then((d) => { setStaff(d); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // The server blanks salaries for dashboard users without the Payroll
  // permission; hide the pay UI and never send pay fields back in that case.
  const payHidden = staff.some((s) => s.pay_visible === false);

  const visible = staff.filter((s) => showInactive || s.active);
  const inactiveCount = staff.filter((s) => !s.active).length;

  const openNew = () => { setEditing({ ...EMPTY }); setIsNew(true); };
  const openEdit = (s) => { setEditing({ ...s, pin: "" }); setIsNew(false); };

  const save = async () => {
    if (!editing.name?.trim()) { toast.error("Name is required"); return; }
    if (isNew && !/^\d{4}$/.test(editing.pin || "")) { toast.error("PIN must be 4 digits"); return; }
    if (!isNew && editing.pin && !/^\d{4}$/.test(editing.pin)) { toast.error("New PIN must be 4 digits"); return; }
    try {
      const payload = {
        name: editing.name.trim(),
        role: editing.role,
        phone: editing.phone || "",
        active: editing.active !== false,
      };
      if (!payHidden) {
        payload.pay_type = editing.pay_type || "monthly";
        payload.monthly_pay = parseFloat(editing.monthly_pay || 0) || 0;
        payload.hourly_rate = parseFloat(editing.hourly_rate || 0) || 0;
      }
      if (isNew || editing.pin) payload.pin = editing.pin;
      if (isNew) {
        await staffApi.create(payload);
        toast.success(`${payload.name} added`);
      } else {
        await staffApi.update(editing.id, payload);
        toast.success("Saved");
      }
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    }
  };

  const deactivate = async (s) => {
    try {
      await staffApi.remove(s.id);
      toast.success(`${s.name} deactivated`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  return (
    <div className="h-full flex flex-col" data-testid="staff-screen">
      <div className="flex items-center justify-between p-5">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--pos-text)" }}>Staff</h1>
          <p className="text-sm" style={{ color: "var(--pos-muted)" }}>Employees with PIN-based access to this store.</p>
        </div>
        <div className="flex items-center gap-3">
          {inactiveCount > 0 && (
            <button data-testid="staff-show-inactive-toggle" onClick={() => setShowInactive((v) => !v)}
              className="pos-btn h-9 px-3 rounded-md text-xs font-medium"
              style={{ background: showInactive ? "var(--pos-panel-2)" : "transparent", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
              {showInactive ? "Hide" : "Show"} inactive ({inactiveCount})
            </button>
          )}
          <button data-testid="staff-add-btn" onClick={openNew}
            className="pos-btn h-10 px-4 rounded-md text-xs font-bold text-white flex items-center gap-2"
            style={{ background: "var(--pos-accent)" }}>
            <PlusCircle className="w-4 h-4" /> Add Employee
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-5 pb-5">
        <table className="w-full text-sm hidden md:table">
          <thead style={{ color: "var(--pos-muted)" }}>
            <tr style={{ borderBottom: "1px solid var(--pos-border)" }}>
              <th className="text-left py-2 px-3 uppercase text-[11px] tracking-wider">Name</th>
              <th className="text-left py-2 px-3 uppercase text-[11px] tracking-wider">Role</th>
              <th className="text-left py-2 px-3 uppercase text-[11px] tracking-wider">Phone</th>
              {!payHidden && <th className="text-right py-2 px-3 uppercase text-[11px] tracking-wider">Compensation</th>}
              <th className="text-center py-2 px-3 uppercase text-[11px] tracking-wider">Active</th>
              <th className="w-32 py-2 px-3"></th>
            </tr>
          </thead>
          <tbody style={{ color: "var(--pos-text)" }}>
            {loading && <tr><td colSpan={6} className="text-center py-8" style={{ color: "var(--pos-muted)" }}>Loading…</td></tr>}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8" style={{ color: "var(--pos-muted)" }}>No employees yet — click Add to create one.</td></tr>
            )}
            {visible.map((s) => (
              <tr key={s.id} data-testid={`staff-row-${s.id}`} style={{ borderTop: "1px solid var(--pos-border)" }}>
                <td className="py-3 px-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "var(--pos-blue)" }}>{s.initials}</div>
                  {s.name}
                </td>
                <td className="py-3 px-3" style={{ color: "var(--pos-muted)" }}>{s.role}</td>
                <td className="py-3 px-3" style={{ color: "var(--pos-muted)" }}>{s.phone || "—"}</td>
              {!payHidden && (
              <td className="py-3 px-3 text-right tabular-nums">
                {s.pay_type === "monthly"
                  ? (s.monthly_pay ? `₹${s.monthly_pay.toLocaleString("en-IN")}/mo` : "—")
                  : (s.hourly_rate ? `₹${s.hourly_rate.toFixed(2)}/hr` : "—")}
              </td>
              )}
                <td className="py-3 px-3 text-center">
                  <span className="text-[11px] px-2 py-0.5 rounded-full" style={{
                    background: s.active ? "#0e2515" : "#2b1212",
                    color: s.active ? "#86efac" : "#fca5a5",
                  }}>{s.active ? "Active" : "Inactive"}</span>
                </td>
                <td className="py-3 px-3 text-right">
                  <button data-testid={`staff-edit-${s.id}`} onClick={() => openEdit(s)}
                    className="pos-btn p-2 rounded-md inline-flex" style={{ background: "var(--pos-panel-2)" }}>
                    <Pencil className="w-4 h-4" style={{ color: "var(--pos-text)" }} />
                  </button>
                  {s.active && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button data-testid={`staff-deactivate-${s.id}`}
                          className="pos-btn p-2 rounded-md inline-flex ml-2" style={{ background: "var(--pos-panel-2)" }}>
                          <Trash2 className="w-4 h-4" style={{ color: "var(--pos-text)" }} />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Deactivate {s.name}?</AlertDialogTitle>
                          <AlertDialogDescription>Their timesheets stay intact.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction data-testid={`staff-deactivate-confirm-${s.id}`} onClick={() => deactivate(s)}>Deactivate</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Mobile card list */}
        <div className="md:hidden">
          {loading && <div className="text-center py-8 text-sm" style={{ color: "var(--pos-muted)" }}>Loading…</div>}
          {!loading && visible.length === 0 && (
            <div className="text-center py-8 text-sm" style={{ color: "var(--pos-muted)" }}>No employees yet — tap Add to create one.</div>
          )}
          <div className="divide-y" style={{ borderColor: "var(--pos-border)" }}>
            {visible.map((s) => (
              <div key={s.id} data-testid={`staff-row-${s.id}`} className="py-3 flex flex-col gap-2" style={{ color: "var(--pos-text)" }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: "var(--pos-blue)" }}>{s.initials}</div>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{s.name}</div>
                      <div className="text-xs" style={{ color: "var(--pos-muted)" }}>{s.role}{s.phone ? ` · ${s.phone}` : ""}</div>
                    </div>
                  </div>
                  <span className="text-[11px] px-2 py-0.5 rounded-full shrink-0" style={{
                    background: s.active ? "#0e2515" : "#2b1212",
                    color: s.active ? "#86efac" : "#fca5a5",
                  }}>{s.active ? "Active" : "Inactive"}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm tabular-nums" style={{ color: "var(--pos-muted)" }}>
                    {payHidden ? "" : s.pay_type === "monthly"
                      ? (s.monthly_pay ? `₹${s.monthly_pay.toLocaleString("en-IN")}/mo` : "—")
                      : (s.hourly_rate ? `₹${s.hourly_rate.toFixed(2)}/hr` : "—")}
                  </div>
                  <div className="flex items-center gap-2">
                    <button data-testid={`staff-edit-${s.id}`} onClick={() => openEdit(s)}
                      className="pos-btn w-10 h-10 rounded-md flex items-center justify-center" style={{ background: "var(--pos-panel-2)" }}>
                      <Pencil className="w-4 h-4" style={{ color: "var(--pos-text)" }} />
                    </button>
                    {s.active && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button data-testid={`staff-deactivate-${s.id}`}
                            className="pos-btn w-10 h-10 rounded-md flex items-center justify-center" style={{ background: "var(--pos-panel-2)" }}>
                            <Trash2 className="w-4 h-4" style={{ color: "var(--pos-text)" }} />
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Deactivate {s.name}?</AlertDialogTitle>
                            <AlertDialogDescription>Their timesheets stay intact.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction data-testid={`staff-deactivate-confirm-${s.id}`} onClick={() => deactivate(s)}>Deactivate</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} data-testid="staff-modal">
          <DialogHeader><DialogTitle style={{ color: "var(--pos-text)" }}>{isNew ? "Add Employee" : `Edit ${editing?.name}`}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <label className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Name</label>
                <Input data-testid="staff-name-input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Role</label>
                  <Select value={editing.role} onValueChange={(v) => setEditing({ ...editing, role: v })}>
                    <SelectTrigger data-testid="staff-role-select" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider flex items-center gap-1" style={{ color: "var(--pos-muted)" }}>
                    <KeyRound className="w-3 h-3" /> {isNew ? "PIN (4 digits)" : "Rotate PIN"}
                  </label>
                  <Input data-testid="staff-pin-input" value={editing.pin} maxLength={4} type="password" inputMode="numeric"
                    placeholder={isNew ? "" : "leave blank to keep"}
                    onChange={(e) => setEditing({ ...editing, pin: e.target.value.replace(/\D/g, "") })}
                    className="tracking-widest" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Phone</label>
                  <Input data-testid="staff-phone-input" value={editing.phone || ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                    style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
                </div>
                {!payHidden && (<div>
                  <label className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Pay type</label>
                  <Select value={editing.pay_type || "monthly"} onValueChange={(v) => setEditing({ ...editing, pay_type: v })}>
                    <SelectTrigger data-testid="staff-paytype-select" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly salary</SelectItem>
                      <SelectItem value="hourly">Hourly rate</SelectItem>
                    </SelectContent>
                  </Select>
                </div>)}
              </div>
              {payHidden ? null : (editing.pay_type || "monthly") === "monthly" ? (
                <div>
                  <label className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Monthly salary (₹)</label>
                  <Input data-testid="staff-monthly-input" type="number" step="500" value={editing.monthly_pay}
                    onChange={(e) => setEditing({ ...editing, monthly_pay: e.target.value })}
                    style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
                  <p className="text-[10px] mt-1" style={{ color: "var(--pos-muted)" }}>Labour cost reports normalise this to ₹{((parseFloat(editing.monthly_pay) || 0) / 234).toFixed(2)}/hr (26 days × 9h).</p>
                </div>
              ) : (
                <div>
                  <label className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Hourly rate (₹)</label>
                  <Input data-testid="staff-rate-input" type="number" step="0.5" value={editing.hourly_rate}
                    onChange={(e) => setEditing({ ...editing, hourly_rate: e.target.value })}
                    style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
                </div>
              )}
              <div className="flex items-center justify-between rounded-md p-3" style={{ background: "var(--pos-panel-2)" }}>
                <div>
                  <div className="text-sm font-medium" style={{ color: "var(--pos-text)" }}>Active</div>
                  <div className="text-xs" style={{ color: "var(--pos-muted)" }}>Inactive employees can&apos;t punch in or log in.</div>
                </div>
                <Switch data-testid="staff-active-switch" checked={editing.active !== false}
                  onCheckedChange={(v) => setEditing({ ...editing, active: v })} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setEditing(null)} className="pos-btn h-9 px-4 rounded-md text-xs"
                  style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)" }}>Cancel</button>
                <button data-testid="staff-save-btn" onClick={save} className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white"
                  style={{ background: "var(--pos-accent)" }}>Save</button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
