import React, { useEffect, useState } from "react";
import { useDash } from "../../store/DashContext";
import { storeDetailsApi } from "../../api/client";
import { FileText, Loader2 } from "lucide-react";
import { Input } from "../ui/input";
import { toast } from "sonner";

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const FSSAI_RE = /^\d{14}$/;

const fromStore = (s = {}, fallbackName = "") => ({
  name: s.name || fallbackName, address: s.address || "", phone: s.phone || "",
  gstin: (s.tax_id || "").replace(/^GSTIN\s*/i, ""), fssai: s.fssai || "", footer: s.footer || "",
});

export default function DashBusiness() {
  const { tenantInfo } = useDash();
  const [form, setForm] = useState(() => fromStore(tenantInfo?.store, tenantInfo?.name));
  const [busy, setBusy] = useState(false);
  // tenantInfo arrives after first render on a direct visit.
  useEffect(() => { if (tenantInfo) setForm(fromStore(tenantInfo.store, tenantInfo.name)); }, [tenantInfo]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const gstin = form.gstin.trim().toUpperCase().replace(/\s/g, "");
  const fssai = form.fssai.trim().replace(/\s/g, "");
  const gstinBad = gstin !== "" && !GSTIN_RE.test(gstin);
  const fssaiBad = fssai !== "" && !FSSAI_RE.test(fssai);

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Enter your restaurant's name"); return; }
    if (gstinBad || fssaiBad) return;
    setBusy(true);
    try {
      await storeDetailsApi.save({ ...form, gstin, fssai });
      toast.success("Business details saved. New bills will show them.");
    } catch (err) {
      toast.error(err?.response?.data?.detail?.[0]?.msg || err?.response?.data?.detail || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const field = (k, label, props = {}, error) => (
    <div>
      <label htmlFor={`biz-${k}`} className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>{label}</label>
      <Input id={`biz-${k}`} data-testid={`biz-${k}`} value={form[k]} onChange={set(k)} {...props}
        className="h-10 mt-1" style={{ background: "var(--pos-panel-2)", borderColor: error ? "#f87171" : "var(--pos-border)", color: "var(--pos-text)" }} />
      {error && <div className="text-xs mt-1" role="alert" style={{ color: "#f87171" }}>{error}</div>}
    </div>
  );

  return (
    <div className="p-6 space-y-6 max-w-2xl" data-testid="dash-business">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: "var(--pos-text)" }}>
          <FileText className="w-6 h-6" style={{ color: "var(--pos-accent)" }} /> Business Details
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>
          Printed at the top of every bill and invoice for this store.
        </p>
      </div>
      <form onSubmit={save} className="rounded-xl p-5 space-y-4" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
        {field("name", "Restaurant name", { maxLength: 80, required: true })}
        {field("address", "Address", { maxLength: 300 })}
        {field("phone", "Phone", { maxLength: 20, inputMode: "tel" })}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field("gstin", "GSTIN (if registered)", { maxLength: 15, placeholder: "e.g. 37AAPFU0939F1ZV", autoCapitalize: "characters" },
            gstinBad ? "A GSTIN is 15 characters, like 37AAPFU0939F1ZV." : null)}
          {field("fssai", "FSSAI licence number", { maxLength: 14, inputMode: "numeric", placeholder: "14 digits" },
            fssaiBad ? "An FSSAI number is 14 digits." : null)}
        </div>
        {field("footer", "Bill footer", { maxLength: 200, placeholder: "Thank you, visit again!" })}
        <button type="submit" data-testid="biz-save" disabled={busy || gstinBad || fssaiBad}
          className="pos-btn h-11 px-6 rounded-lg font-bold text-white disabled:opacity-50 flex items-center gap-2" style={{ background: "var(--pos-accent)" }}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </button>
      </form>
    </div>
  );
}
