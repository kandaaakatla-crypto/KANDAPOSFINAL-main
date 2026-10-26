import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { digestApi } from "../../api/client";
import { Sparkles, Mail, MessageSquare, Clock, RefreshCw, Send, Save, Plus, Trash2, TrendingUp, TrendingDown, PackageSearch, AlertTriangle } from "lucide-react";

/**
 * Restaurant Dashboard → Daily Digest.
 *
 * Owner/manager view for the AI-written daily summary. Two panels:
 *   1. Preview — computed live off today's data and (optionally) AI-rendered.
 *   2. Config  — enable, schedule, channel selection, recipients.
 * "Send preview now" fires the digest via the configured channels immediately.
 */
export default function DashDigest() {
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState("");

  const [cfg, setCfg] = useState(null);
  const [cfgLoading, setCfgLoading] = useState(true);
  const [cfgError, setCfgError] = useState("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  const [newSms, setNewSms] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const loadPreview = async () => {
    setPreviewLoading(true);
    setPreviewError("");
    try {
      const d = await digestApi.preview();
      setPreview(d);
    } catch (e) {
      const msg = e?.response?.data?.detail || e?.message || "Failed to load preview";
      setPreviewError(String(msg));
    } finally {
      setPreviewLoading(false);
    }
  };

  const loadConfig = async () => {
    setCfgLoading(true);
    setCfgError("");
    try {
      const c = await digestApi.getConfig();
      setCfg(c);
    } catch (e) {
      const msg = e?.response?.data?.detail || e?.message || "Failed to load digest config";
      setCfgError(String(msg));
      toast.error("Failed to load digest config");
    } finally {
      setCfgLoading(false);
    }
  };

  useEffect(() => { loadPreview(); loadConfig(); }, []);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      await digestApi.saveConfig(cfg);
      toast.success("Digest settings saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const sendNow = async () => {
    if (!cfg) return;
    setSending(true);
    try {
      const r = await digestApi.sendNow({});
      const emailsSent = (r.sent_email || []).filter((x) => x.ok).length;
      const smsSent = (r.sent_sms || []).filter((x) => x.ok).length;
      toast.success(`Digest sent — ${emailsSent} email(s), ${smsSent} SMS`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Send failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-6 space-y-6" data-testid="dash-digest">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: "var(--pos-text)" }}>
            <Sparkles className="w-6 h-6" style={{ color: "var(--pos-accent)" }} />
            Daily Digest
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>
            AI-written summary of your day, delivered every morning via SMS or email.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button data-testid="digest-refresh"
            onClick={loadPreview} disabled={previewLoading}
            className="pos-btn px-3 py-2 rounded-lg text-xs flex items-center gap-1.5"
            style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
            <RefreshCw className={`w-3.5 h-3.5 ${previewLoading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button data-testid="digest-send-now"
            onClick={sendNow} disabled={sending || !cfg}
            className="pos-btn px-3 py-2 rounded-lg text-xs text-white flex items-center gap-1.5"
            style={{ background: "linear-gradient(135deg,#262626,#0a0a0a)", border: "1px solid #333333" }}>
            <Send className="w-3.5 h-3.5" style={{ color: "var(--pos-accent)" }} /> {sending ? "Sending…" : "Send preview now"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Preview */}
        <div className="lg:col-span-2 rounded-xl overflow-hidden" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--pos-border)" }}>
            <div className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>Today&apos;s preview</div>
          </div>
          <div className="p-5">
            {previewLoading && <div className="text-sm" style={{ color: "var(--pos-muted)" }}>Loading preview…</div>}
            {previewError && !previewLoading && (
              <div className="text-sm p-3 rounded space-y-2" style={{ background: "rgba(220,38,38,0.15)", color: "#fca5a5" }}>
                <div>{previewError}</div>
                <button onClick={loadPreview} className="text-xs font-bold underline">Retry</button>
              </div>
            )}
            {preview && !previewLoading && (
              <div className="space-y-5">
                <Metrics data={preview.data} />
                <div>
                  <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--pos-muted)" }}>AI summary</div>
                  <div className="text-sm whitespace-pre-wrap leading-relaxed p-4 rounded-lg"
                    style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} data-testid="digest-ai-text">
                    {preview.ai_text}
                  </div>
                </div>
                <TopLowLists data={preview.data} />
              </div>
            )}
          </div>
        </div>

        {/* Config */}
        <div className="rounded-xl overflow-hidden h-fit" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--pos-border)" }}>
            <div className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>Delivery settings</div>
          </div>
          <div className="p-5 space-y-4">
            {cfgError && !cfgLoading && (
              <div className="text-sm p-3 rounded space-y-2" style={{ background: "rgba(220,38,38,0.15)", color: "#fca5a5" }}>
                <div>{cfgError}</div>
                <button onClick={loadConfig} className="text-xs font-bold underline">Retry</button>
              </div>
            )}
            {cfgLoading || !cfg ? (
              cfgError ? null : <div className="text-sm" style={{ color: "var(--pos-muted)" }}>Loading…</div>
            ) : (
              <>
                <Toggle label="Enabled" testid="digest-enabled"
                  checked={cfg.enabled}
                  onChange={(v) => setCfg({ ...cfg, enabled: v })} />

                <div>
                  <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>
                    <Clock className="w-3 h-3 inline mr-1" /> Send at (IST)
                  </label>
                  <div className="flex gap-2 mt-1.5">
                    <NumInput testid="digest-hour" label="Send hour (IST)" value={cfg.send_hour_ist} min={0} max={23} onChange={(v) => setCfg({ ...cfg, send_hour_ist: v })} />
                    <span className="self-center" style={{ color: "var(--pos-text)" }}>:</span>
                    <NumInput testid="digest-minute" label="Send minute" value={cfg.send_minute} min={0} max={59} onChange={(v) => setCfg({ ...cfg, send_minute: v })} />
                  </div>
                </div>

                <Toggle label={<span><Mail className="w-3 h-3 inline mr-1" /> Email</span>} testid="digest-channel-email"
                  checked={cfg.channels_email}
                  onChange={(v) => setCfg({ ...cfg, channels_email: v })} />

                <RecipientList label="Email recipients" items={cfg.email_recipients} testidPrefix="digest-email"
                  onAdd={() => { const v = newEmail.trim(); if (!v || cfg.email_recipients.includes(v)) return; setCfg({ ...cfg, email_recipients: [...cfg.email_recipients, v] }); setNewEmail(""); }}
                  onRemove={(i) => setCfg({ ...cfg, email_recipients: cfg.email_recipients.filter((_, idx) => idx !== i) })}
                  newValue={newEmail} setNewValue={setNewEmail} placeholder="you@example.com" />

                <Toggle label={<span><MessageSquare className="w-3 h-3 inline mr-1" /> SMS</span>} testid="digest-channel-sms"
                  checked={cfg.channels_sms}
                  onChange={(v) => setCfg({ ...cfg, channels_sms: v })} />

                <RecipientList label="SMS recipients" items={cfg.sms_recipients} testidPrefix="digest-sms"
                  onAdd={() => { const v = newSms.trim(); if (!v || cfg.sms_recipients.includes(v)) return; setCfg({ ...cfg, sms_recipients: [...cfg.sms_recipients, v] }); setNewSms(""); }}
                  onRemove={(i) => setCfg({ ...cfg, sms_recipients: cfg.sms_recipients.filter((_, idx) => idx !== i) })}
                  newValue={newSms} setNewValue={setNewSms} placeholder="+91…" />

                {cfg.enabled && !(
                  (cfg.channels_email && cfg.email_recipients.length) || (cfg.channels_sms && cfg.sms_recipients.length)
                ) && (
                  <div data-testid="digest-not-set-up" role="status" className="text-xs p-3 rounded"
                    style={{ background: "rgba(217,119,6,0.14)", border: "1px solid rgba(217,119,6,0.4)", color: "var(--pos-text)" }}>
                    <b>Not set up.</b> The digest is on, but no one will receive it: turn on Email or SMS and add at least one recipient.
                  </div>
                )}
                <button data-testid="digest-save"
                  onClick={save} disabled={saving}
                  className="pos-btn w-full mt-2 px-3 py-2 rounded-lg text-xs text-white flex items-center justify-center gap-1.5"
                  style={{ background: "var(--pos-accent)" }}>
                  <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save settings"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Metrics({ data }) {
  const t = data.today, y = data.yesterday;
  const delta = data.delta_pct;
  const up = (delta ?? 0) >= 0;
  const DeltaIcon = up ? TrendingUp : TrendingDown;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <MetricCard label="Revenue today" value={`₹${t.revenue.toFixed(0)}`}
        sub={delta !== null && delta !== undefined ? <span className="flex items-center gap-1" style={{ color: up ? "#4ade80" : "#f87171" }}>
          <DeltaIcon className="w-3 h-3" /> {Math.abs(delta).toFixed(1)}%
        </span> : "vs yesterday: —"} />
      <MetricCard label="Orders" value={t.count} sub={`Yesterday: ${y.count}`} />
      <MetricCard label="Avg ticket" value={`₹${data.avg_ticket.toFixed(0)}`} sub={`Active: ${data.active_orders.length}`} />
      <MetricCard label="Staff on duty" value={data.staff_on_duty}
        sub={data.low_stock.length > 0
          ? <span className="text-amber-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {data.low_stock.length} low stock</span>
          : "Inventory OK"} />
    </div>
  );
}

function MetricCard({ label, value, sub }) {
  return (
    <div className="rounded-lg p-3" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
      <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>{label}</div>
      <div className="text-xl font-bold mt-1" style={{ color: "var(--pos-text)" }}>{value}</div>
      <div className="text-[10px] mt-1" style={{ color: "var(--pos-muted)" }}>{sub}</div>
    </div>
  );
}

function TopLowLists({ data }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <div className="text-[10px] uppercase tracking-wider mb-2 flex items-center gap-1" style={{ color: "var(--pos-muted)" }}>
          <PackageSearch className="w-3 h-3" /> Top sellers today
        </div>
        <div className="space-y-1" data-testid="digest-top-items">
          {data.top_items.length === 0 && <div className="text-xs" style={{ color: "var(--pos-muted)" }}>No sales yet today.</div>}
          {data.top_items.map((it, i) => (
            <div key={i} className="flex items-center justify-between text-xs px-2 py-1.5 rounded"
              style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
              <span style={{ color: "var(--pos-text)" }}>{it.name}</span>
              <span style={{ color: "var(--pos-muted)" }}>×{it.qty} · ₹{it.revenue.toFixed(0)}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider mb-2 flex items-center gap-1" style={{ color: "var(--pos-muted)" }}>
          <AlertTriangle className="w-3 h-3" /> Low stock
        </div>
        <div className="space-y-1" data-testid="digest-low-stock">
          {data.low_stock.length === 0 && <div className="text-xs" style={{ color: "var(--pos-muted)" }}>All inventory items are above reorder.</div>}
          {data.low_stock.slice(0, 6).map((it, i) => (
            <div key={i} className="flex items-center justify-between text-xs px-2 py-1.5 rounded"
              style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
              <span style={{ color: "var(--pos-text)" }}>{it.name}</span>
              <span className="text-amber-400">{it.stock} {it.unit || ""}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange, testid }) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-xs" style={{ color: "var(--pos-text)" }}>{label}</span>
      <button data-testid={testid} type="button" onClick={() => onChange(!checked)}
        className="pos-btn w-10 h-5 rounded-full relative"
        style={{ background: checked ? "var(--pos-accent)" : "#374151" }}>
        <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
          style={{ left: checked ? "calc(100% - 18px)" : "2px" }} />
      </button>
    </label>
  );
}

function NumInput({ value, min, max, onChange, testid, label }) {
  // Shown zero-padded ("00", "07") so a send time reads 22:00, not 22:0.
  return (
    <input type="text" inputMode="numeric" maxLength={2} aria-label={label}
      value={String(value ?? 0).padStart(2, "0")}
      data-testid={testid}
      onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value.replace(/\D/g, "")) || 0)))}
      className="w-16 rounded px-2 py-1 text-sm outline-none"
      style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
  );
}

function RecipientList({ label, items, onAdd, onRemove, newValue, setNewValue, placeholder, testidPrefix }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>{label}</label>
      <div className="space-y-1 mt-1.5">
        {items.map((v, i) => (
          <div key={i} className="flex items-center justify-between text-xs px-2 py-1 rounded"
            style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
            <span className="truncate" style={{ color: "var(--pos-text)" }}>{v}</span>
            <button data-testid={`${testidPrefix}-remove-${i}`} onClick={() => onRemove(i)} className="text-red-400 pos-btn ml-2">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-1.5">
        <input data-testid={`${testidPrefix}-input`}
          value={newValue} onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onAdd())}
          placeholder={placeholder}
          className="flex-1 min-w-0 rounded px-2 py-1 text-xs outline-none"
          style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
        <button data-testid={`${testidPrefix}-add`} onClick={onAdd}
          aria-label={`Add ${label}`} className="pos-btn px-2 rounded text-white shrink-0"
          style={{ background: "var(--pos-accent)" }}>
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
