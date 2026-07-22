import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { customersApi, smsApi } from "../../api/client";
import { MessageSquare, Send, Search, Users, History, Loader2, Check, X } from "lucide-react";

/**
 * Restaurant Dashboard → SMS.
 *
 * Two panels:
 *   1. Compose broadcast — pick customers (or paste extra phones), write a
 *      message (supports {name} placeholder), send in one click.
 *   2. History — recent outbound SMS with status + error.
 */
export default function DashSms() {
  const [customers, setCustomers] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [extraPhones, setExtraPhones] = useState("");
  const [query, setQuery] = useState("");
  const [body, setBody] = useState("Hi {name}, thanks for being a Kanda customer! ");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState([]);
  const [loadingHist, setLoadingHist] = useState(false);

  const loadCustomers = async () => {
    try { setCustomers(await customersApi.list()); }
    catch (_) { /* silent */ }
  };
  const loadHistory = async () => {
    setLoadingHist(true);
    try { setHistory(await smsApi.history(100)); }
    catch (_) { /* silent */ }
    finally { setLoadingHist(false); }
  };
  useEffect(() => { loadCustomers(); loadHistory(); }, []);

  const filtered = useMemo(() => customers.filter(
    (c) => !query || (c.name + " " + (c.phone || "")).toLowerCase().includes(query.toLowerCase())
  ), [customers, query]);

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.filter((c) => c.phone).map((c) => c.id)));
  };
  const toggle = (id) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelected(n);
  };

  const extraList = extraPhones.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  const totalRecipients = selected.size + extraList.length;

  const send = async () => {
    if (!body.trim()) { toast.error("Message is empty"); return; }
    if (totalRecipients === 0) { toast.error("Select at least one recipient"); return; }
    if (totalRecipients > 200) { toast.error("Broadcast capped at 200 recipients per send"); return; }
    setSending(true);
    try {
      const r = await smsApi.broadcast(body, {
        customer_ids: Array.from(selected),
        phones: extraList,
      });
      if (r.failed > 0) toast.warning(`Sent ${r.sent}, ${r.failed} failed`);
      else toast.success(`Sent to ${r.sent} recipient(s)`);
      setBody("Hi {name}, ");
      setSelected(new Set());
      setExtraPhones("");
      loadHistory();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Broadcast failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-6 space-y-6" data-testid="dash-sms">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <MessageSquare className="w-6 h-6" style={{ color: "#a78bfa" }} />
          Customer SMS
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>
          Send promos, updates, and one-offs to your customers. Delivered via Twilio.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recipients + composer */}
        <div className="lg:col-span-2 rounded-xl overflow-hidden" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--pos-border)" }}>
            <div className="text-sm font-bold text-white flex items-center gap-2">
              <Users className="w-4 h-4" /> Recipients ({totalRecipients})
            </div>
            <button data-testid="sms-select-all" onClick={toggleAll}
              className="pos-btn text-xs px-2.5 py-1 rounded-full text-white"
              style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
              {selected.size === filtered.length && filtered.length > 0 ? "Clear all" : "Select all visible"}
            </button>
          </div>

          <div className="p-4 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--pos-muted)" }} />
              <input data-testid="sms-search"
                value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Search customers by name or phone…"
                className="w-full pl-9 rounded-lg px-3 py-2 text-sm text-white outline-none"
                style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} />
            </div>

            <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
              {filtered.map((c) => (
                <label key={c.id} data-testid={`sms-recipient-${c.id}`}
                  className="flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer"
                  style={{ background: selected.has(c.id) ? "rgba(124,58,237,0.15)" : "transparent" }}>
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)}
                    disabled={!c.phone} className="accent-purple-500" />
                  <span className="text-white flex-1 truncate">{c.name}</span>
                  <span className="tabular-nums" style={{ color: "var(--pos-muted)" }}>{c.phone || "no phone"}</span>
                </label>
              ))}
              {filtered.length === 0 && (
                <div className="text-xs py-6 text-center" style={{ color: "var(--pos-muted)" }}>No customers match.</div>
              )}
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>
                Extra phone numbers (optional)
              </label>
              <input data-testid="sms-extra-phones"
                value={extraPhones} onChange={(e) => setExtraPhones(e.target.value)}
                placeholder="+91…, +91…"
                className="w-full mt-1 rounded px-3 py-2 text-sm text-white outline-none"
                style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} />
              <div className="text-[10px] mt-1" style={{ color: "var(--pos-muted)" }}>
                Comma- or space-separated. Not saved as customers.
              </div>
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>
                Message ({body.length}/1000)
              </label>
              <textarea data-testid="sms-body"
                value={body} onChange={(e) => setBody(e.target.value)}
                rows={4} maxLength={1000}
                placeholder="Hi {name}, we have a special offer today…"
                className="w-full mt-1 rounded-lg px-3 py-2 text-sm text-white outline-none resize-none"
                style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} />
              <div className="text-[10px] mt-1" style={{ color: "var(--pos-muted)" }}>
                Tip: use <code>{"{name}"}</code> to personalise with each customer&apos;s first name.
              </div>
            </div>

            <button data-testid="sms-broadcast-send" onClick={send}
              disabled={sending || totalRecipients === 0 || !body.trim()}
              className="pos-btn w-full h-11 rounded-lg text-sm font-bold text-white flex items-center justify-center gap-2"
              style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)",
                       opacity: (sending || totalRecipients === 0 || !body.trim()) ? 0.5 : 1 }}>
              {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending {totalRecipients} SMS…</>
                       : <><Send className="w-4 h-4" /> Send to {totalRecipients} recipient(s)</>}
            </button>
          </div>
        </div>

        {/* History */}
        <div className="rounded-xl overflow-hidden h-fit" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--pos-border)" }}>
            <div className="text-sm font-bold text-white flex items-center gap-2">
              <History className="w-4 h-4" /> Recent SMS
            </div>
            <button data-testid="sms-refresh-history" onClick={loadHistory}
              className="pos-btn text-xs px-2 py-1 rounded text-white"
              style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
              Refresh
            </button>
          </div>
          <div className="p-3 max-h-[560px] overflow-y-auto space-y-2">
            {loadingHist && <div className="text-xs" style={{ color: "var(--pos-muted)" }}>Loading…</div>}
            {!loadingHist && history.length === 0 && (
              <div className="text-xs py-6 text-center" style={{ color: "var(--pos-muted)" }}>No SMS sent yet.</div>
            )}
            {history.map((s) => (
              <div key={s.id} className="rounded p-2 text-xs" data-testid={`sms-log-${s.id}`}
                style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                <div className="flex items-center justify-between">
                  <span className="text-white tabular-nums">{s.to}</span>
                  {s.status === "sent"
                    ? <span className="flex items-center gap-1 text-emerald-400"><Check className="w-3 h-3" /> sent</span>
                    : <span className="flex items-center gap-1 text-red-400"><X className="w-3 h-3" /> {s.status}</span>}
                </div>
                <div className="mt-1 text-white line-clamp-2">{s.body}</div>
                {s.error && <div className="mt-1 text-[10px] text-red-400">{s.error}</div>}
                <div className="mt-1 text-[10px]" style={{ color: "var(--pos-muted)" }}>
                  {s.sent_by} · {new Date(s.sent_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
