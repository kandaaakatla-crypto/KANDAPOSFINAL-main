import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { FileText, Send, Loader2, RefreshCw, Info } from "lucide-react";
import { whatsappApi } from "../api/client";

/**
 * WhatsApp Template picker + sender.
 * Fetches approved templates from Twilio Content API, lets the manager pick
 * one, fills in the {{1}} {{2}} variables, previews the rendered body, and
 * sends via `POST /api/whatsapp/send-template`.
 */
export default function WhatsappTemplateDialog({ open, onClose, to, name, onSent }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [vars, setVars] = useState({});
  const [sending, setSending] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setTemplates(await whatsappApi.templates());
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not fetch templates");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) { setSelected(null); setVars({}); load(); } }, [open]);

  const varKeys = useMemo(() => {
    if (!selected) return [];
    // Union of Twilio's declared `variables` dict + any {{placeholder}} the
    // preview body actually references — dedupe so the UI shows every
    // substitution slot the backend will fill.
    const keys = new Set(Object.keys(selected.variables || {}));
    (selected.preview || "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, k) => { keys.add(k.trim()); return _; });
    return Array.from(keys);
  }, [selected]);

  const rendered = useMemo(() => {
    if (!selected) return "";
    let body = selected.preview || "";
    for (const k of varKeys) body = body.replaceAll("{{" + k + "}}", vars[k] || `[${k}]`);
    return body;
  }, [selected, varKeys, vars]);

  const send = async () => {
    if (!selected || !to) return;
    if (varKeys.some((k) => !(vars[k] || "").toString().trim())) {
      toast.error("Fill in all template variables");
      return;
    }
    setSending(true);
    try {
      const r = await whatsappApi.sendTemplate(to, selected.sid, vars);
      if (r.ok) {
        toast.success("Template sent");
        onSent?.(r.message);
        onClose?.();
      } else {
        toast.error(r.error || "Template send failed");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Send failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent data-testid="wa-template-dialog" className="max-w-2xl border"
        style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <FileText className="w-4 h-4" style={{ color: "#25D366" }} />
            Send WhatsApp Template to {name || to}
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>
                Approved templates ({templates.length})
              </div>
              <button data-testid="wa-tpl-refresh" onClick={load}
                className="pos-btn text-[10px] px-2 py-1 rounded text-white flex items-center gap-1"
                style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Refresh
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
              {loading && <div className="text-xs" style={{ color: "var(--pos-muted)" }}>Loading templates…</div>}
              {error && <div className="text-xs p-2 rounded" style={{ background: "rgba(220,38,38,0.15)", color: "#fca5a5" }}>{error}</div>}
              {!loading && !error && templates.length === 0 && (
                <div className="text-[11px] p-2 rounded" style={{ background: "rgba(37,211,102,0.08)", border: "1px solid rgba(37,211,102,0.30)", color: "#d4f7e0" }}>
                  <Info className="w-3 h-3 inline mr-1" /> No approved templates yet.
                  Create one in Twilio Console → Content Editor → Content Templates,
                  request WhatsApp approval, then click Refresh.
                </div>
              )}
              {templates.map((t) => (
                <button key={t.sid} data-testid={`wa-tpl-${t.sid}`}
                  onClick={() => { setSelected(t); setVars({}); }}
                  className="pos-btn w-full text-left px-2 py-1.5 rounded text-xs text-white"
                  style={{
                    background: selected?.sid === t.sid ? "rgba(37,211,102,0.20)" : "var(--pos-panel-2)",
                    border: "1px solid " + (selected?.sid === t.sid ? "#25D366" : "var(--pos-border)"),
                  }}>
                  <div className="font-bold">{t.friendly_name}</div>
                  <div className="text-[10px] mt-0.5 truncate" style={{ color: "var(--pos-muted)" }}>
                    {(t.preview || "").slice(0, 90)}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {selected ? (
              <>
                <div>
                  <div className="text-[11px] uppercase tracking-wider mb-1" style={{ color: "var(--pos-muted)" }}>
                    Fill variables
                  </div>
                  {varKeys.length === 0 && (
                    <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>No variables in this template.</div>
                  )}
                  {varKeys.map((k) => (
                    <div key={k} className="mb-2">
                      <label className="text-[10px]" style={{ color: "var(--pos-muted)" }}>{"{{" + k + "}}"}</label>
                      <input data-testid={`wa-tpl-var-${k}`}
                        value={vars[k] || ""} onChange={(e) => setVars({ ...vars, [k]: e.target.value })}
                        placeholder={`value for ${k}`}
                        className="w-full rounded px-2 py-1 text-xs text-white outline-none"
                        style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} />
                    </div>
                  ))}
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider mb-1" style={{ color: "var(--pos-muted)" }}>Preview</div>
                  {!selected.preview && (
                    <div className="text-[11px] p-2 mb-2 rounded" style={{ background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.35)", color: "#fbbf24" }}>
                      <Info className="w-3 h-3 inline mr-1" />
                      This template uses rich media (card/list-picker). Body text isn&apos;t previewable here — customers will see the full template on WhatsApp.
                    </div>
                  )}
                  <div className="p-3 text-sm text-white rounded" data-testid="wa-tpl-preview"
                    style={{ background: "#005c4b", borderRadius: 10 }}>
                    {rendered || <span style={{ color: "rgba(255,255,255,0.5)" }}>(rich-media template — sent as-is with your variables)</span>}
                  </div>
                </div>
                <button data-testid="wa-tpl-send" onClick={send}
                  disabled={sending || !to}
                  className="pos-btn w-full h-10 rounded text-sm font-bold text-white flex items-center justify-center gap-2"
                  style={{ background: "#25D366", opacity: (sending || !to) ? 0.5 : 1 }}>
                  {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : <><Send className="w-4 h-4" /> Send template</>}
                </button>
              </>
            ) : (
              <div className="text-xs" style={{ color: "var(--pos-muted)" }}>
                Pick a template from the list to fill in variables.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
