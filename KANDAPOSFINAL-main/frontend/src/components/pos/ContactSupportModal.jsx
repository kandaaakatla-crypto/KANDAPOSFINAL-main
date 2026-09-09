import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { LifeBuoy, Loader2, AlertTriangle } from "lucide-react";
import { supportApi } from "../../api/client";
import { toast } from "sonner";

const SEVERITIES = [
  { key: "low",    label: "Low",    hint: "Cosmetic / question" },
  { key: "normal", label: "Normal", hint: "Workflow blocked but workaround exists" },
  { key: "high",   label: "High",   hint: "Cannot take orders / payments" },
];

export default function ContactSupportModal({ open, onClose }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState("normal");
  const [busy, setBusy] = useState(false);

  const valid = subject.trim().length >= 3 && body.trim().length >= 3;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      await supportApi.create({ subject: subject.trim(), body: body.trim(), severity });
      toast.success("Ticket sent — we will reply soon.");
      setSubject(""); setBody(""); setSeverity("normal");
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not send ticket");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} data-testid="contact-support-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: "var(--pos-text)" }}><LifeBuoy className="w-4 h-4" /> Contact support</DialogTitle>
          <DialogDescription className="text-xs" style={{ color: "var(--pos-muted)" }}>
            Drop us a note and our platform team will respond directly to your inbox.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Subject</span>
            <Input data-testid="support-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={140}
              placeholder="Payment stuck on UPI" className="mt-1 h-11"
              style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>What happened?</span>
            <Textarea data-testid="support-body" value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={4000}
              placeholder="Describe the issue and the steps that led to it. Include order numbers if relevant."
              className="mt-1" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
          </label>
          <div>
            <span className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Severity</span>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {SEVERITIES.map((s) => {
                const active = severity === s.key;
                return (
                  <button key={s.key} type="button" data-testid={`severity-${s.key}`} onClick={() => setSeverity(s.key)}
                    className="pos-btn rounded-lg p-2 text-left"
                    style={{ background: active ? "var(--pos-accent)" : "var(--pos-panel-2)", color: active ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                    <div className="text-xs font-bold">{s.label}</div>
                    <div className="text-[10px] opacity-80 mt-0.5">{s.hint}</div>
                  </button>
                );
              })}
            </div>
          </div>
          {severity === "high" && (
            <div className="flex items-start gap-2 text-[11px] rounded-md p-2" style={{ background: "rgba(239,68,68,0.08)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.3)" }}>
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5" />
              <span>High-severity tickets page the on-call team immediately. Use only when you can't take orders or payments.</span>
            </div>
          )}
          <button type="submit" data-testid="support-submit" disabled={!valid || busy}
            className="pos-btn w-full h-11 rounded-lg font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
            style={{ background: "var(--pos-accent)" }}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send ticket"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
