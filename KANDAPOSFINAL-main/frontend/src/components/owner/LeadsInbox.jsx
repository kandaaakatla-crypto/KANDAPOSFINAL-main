import React, { useEffect, useState } from "react";
import { ownerData } from "../../api/ownerClient";
import { Inbox, Loader2, Mail, MapPin, Phone, RefreshCw, Store } from "lucide-react";

const TYPE_LABEL = {
  demo: { label: "Demo request", color: "#f97316" },
  updates: { label: "Alpha waitlist", color: "#3b82f6" },
};

const BUSINESS_TYPE_LABEL = {
  restaurant: "Restaurant", cafe: "Café / bakery", cloud_kitchen: "Cloud kitchen", retail: "Retail store", other: "Other",
};

export default function LeadsInbox() {
  const [leads, setLeads] = useState([]);
  const [busy, setBusy] = useState(true);
  const [filterType, setFilterType] = useState("");

  const load = async () => {
    setBusy(true);
    const data = await ownerData.leads(filterType ? { type: filterType } : {});
    setLeads(data);
    setBusy(false);
  };
  useEffect(() => { load(); }, [filterType]); // eslint-disable-line

  return (
    <div data-testid="owner-leads-inbox" className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Inbox className="w-5 h-5" style={{ color: "var(--pos-accent)" }} />
          <h1 className="text-2xl font-bold" style={{ color: "var(--pos-text)" }}>Website leads</h1>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>{leads.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <select data-testid="leads-filter-type" value={filterType} onChange={(e) => setFilterType(e.target.value)}
            className="h-9 px-3 rounded-lg text-xs" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
            <option value="">All types</option>
            <option value="demo">Demo requests</option>
            <option value="updates">Alpha waitlist</option>
          </select>
          <button onClick={load} className="pos-btn h-9 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5"
            style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>
      <p className="text-xs" style={{ color: "var(--pos-muted)" }}>
        Every "Book a demo" and alpha waitlist submission from kandapos.com lands here.
      </p>

      <div className="rounded-xl overflow-hidden" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
        {busy ? (
          <div className="p-6 flex items-center gap-2" style={{ color: "var(--pos-text)" }}><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
        ) : !leads.length ? (
          <div className="p-8 text-sm text-center" style={{ color: "var(--pos-muted)" }}>No submissions yet.</div>
        ) : leads.map((l) => (
          <div key={l.id} data-testid={`lead-${l.id}`} className="px-4 py-3" style={{ borderTop: "1px solid var(--pos-border)" }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold" style={{ color: "var(--pos-text)" }}>{l.name || l.email}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.05)", color: TYPE_LABEL[l.type]?.color }}>{TYPE_LABEL[l.type]?.label || l.type}</span>
              </div>
              <span className="text-[11px]" style={{ color: "var(--pos-muted)" }}>{new Date(l.at).toLocaleString()}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs" style={{ color: "var(--pos-muted)" }}>
              <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {l.email}</span>
              {l.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {l.phone}</span>}
              {l.business && <span className="flex items-center gap-1"><Store className="w-3 h-3" /> {l.business}</span>}
              {l.city && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {l.city}</span>}
              {l.business_type && <span>{BUSINESS_TYPE_LABEL[l.business_type] || l.business_type}</span>}
              {l.outlets && <span>{l.outlets} outlet{l.outlets === "1" ? "" : "s"}</span>}
              {l.referred_by && <span>Referred by {l.referred_by}</span>}
              {l.ref_code && <span>Code {l.ref_code}</span>}
            </div>
            {l.message && (
              <div className="text-sm mt-2 rounded-lg p-2.5 whitespace-pre-wrap" style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)" }}>{l.message}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
