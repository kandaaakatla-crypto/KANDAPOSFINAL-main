import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { couponsApi } from "../../api/client";
import { Tag, Plus, Trash2, Loader2, Percent, IndianRupee } from "lucide-react";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "../ui/alert-dialog";

const EMPTY = { code: "", kind: "percent", value: "", valid_from: "", valid_to: "", max_uses: "", min_subtotal: "" };

/**
 * Restaurant Dashboard → Coupons. Manager-managed promo codes consumed at
 * checkout (the apply/validate logic already lives in backend/routes/coupons.py
 * and the POS checkout — this screen is purely the create/list/toggle/delete
 * management surface that was missing).
 */
export default function DashCoupons() {
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    couponsApi.list().then(setCoupons).catch(() => toast.error("Could not load coupons")).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    const code = form.code.trim().toUpperCase();
    const value = Number(form.value);
    if (!code) { toast.error("Code is required"); return; }
    if (!(value > 0)) { toast.error("Value must be positive"); return; }
    if (form.kind === "percent" && value > 100) { toast.error("Percent value cannot exceed 100"); return; }
    setCreating(true);
    try {
      await couponsApi.create({
        code, kind: form.kind, value,
        valid_from: form.valid_from ? `${form.valid_from}T00:00:00` : null,
        valid_to: form.valid_to ? `${form.valid_to}T23:59:59` : null,
        max_uses: form.max_uses ? Math.round(Number(form.max_uses)) : null,
        min_subtotal: form.min_subtotal ? Number(form.min_subtotal) : 0,
        active: true,
      });
      toast.success(`Coupon ${code} created`);
      setForm(EMPTY);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not create coupon");
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (c) => {
    try {
      await couponsApi.update(c.id, { active: !c.active });
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update coupon");
    }
  };

  const remove = async (c) => {
    try {
      await couponsApi.remove(c.id);
      toast.success(`Coupon ${c.code} deleted`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not delete coupon");
    }
  };

  return (
    <div className="p-6 space-y-6" data-testid="dash-coupons">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Tag className="w-6 h-6" style={{ color: "#7dd3fc" }} />
          Coupons
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>
          Promo codes staff can apply at checkout — percent or flat ₹ off, with optional usage limits and a minimum spend.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* List */}
        <div className="lg:col-span-2 rounded-xl overflow-hidden" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--pos-border)" }}>
            <div className="text-sm font-bold text-white">All coupons</div>
          </div>
          <div className="p-5">
            {loading && <div className="text-sm" style={{ color: "var(--pos-muted)" }}>Loading…</div>}
            {!loading && coupons.length === 0 && (
              <div className="text-sm text-center py-8" style={{ color: "var(--pos-muted)" }}>No coupons yet — create one on the right.</div>
            )}
            <div className="space-y-1.5">
              {coupons.map((c) => (
                <div key={c.id} data-testid={`coupon-row-${c.id}`} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 flex-wrap"
                  style={{ background: "var(--pos-panel-2)" }}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-bold tracking-wider">{c.code}</span>
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: "var(--pos-panel)", color: "var(--pos-muted)" }}>
                        {c.kind === "percent" ? `${c.value}%` : `₹${c.value}`} off
                      </span>
                      {!c.active && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: "#3a1515", color: "#f87171" }}>Inactive</span>}
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: "var(--pos-muted)" }}>
                      {c.used_count}{c.max_uses ? ` / ${c.max_uses}` : ""} used
                      {c.min_subtotal > 0 && ` · min ₹${c.min_subtotal}`}
                      {(c.valid_from || c.valid_to) && ` · ${c.valid_from ? c.valid_from.slice(0, 10) : "…"} → ${c.valid_to ? c.valid_to.slice(0, 10) : "…"}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button data-testid={`coupon-toggle-${c.id}`} onClick={() => toggleActive(c)}
                      className="pos-btn h-7 px-2.5 rounded-md text-[11px] font-bold"
                      style={{ background: c.active ? "var(--pos-panel)" : "var(--pos-accent)", color: c.active ? "var(--pos-muted)" : "#fff", border: "1px solid var(--pos-border)" }}>
                      {c.active ? "Deactivate" : "Activate"}
                    </button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button data-testid={`coupon-delete-${c.id}`}
                          className="pos-btn w-7 h-7 rounded-md flex items-center justify-center" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete coupon?</AlertDialogTitle>
                          <AlertDialogDescription>Delete coupon {c.code}?</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction data-testid={`coupon-delete-confirm-${c.id}`} onClick={() => remove(c)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Create */}
        <div className="rounded-xl overflow-hidden h-fit" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--pos-border)" }}>
            <div className="text-sm font-bold text-white">New coupon</div>
          </div>
          <div className="p-5 space-y-3">
            <Field label="Code">
              <input data-testid="coupon-form-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="SAVE20" className="w-full rounded px-2 py-1.5 text-sm text-white tracking-wider outline-none" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Type">
                <div className="flex gap-1.5">
                  <button data-testid="coupon-kind-percent" onClick={() => setForm({ ...form, kind: "percent" })}
                    className="pos-btn flex-1 h-9 rounded text-xs font-bold flex items-center justify-center gap-1"
                    style={{ background: form.kind === "percent" ? "var(--pos-accent)" : "var(--pos-panel-2)", color: form.kind === "percent" ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                    <Percent className="w-3 h-3" /> %
                  </button>
                  <button data-testid="coupon-kind-flat" onClick={() => setForm({ ...form, kind: "flat" })}
                    className="pos-btn flex-1 h-9 rounded text-xs font-bold flex items-center justify-center gap-1"
                    style={{ background: form.kind === "flat" ? "var(--pos-accent)" : "var(--pos-panel-2)", color: form.kind === "flat" ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                    <IndianRupee className="w-3 h-3" /> Flat
                  </button>
                </div>
              </Field>
              <Field label="Value">
                <input data-testid="coupon-form-value" type="number" min={0} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })}
                  placeholder={form.kind === "percent" ? "20" : "100"} className="w-full rounded px-2 py-1.5 text-sm text-white outline-none h-9" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Valid from"><input data-testid="coupon-form-from" type="date" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
                className="w-full rounded px-2 py-1.5 text-sm text-white outline-none" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} /></Field>
              <Field label="Valid to"><input data-testid="coupon-form-to" type="date" value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })}
                className="w-full rounded px-2 py-1.5 text-sm text-white outline-none" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} /></Field>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Max uses (optional)"><input data-testid="coupon-form-max-uses" type="number" min={1} value={form.max_uses} onChange={(e) => setForm({ ...form, max_uses: e.target.value })}
                placeholder="Unlimited" className="w-full rounded px-2 py-1.5 text-sm text-white outline-none" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} /></Field>
              <Field label="Min subtotal (₹)"><input data-testid="coupon-form-min-subtotal" type="number" min={0} value={form.min_subtotal} onChange={(e) => setForm({ ...form, min_subtotal: e.target.value })}
                placeholder="0" className="w-full rounded px-2 py-1.5 text-sm text-white outline-none" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} /></Field>
            </div>

            <button data-testid="coupon-create-btn" onClick={create} disabled={creating}
              className="pos-btn w-full mt-1 px-3 py-2 rounded-lg text-xs text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
              style={{ background: "var(--pos-accent)" }}>
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Create coupon
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
