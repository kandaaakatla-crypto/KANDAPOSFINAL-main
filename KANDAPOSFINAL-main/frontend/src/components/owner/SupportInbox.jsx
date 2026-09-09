import React, { useEffect, useState } from "react";
import { ownerData } from "../../api/ownerClient";
import { LifeBuoy, Loader2, MessageSquare, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";

const STATUS_LABEL = {
  open: { label: "Open", color: "#ef4444" },
  in_progress: { label: "In progress", color: "#f59e0b" },
  resolved: { label: "Resolved", color: "#22c55e" },
  closed: { label: "Closed", color: "#6b7280" },
};
const SEV_COLOR = { low: "#6b7280", normal: "#3b82f6", high: "#ef4444" };

export default function SupportInbox() {
  const [tickets, setTickets] = useState([]);
  const [busy, setBusy] = useState(true);
  const [active, setActive] = useState(null);
  const [reply, setReply] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [sending, setSending] = useState(false);

  const load = async () => {
    setBusy(true);
    const data = await ownerData.tickets(filterStatus ? { status: filterStatus } : {});
    setTickets(data);
    setBusy(false);
    if (active) {
      const refreshed = data.find((t) => t.id === active.id);
      if (refreshed) setActive(refreshed);
    }
  };
  useEffect(() => { load(); }, [filterStatus]); // eslint-disable-line

  const onReply = async (e) => {
    e.preventDefault();
    if (!active || !reply.trim() || sending) return;
    setSending(true);
    try {
      const updated = await ownerData.replyTicket(active.id, reply.trim());
      setReply("");
      setActive(updated);
      toast.success("Reply posted");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not reply");
    } finally { setSending(false); }
  };

  const onStatus = async (status) => {
    if (!active) return;
    const updated = await ownerData.setTicketStatus(active.id, status);
    setActive(updated);
    load();
  };

  return (
    <div data-testid="owner-support-inbox" className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LifeBuoy className="w-5 h-5" style={{ color: "var(--pos-accent)" }} />
          <h1 className="text-2xl font-bold" style={{ color: "var(--pos-text)" }}>Support inbox</h1>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>{tickets.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <select data-testid="support-filter-status" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
            className="h-9 px-3 rounded-lg text-xs" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
            <option value="">All status</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
          <button onClick={load} className="pos-btn h-9 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5"
            style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-5 rounded-xl overflow-hidden" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          {busy ? (
            <div className="p-6 flex items-center gap-2" style={{ color: "var(--pos-text)" }}><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : !tickets.length ? (
            <div className="p-8 text-sm text-center" style={{ color: "var(--pos-muted)" }}>No tickets.</div>
          ) : tickets.map((t) => (
            <button key={t.id} data-testid={`ticket-${t.id}`} onClick={() => setActive(t)}
              className="w-full text-left px-3 py-3 hover:bg-white/[0.02]"
              style={{ borderTop: "1px solid var(--pos-border)", background: active?.id === t.id ? "rgba(255,255,255,0.03)" : "transparent" }}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold truncate max-w-[220px]" style={{ color: "var(--pos-text)" }}>{t.subject}</div>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.05)", color: SEV_COLOR[t.severity] }}>{t.severity}</span>
              </div>
              <div className="text-[11px] mt-0.5 flex items-center justify-between" style={{ color: "var(--pos-muted)" }}>
                <span>{t.tenant_name || t.tenant_id} · {t.opened_by_name}</span>
                <span style={{ color: STATUS_LABEL[t.status]?.color }}>{STATUS_LABEL[t.status]?.label}</span>
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: "var(--pos-muted)" }}>{new Date(t.at).toLocaleString()}{t.replies?.length ? ` · ${t.replies.length} repl${t.replies.length === 1 ? "y" : "ies"}` : ""}</div>
            </button>
          ))}
        </div>

        <div className="col-span-7">
          {!active ? (
            <div className="rounded-xl p-10 text-center text-sm" style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
              Select a ticket to view + reply.
            </div>
          ) : (
            <div data-testid="ticket-detail" className="rounded-xl p-5 space-y-4" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
              <div>
                <div className="text-xl font-bold" style={{ color: "var(--pos-text)" }}>{active.subject}</div>
                <div className="text-[11px] mt-1" style={{ color: "var(--pos-muted)" }}>
                  {active.tenant_name} · {active.opened_by_name} ({active.opened_by_role}) · {new Date(active.at).toLocaleString()}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.05)", color: SEV_COLOR[active.severity] }}>severity · {active.severity}</span>
                <span className="px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.05)", color: STATUS_LABEL[active.status]?.color }}>status · {STATUS_LABEL[active.status]?.label}</span>
              </div>
              <div className="text-sm whitespace-pre-wrap rounded-lg p-3" style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)" }}>{active.body}</div>

              {active.replies?.map((r) => (
                <div key={r.id} className="rounded-lg p-3 text-sm" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                  <div className="text-[11px] mb-1" style={{ color: "var(--pos-muted)" }}>
                    <MessageSquare className="w-3 h-3 inline mr-1" />
                    {r.by_name} · {new Date(r.at).toLocaleString()}
                  </div>
                  <div className="whitespace-pre-wrap" style={{ color: "var(--pos-text)" }}>{r.body}</div>
                </div>
              ))}

              <form onSubmit={onReply} className="space-y-2">
                <textarea data-testid="ticket-reply" rows={3} value={reply} onChange={(e) => setReply(e.target.value)}
                  placeholder="Write a reply…" className="w-full rounded-lg p-2 text-sm"
                  style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
                <div className="flex items-center justify-between">
                  <div className="flex gap-1.5">
                    {["in_progress", "resolved", "closed"].map((s) => (
                      <button key={s} type="button" data-testid={`ticket-set-${s}`} onClick={() => onStatus(s)}
                        className="pos-btn h-8 px-2.5 rounded-md text-[11px] font-bold"
                        style={{ background: "var(--pos-panel-2)", color: STATUS_LABEL[s]?.color, border: "1px solid var(--pos-border)" }}>
                        Mark {STATUS_LABEL[s]?.label.toLowerCase()}
                      </button>
                    ))}
                  </div>
                  <button type="submit" data-testid="ticket-send-reply" disabled={!reply.trim() || sending}
                    className="pos-btn h-9 px-3 rounded-lg text-xs font-bold text-white flex items-center gap-1.5 disabled:opacity-40"
                    style={{ background: "var(--pos-accent)" }}>
                    {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Reply
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
