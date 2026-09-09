import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Eye, Loader2, ShieldCheck } from "lucide-react";
import { ownerData, beginImpersonation } from "../../api/ownerClient";
import { toast } from "sonner";

/** Confirm + collect mode/reason then mint impersonation token and bounce into POS. */
export default function ImpersonateModal({ tenant, open, onClose }) {
  const [mode, setMode] = useState("full");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (!tenant) return null;
  const auditorMissing = mode === "auditor" && !reason.trim();

  const onGo = async () => {
    if (auditorMissing || busy) return;
    setBusy(true);
    try {
      const r = await ownerData.impersonate(tenant.id, { mode, reason });
      beginImpersonation({ token: r.token, tenantSlug: r.tenantSlug, tenantName: r.tenantName, mode: r.mode });
      toast.success(`Now ${mode === "auditor" ? "auditing" : "acting as"} ${tenant.name}`);
      onClose();
      // Hard navigation so PosContext bootstraps fresh with the new impersonation token.
      // Mirrors the pattern used by ImpersonationBanner.onExit().
      window.location.assign("/pos");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not start impersonation");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} data-testid="impersonate-modal">
        <DialogHeader>
          <DialogTitle style={{ color: "var(--pos-text)" }}>Open {tenant.name}'s POS</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button data-testid="imp-mode-full" onClick={() => setMode("full")}
              className="pos-btn h-14 rounded-xl text-left p-3 flex flex-col"
              style={{ background: mode === "full" ? "var(--pos-accent)" : "var(--pos-panel-2)", color: mode === "full" ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
              <span className="flex items-center gap-1.5 text-sm font-bold"><Eye className="w-4 h-4" /> Full impersonate</span>
              <span className="text-[10px] mt-0.5 opacity-80">Read + write — fix things on the customer's behalf.</span>
            </button>
            <button data-testid="imp-mode-auditor" onClick={() => setMode("auditor")}
              className="pos-btn h-14 rounded-xl text-left p-3 flex flex-col"
              style={{ background: mode === "auditor" ? "var(--pos-accent)" : "var(--pos-panel-2)", color: mode === "auditor" ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
              <span className="flex items-center gap-1.5 text-sm font-bold"><ShieldCheck className="w-4 h-4" /> Auditor (read-only)</span>
              <span className="text-[10px] mt-0.5 opacity-80">Look-only. All writes blocked except payment verify.</span>
            </button>
          </div>

          <label className="block">
            <span className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>
              Reason {mode === "auditor" && <span style={{ color: "#f87171" }}>· required</span>}
            </span>
            <Input data-testid="imp-reason" placeholder={mode === "auditor" ? "e.g. SUP-847: Razorpay mismatch" : "Optional context for the audit log"}
              value={reason} onChange={(e) => setReason(e.target.value)}
              className="mt-1 h-11" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
          </label>

          <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>
            Token will expire in 30 minutes. Every impersonation is logged with your owner id + reason.
          </div>

          <button data-testid="imp-confirm" onClick={onGo} disabled={busy || auditorMissing}
            className="pos-btn w-full h-11 rounded-lg font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
            style={{ background: "var(--pos-accent)" }}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : `Open ${tenant.name}`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
