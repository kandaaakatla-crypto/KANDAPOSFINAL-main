import React, { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { MessageSquare, Send, Loader2 } from "lucide-react";
import { smsApi } from "../api/client";
import SmsNotSetUp, { useSmsStatus } from "./SmsNotSetUp";

/**
 * Modal that lets a Manager send a one-off SMS to a phone number
 * (usually a customer). Includes quick templates and a live char counter.
 *
 * Props:
 *   open, onClose
 *   to    — phone number (already formatted with + or plain)
 *   name  — recipient display name (used for templates + heading)
 *   customerId — optional; persisted on the sms_log row for later lookup
 */
const TEMPLATES = [
  { label: "Ready", body: "Hi {name}, your order is ready for collection at our counter. See you soon!" },
  { label: "Out for delivery", body: "Hi {name}, your order is out for delivery and will arrive shortly." },
  { label: "Missed call", body: "Hi {name}, we just tried to call you regarding your order. Please call us back at your convenience." },
  { label: "Thanks", body: "Hi {name}, thanks for ordering from us today! We hope you enjoyed your meal. — Kanda team" },
];

export default function SmsComposer({ open, onClose, to, name, customerId = null }) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const sms = useSmsStatus();
  const first = (name || "").split(" ")[0] || "there";
  const rendered = body.replaceAll("{name}", first);

  const send = async () => {
    if (!body.trim()) { toast.error("Message is empty"); return; }
    if (!to) { toast.error("No phone number on file"); return; }
    setSending(true);
    try {
      const r = await smsApi.send(to, rendered, customerId);
      if (r.ok) {
        toast.success(`SMS sent to ${to}`);
        setBody("");
        onClose?.();
      } else {
        toast.error(r.error || "SMS delivery failed");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "SMS send failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent data-testid="sms-composer" className="max-w-lg border"
        style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: "var(--pos-text)" }}>
            <MessageSquare className="w-4 h-4" style={{ color: "var(--pos-accent)" }} />
            SMS to {name || to}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-xs" style={{ color: "var(--pos-muted)" }}>
            To: <span className="tabular-nums" style={{ color: "var(--pos-text)" }}>{to || "—"}</span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {TEMPLATES.map((t) => (
              <button key={t.label} data-testid={`sms-tpl-${t.label}`}
                onClick={() => setBody(t.body)}
                className="pos-btn text-xs px-2.5 py-1 rounded-full"
                style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
                {t.label}
              </button>
            ))}
          </div>

          <textarea data-testid="sms-body"
            value={body} onChange={(e) => setBody(e.target.value)}
            rows={5} maxLength={1000}
            placeholder="Type your message… use {name} to personalise."
            className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
            style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />

          <div className="flex items-center justify-between text-[11px]" style={{ color: "var(--pos-muted)" }}>
            <span>Preview: <span style={{ color: "var(--pos-text)" }}>{rendered.slice(0, 80)}{rendered.length > 80 ? "…" : ""}</span></span>
            <span>{body.length}/1000</span>
          </div>

          {!sms.configured && <SmsNotSetUp reason={sms.reason} />}
          <button data-testid="sms-send" onClick={send} disabled={sending || !body.trim() || !to || !sms.configured}
            className="pos-btn w-full h-10 rounded-lg text-sm font-bold text-white flex items-center justify-center gap-2"
            style={{ background: "var(--pos-accent)", opacity: (sending || !body.trim() || !to || !sms.configured) ? 0.5 : 1 }}>
            {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : <><Send className="w-4 h-4" /> Send SMS</>}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
