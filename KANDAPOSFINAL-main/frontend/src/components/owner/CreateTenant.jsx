import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ownerData } from "../../api/ownerClient";
import { Input } from "../ui/input";
import { Plus, Loader2, Copy, CheckCircle2, ArrowRight } from "lucide-react";
import { toast } from "sonner";

const DASH_ROLE_LABEL = { owner: "Owner", area_manager: "Area Manager", manager: "Manager" };

export default function CreateTenant() {
  const nav = useNavigate();
  const [form, setForm] = useState({
    slug: "", name: "", contact_email: "", manager_name: "Manager", manager_pin: "",
    store: { name: "", address: "", phone: "", tax_id: "", footer: "Thank you for ordering!" },
    plan: "trial",
    business_type: "restaurant",
  });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const setStore = (k, v) => setForm((p) => ({ ...p, store: { ...p.store, [k]: v } }));

  const onSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const t = await ownerData.createTenant(form);
      toast.success(`${t.name} provisioned`);
      setCreated(t); // show the one-time dashboard credentials before navigating away
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not create tenant");
    } finally { setBusy(false); }
  };

  const fld = "h-10 text-white";
  const fldStyle = { background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" };

  if (created) {
    return (
      <div className="max-w-2xl space-y-5" data-testid="create-tenant-success">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <CheckCircle2 className="w-6 h-6" style={{ color: "var(--pos-accent)" }} /> {created.name} provisioned
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>
            Dashboard accounts were created automatically. These passwords are shown <b>only here, once</b> —
            copy them down now and hand them to the client. Each account is forced to set its own password on first login.
          </p>
        </div>
        <div className="rounded-xl p-4 space-y-2" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          {(created.dashboard_accounts || []).map((a) => (
            <div key={a.email} className="flex items-center justify-between gap-3 rounded-lg p-3" style={{ background: "var(--pos-panel-2)" }}>
              <div className="min-w-0">
                <div className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--pos-accent)" }}>{DASH_ROLE_LABEL[a.dash_role] || a.dash_role}</div>
                <div className="text-sm text-white font-mono truncate">{a.email}</div>
                <div className="text-sm text-white font-mono truncate">{a.password}</div>
              </div>
              <button type="button"
                onClick={() => { navigator.clipboard.writeText(`${a.email} / ${a.password}`); toast.success("Copied"); }}
                className="pos-btn h-9 px-3 rounded-md text-xs font-bold flex items-center gap-1.5 shrink-0"
                style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                <Copy className="w-3.5 h-3.5" /> Copy
              </button>
            </div>
          ))}
        </div>
        <button data-testid="create-tenant-continue" onClick={() => nav(`/owner/tenants/${created.id}`)}
          className="pos-btn h-11 px-5 rounded-lg font-bold text-white flex items-center gap-2"
          style={{ background: "var(--pos-accent)" }}>
          Continue to tenant <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-5" data-testid="create-tenant">
      <h1 className="text-2xl font-bold text-white">Provision a new tenant</h1>

      <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
        <div className="text-sm font-semibold text-white">Business type</div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { id: "restaurant", label: "Restaurant", desc: "Tables, kitchen display, packing, delivery dispatch, meal deals." },
            { id: "retail", label: "Retail store", desc: "Basket + barcode checkout. No tables or kitchen routing." },
          ].map((opt) => (
            <button key={opt.id} type="button" data-testid={`business-type-${opt.id}`} onClick={() => set("business_type", opt.id)}
              className="text-left rounded-lg p-3"
              style={{ background: form.business_type === opt.id ? "var(--pos-panel-2)" : "transparent", border: `1px solid ${form.business_type === opt.id ? "var(--pos-accent)" : "var(--pos-border)"}` }}>
              <div className="text-sm font-bold text-white">{opt.label}</div>
              <div className="text-[11px] mt-1" style={{ color: "var(--pos-muted)" }}>{opt.desc}</div>
            </button>
          ))}
        </div>
        <div className="text-[10px]" style={{ color: "var(--pos-muted)" }}>
          Every feature stays available afterwards — the store's own Manager/Owner can turn Tables, Kitchen Display, Packing, Dispatch, Meal Deals, or Pizza Sizing on or off independently from their Dashboard.
        </div>
      </div>

      <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
        <div className="text-sm font-semibold text-white">Identity</div>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Slug · subdomain</span>
            <Input data-testid="tenant-slug" required placeholder="xyzpizza" value={form.slug} onChange={(e) => set("slug", e.target.value.replace(/[^a-z0-9]/gi, "").toLowerCase())} className={fld} style={fldStyle} />
            <div className="text-[10px] mt-1" style={{ color: "var(--pos-muted)" }}>Will live at <code>{form.slug || "<slug>"}.kanda.app</code></div>
          </label>
          <label>
            <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Display name</span>
            <Input data-testid="tenant-name" required placeholder="XYZ Pizza" value={form.name} onChange={(e) => set("name", e.target.value)} className={fld} style={fldStyle} />
          </label>
          <label>
            <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Owner email (contact)</span>
            <Input data-testid="tenant-email" required type="email" placeholder="owner@xyzpizza.in" value={form.contact_email} onChange={(e) => set("contact_email", e.target.value)} className={fld} style={fldStyle} />
          </label>
          <label>
            <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Plan</span>
            <select value={form.plan} onChange={(e) => set("plan", e.target.value)} className="h-10 w-full rounded-md px-3 text-white" style={fldStyle}>
              <option value="trial">Trial</option>
              <option value="starter">Starter</option>
              <option value="growth">Growth</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </label>
        </div>
      </div>

      <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
        <div className="text-sm font-semibold text-white">Store / receipt branding</div>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2">
            <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Store name</span>
            <Input data-testid="store-name" required value={form.store.name} onChange={(e) => setStore("name", e.target.value)} className={fld} style={fldStyle} />
          </label>
          <label className="col-span-2">
            <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Address</span>
            <Input data-testid="store-address" required value={form.store.address} onChange={(e) => setStore("address", e.target.value)} className={fld} style={fldStyle} />
          </label>
          <label>
            <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Phone</span>
            <Input data-testid="store-phone" required value={form.store.phone} onChange={(e) => setStore("phone", e.target.value)} className={fld} style={fldStyle} />
          </label>
          <label>
            <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>GSTIN / VAT</span>
            <Input data-testid="store-tax" value={form.store.tax_id} onChange={(e) => setStore("tax_id", e.target.value)} className={fld} style={fldStyle} />
          </label>
        </div>
      </div>

      <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
        <div className="text-sm font-semibold text-white">Initial Manager account</div>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Manager name</span>
            <Input data-testid="manager-name" required value={form.manager_name} onChange={(e) => set("manager_name", e.target.value)} className={fld} style={fldStyle} />
          </label>
          <label>
            <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>PIN (4-6 digits)</span>
            <Input data-testid="manager-pin" required inputMode="numeric" pattern="[0-9]{4,6}" maxLength={6}
              value={form.manager_pin} onChange={(e) => set("manager_pin", e.target.value.replace(/\D/g, "").slice(0, 6))}
              className={fld} style={fldStyle} />
          </label>
        </div>
        <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>
          The Manager can add Cashiers and Drivers themselves from inside the POS once logged in.
        </div>
      </div>

      <button data-testid="create-tenant-submit" type="submit" disabled={busy}
        className="pos-btn h-11 px-5 rounded-lg font-bold text-white flex items-center gap-2 disabled:opacity-40"
        style={{ background: "var(--pos-accent)" }}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        Provision tenant
      </button>
    </form>
  );
}
