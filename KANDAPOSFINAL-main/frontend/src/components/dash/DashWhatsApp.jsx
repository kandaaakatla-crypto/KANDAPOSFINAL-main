import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { whatsappApi } from "../../api/client";
import { MessageCircle, Send, Search, Plus, Loader2, ArrowLeft, Info, Copy, Check as CheckIcon, CheckCheck, FileText } from "lucide-react";
import WhatsappTemplateDialog from "../WhatsappTemplateDialog";

/**
 * Restaurant Dashboard → WhatsApp.
 *
 * WhatsApp-Web-style two-column chat:
 *   left  = conversation list (customers who've messaged, with unread badge)
 *   right = active thread + composer
 * Live updates come in via the tenant WS as `wa.message.new`.
 */
export default function DashWhatsApp() {
  const [conversations, setConversations] = useState([]);
  const [active, setActive] = useState(null); // conversation doc
  const [messages, setMessages] = useState([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [query, setQuery] = useState("");
  const [newTo, setNewTo] = useState("");
  const [showNew, setShowNew] = useState(false);
  const wsRef = useRef(null);
  const scrollRef = useRef(null);
  const [sandbox, setSandbox] = useState(null);
  const [showSandbox, setShowSandbox] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);

  const loadConvs = async () => {
    setLoadingConvs(true);
    try { setConversations(await whatsappApi.conversations()); }
    catch (_) { /* silent */ }
    finally { setLoadingConvs(false); }
  };

  const loadMessages = async (conv) => {
    if (!conv) return;
    setLoadingMsgs(true);
    try {
      const r = await whatsappApi.messages(conv.id);
      setMessages(r.messages || []);
      // Mark as read.
      if (conv.unread_count > 0) {
        try { await whatsappApi.markRead(conv.id); } catch (_) { /* ignore */ }
        setConversations((cs) => cs.map((c) => c.id === conv.id ? { ...c, unread_count: 0 } : c));
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load thread");
    } finally {
      setLoadingMsgs(false);
    }
  };

  useEffect(() => { loadConvs(); }, []);
  useEffect(() => { if (active) loadMessages(active); }, [active?.id]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, loadingMsgs]);

  // Live WS subscription for new messages.
  useEffect(() => {
    const backend = process.env.REACT_APP_BACKEND_URL;
    const token = localStorage.getItem("kanda_pos_token_v1");
    if (!backend || !token) return;
    const ws = new WebSocket(backend.replace(/^http/, "ws") + "/api/ws?token=" + encodeURIComponent(token));
    wsRef.current = ws;
    ws.onmessage = (msg) => {
      let evt;
      try { evt = JSON.parse(msg.data); } catch { return; }
      if (evt.type === "wa.message.new") {
        const m = evt.data;
        loadConvs();
        if (active && m.conversation_id === active.id) {
          setMessages((prev) => [...prev, m]);
          if (m.direction === "in") whatsappApi.markRead(active.id).catch(() => {});
        }
      } else if (evt.type === "wa.message.status") {
        const d = evt.data;
        setMessages((prev) => prev.map((m) =>
          m.twilio_sid === d.twilio_sid ? { ...m, status: d.status, error: d.error || m.error } : m
        ));
      }
    };
    return () => { try { ws.close(); } catch (_) { /* ignore */ } };
  }, [active?.id]);

  const filtered = useMemo(() => {
    if (!query) return conversations;
    const q = query.toLowerCase();
    return conversations.filter((c) =>
      (c.customer_name || "").toLowerCase().includes(q)
      || (c.phone || "").includes(q)
      || (c.last_body || "").toLowerCase().includes(q)
    );
  }, [conversations, query]);

  const send = async () => {
    if (!active || !body.trim()) return;
    setSending(true);
    try {
      const r = await whatsappApi.send(active.phone, body);
      if (r.ok) {
        setBody("");
        setMessages((prev) => [...prev, r.message]);
      } else {
        toast.error(r.error || "Send failed");
        // Still append so the user sees the failed row in the thread.
        if (r.message) setMessages((prev) => [...prev, r.message]);
      }
      loadConvs();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Send failed");
    } finally {
      setSending(false);
    }
  };

  const startNew = async () => {
    const raw = newTo.trim();
    if (!raw) return;
    try {
      const conv = await whatsappApi.start(raw);
      setShowNew(false);
      setNewTo("");
      await loadConvs();
      setActive(conv);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not create thread");
    }
  };

  return (
    <div className="h-full flex flex-col" data-testid="dash-whatsapp">
      <div className="px-6 pt-6 pb-3 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: "var(--pos-text)" }}>
            <MessageCircle className="w-6 h-6" style={{ color: "#25D366" }} />
            WhatsApp
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>
            Two-way chat with your customers. Powered by Twilio WhatsApp.
          </p>
        </div>
        <button data-testid="wa-sandbox-toggle" onClick={() => setShowSandbox(!showSandbox)}
          className="pos-btn px-3 py-2 rounded-lg text-xs flex items-center gap-1.5"
          style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
          <Info className="w-3.5 h-3.5" /> Sandbox setup
        </button>
      </div>

      {showSandbox && sandbox && (
        <div className="mx-6 mb-3 rounded-lg p-4 text-xs"
          style={{ background: "rgba(37,211,102,0.08)", border: "1px solid rgba(37,211,102,0.35)", color: "var(--pos-text)" }}>
          <div className="flex items-center justify-between mb-2">
            <div className="font-bold text-sm" style={{ color: "var(--pos-text)" }}>WhatsApp Setup</div>
            {sandbox.sender_status && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                style={{
                  background: sandbox.sender_status === "ONLINE" ? "rgba(22,163,74,0.20)" : "rgba(220,38,38,0.20)",
                  color: sandbox.sender_status === "ONLINE" ? "#16a34a" : "#dc2626",
                }}>
                {sandbox.sender_status}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="p-2 rounded" style={{ background: "var(--pos-panel-2)" }}>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Sender number</div>
              <button onClick={() => { navigator.clipboard?.writeText(sandbox.from_display); toast.success("Copied"); }}
                className="pos-btn inline-flex items-center gap-1 mt-1 font-mono" style={{ color: "#128C7E" }}>
                {sandbox.from_display} <Copy className="w-2.5 h-2.5" />
              </button>
            </div>
            {sandbox.sender_quality && (
              <div className="p-2 rounded" style={{ background: "var(--pos-panel-2)" }}>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Quality / limit</div>
                <div className="mt-1" style={{ color: "var(--pos-text)" }}>{sandbox.sender_quality} · {sandbox.sender_limit || "—"}</div>
              </div>
            )}
          </div>

          {sandbox.is_sandbox ? (
            <ol className="list-decimal ml-5 space-y-1.5">
              <li>
                Ask each customer to open WhatsApp and send{" "}
                <code className="px-1.5 py-0.5 rounded" style={{ background: "var(--pos-panel-2)", color: "#128C7E" }}>
                  join {sandbox.join_phrase || "<your-sandbox-phrase>"}
                </code>{" "}
                to {sandbox.from_display}.
              </li>
              <li>
                Once they reply <code className="px-1.5 py-0.5 rounded" style={{ background: "var(--pos-panel-2)", color: "#128C7E" }}>&ldquo;joined&rdquo;</code>,
                you can chat freely for 24 hours after each reply they send.
              </li>
              <li>
                Find your sandbox phrase in Twilio Console → Messaging → Try it out → Send a WhatsApp message.
                Set it in <code className="px-1.5 py-0.5 rounded" style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)" }}>TWILIO_WHATSAPP_JOIN_PHRASE</code>.
              </li>
            </ol>
          ) : (
            <ol className="list-decimal ml-5 space-y-1.5">
              <li>
                <b>Free-form messages</b> only work within 24 h of the customer&apos;s last inbound message.
                Outside that window, use an approved <b>Template</b> (
                <code className="px-1.5 py-0.5 rounded" style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)" }}>📄 icon in composer</code>).
              </li>
              <li>
                If sends come back as <code className="px-1.5 py-0.5 rounded" style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)" }}>undelivered / 63051</code>,
                the recipient may not be on WhatsApp, or has blocked business messages. Try a different test number.
              </li>
              <li>
                For a new customer, ask them to WhatsApp {sandbox.from_display} first — that opens the 24 h window.
              </li>
            </ol>
          )}

          <div className="mt-3 pt-3 text-[10px]" style={{ borderTop: "1px solid rgba(37,211,102,0.20)", color: "var(--pos-muted)" }}>
            Inbound webhook (paste into Twilio Sandbox / Sender settings):{" "}
            <code className="break-all" style={{ color: "#128C7E" }}>{sandbox.inbound_webhook_url}</code>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 mx-6 mb-6 rounded-xl overflow-hidden grid grid-cols-1 md:grid-cols-[320px_1fr]"
        style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>

        {/* Conversation list */}
        <div className={`flex flex-col ${active ? "hidden md:flex" : "flex"}`}
          style={{ borderRight: "1px solid var(--pos-border)" }}>
          <div className="p-3 space-y-2" style={{ borderBottom: "1px solid var(--pos-border)" }}>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--pos-muted)" }} />
              <input data-testid="wa-search"
                value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chats…"
                className="w-full pl-8 rounded px-2 py-1.5 text-sm outline-none"
                style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
            </div>
            <button data-testid="wa-new-chat" onClick={() => setShowNew(!showNew)}
              className="pos-btn w-full text-xs px-2 py-1.5 rounded flex items-center justify-center gap-1 text-white"
              style={{ background: "linear-gradient(135deg,#25D366,#128C7E)" }}>
              <Plus className="w-3 h-3" /> New chat
            </button>
            {showNew && (
              <div className="flex gap-1">
                <input data-testid="wa-new-phone"
                  value={newTo} onChange={(e) => setNewTo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), startNew())}
                  placeholder="+91… phone number"
                  className="flex-1 rounded px-2 py-1 text-xs outline-none"
                  style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
                <button data-testid="wa-new-start" onClick={startNew}
                  className="pos-btn text-xs px-2 py-1 rounded text-white"
                  style={{ background: "#25D366" }}>Start</button>
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {loadingConvs && <div className="text-xs p-4" style={{ color: "var(--pos-muted)" }}>Loading…</div>}
            {!loadingConvs && filtered.length === 0 && (
              <div className="text-xs p-4 text-center" style={{ color: "var(--pos-muted)" }}>
                No conversations yet. Ask a customer to text your WhatsApp sandbox number to start.
              </div>
            )}
            {filtered.map((c) => (
              <button key={c.id} onClick={() => setActive(c)}
                data-testid={`wa-conv-${c.id}`}
                className="pos-btn w-full text-left px-3 py-2.5 flex items-start gap-2 transition-colors"
                style={{
                  background: active?.id === c.id ? "rgba(37,211,102,0.10)" : "transparent",
                  borderBottom: "1px solid var(--pos-border)",
                }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white font-bold text-xs"
                  style={{ background: "#128C7E" }}>
                  {(c.customer_name || c.phone || "?").slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm truncate" style={{ color: "var(--pos-text)" }}>{c.customer_name || c.phone}</span>
                    {c.unread_count > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full text-white shrink-0 ml-1"
                        style={{ background: "#25D366" }}>{c.unread_count}</span>
                    )}
                  </div>
                  <div className="text-[11px] truncate" style={{ color: "var(--pos-muted)" }}>
                    {c.last_direction === "out" && "You: "}{c.last_body || "(no messages)"}
                  </div>
                  <div className="text-[9px]" style={{ color: "var(--pos-muted)" }}>
                    {c.last_at ? new Date(c.last_at).toLocaleString() : ""}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Thread */}
        <div className={`flex flex-col min-h-0 ${active ? "flex" : "hidden md:flex"}`}>
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-sm" style={{ color: "var(--pos-muted)" }}>
              Select a chat to view messages.
            </div>
          ) : (
            <>
              <div className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: "1px solid var(--pos-border)" }}>
                <button className="pos-btn md:hidden" onClick={() => setActive(null)}>
                  <ArrowLeft className="w-4 h-4" style={{ color: "var(--pos-text)" }} />
                </button>
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-xs"
                  style={{ background: "#128C7E" }}>
                  {(active.customer_name || active.phone).slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>{active.customer_name || active.phone}</div>
                  <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>{active.phone}</div>
                </div>
              </div>
              <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2"
                style={{ background: "linear-gradient(180deg, #0b141a, #0a1519)" }}>
                {(() => {
                  // Warn when the 24-hour customer-service window has expired
                  // — free-form sends will silently be undelivered by Twilio.
                  const lastIn = active.last_inbound_at ? new Date(active.last_inbound_at).getTime() : 0;
                  const hoursSince = lastIn ? (Date.now() - lastIn) / 3.6e6 : Infinity;
                  const closed = hoursSince > 24;
                  if (!closed) return null;
                  return (
                    <div className="text-[11px] p-2 rounded flex items-start gap-2" data-testid="wa-window-warning"
                      style={{ background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.35)", color: "#fbbf24" }}>
                      <Info className="w-3 h-3 mt-0.5 shrink-0" />
                      <div>
                        <b>24-hour window closed.</b> This customer hasn&apos;t messaged you in the last 24 hours,
                        so free-form messages will not be delivered by WhatsApp. Use a template
                        (<FileText className="w-3 h-3 inline mx-0.5" /> button) to reach them, or ask them to text you first.
                      </div>
                    </div>
                  );
                })()}
                {loadingMsgs && <div className="text-xs" style={{ color: "var(--pos-muted)" }}>Loading messages…</div>}
                {!loadingMsgs && messages.length === 0 && (
                  <div className="text-xs italic text-center py-8" style={{ color: "var(--pos-muted)" }}>
                    No messages yet. Send the first one below.
                  </div>
                )}
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}
                    data-testid={`wa-msg-${m.id}`}>
                    <div className="max-w-[75%] px-3 py-2 rounded-lg text-sm text-white shadow"
                      style={{
                        background: m.direction === "out" ? "#005c4b" : "#202c33",
                        borderTopRightRadius: m.direction === "out" ? 2 : undefined,
                        borderTopLeftRadius: m.direction === "in" ? 2 : undefined,
                      }}>
                      {m.media_url && (
                        <a href={m.media_url} target="_blank" rel="noreferrer"
                          className="block text-[11px] underline mb-1" style={{ color: "var(--pos-accent)" }}>
                          [media attachment]
                        </a>
                      )}
                      <div className="whitespace-pre-wrap">{m.body}</div>
                      <div className="text-[9px] mt-1 flex items-center gap-1 justify-end" style={{ color: "rgba(255,255,255,0.55)" }}>
                        {new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {m.direction === "out" && (
                          <MsgStatus status={m.status} />
                        )}
                      </div>
                      {m.error && <div className="text-[10px] mt-1 text-red-300">{m.error}</div>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-3 flex items-center gap-2" style={{ borderTop: "1px solid var(--pos-border)" }}>
                <button data-testid="wa-open-template" onClick={() => setShowTemplate(true)}
                  className="pos-btn w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}
                  title="Send a WhatsApp template (bypasses 24-h window)">
                  <FileText className="w-4 h-4" style={{ color: "var(--pos-text)" }} />
                </button>
                <input data-testid="wa-input"
                  value={body} onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
                  placeholder="Type a message…"
                  className="flex-1 rounded-full px-4 py-2 text-sm outline-none"
                  style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
                <button data-testid="wa-send" onClick={send}
                  disabled={sending || !body.trim()}
                  className="pos-btn w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ background: "#25D366", opacity: (sending || !body.trim()) ? 0.5 : 1 }}>
                  {sending ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Send className="w-4 h-4 text-white" />}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <WhatsappTemplateDialog
        open={showTemplate}
        onClose={() => setShowTemplate(false)}
        to={active?.phone}
        name={active?.customer_name}
        onSent={(m) => { setMessages((prev) => [...prev, m]); loadConvs(); }}
      />
    </div>
  );
}


function MsgStatus({ status }) {
  const label = (status || "").toLowerCase();
  if (label === "delivered" || label === "read") {
    const color = label === "read" ? "#53bdeb" : "rgba(255,255,255,0.6)";
    return <span title={label}><CheckCheck className="w-3 h-3" style={{ color }} /></span>;
  }
  if (label === "sent") return <span title="sent"><CheckIcon className="w-3 h-3" style={{ color: "rgba(255,255,255,0.55)" }} /></span>;
  if (label === "queued" || label === "accepted" || label === "sending") {
    return <span title={label} className="text-[9px]" style={{ color: "rgba(255,255,255,0.5)" }}>· {label}</span>;
  }
  if (label === "failed" || label === "undelivered") {
    return <span title={label} className="text-red-400 text-[9px]">· {label}</span>;
  }
  return null;
}
