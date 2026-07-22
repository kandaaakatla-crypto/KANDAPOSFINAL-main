import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Radio, PhoneCall, Mic, Send } from "lucide-react";
import { voiceApi } from "../../api/client";

/**
 * Real-time "Active Calls" widget for the Voice Agent dashboard.
 * Subscribes to the tenant-scoped /api/ws stream and renders a card per
 * in-progress call with a live-updating transcript ticker and a "Whisper"
 * composer that lets a manager inject a live instruction into the AI's
 * next spoken response (invisible to the caller).
 */
export default function LiveCallsPanel() {
  const [active, setActive] = useState({});
  const wsRef = useRef(null);

  useEffect(() => {
    const backend = process.env.REACT_APP_BACKEND_URL;
    const token = localStorage.getItem("kanda_pos_token_v1");
    if (!backend || !token) return;
    const wsUrl = backend.replace(/^http/, "ws") + "/api/ws?token=" + encodeURIComponent(token);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onmessage = (msg) => {
      let evt;
      try { evt = JSON.parse(msg.data); } catch { return; }
      const t = evt.type; const d = evt.data || {};
      if (t === "voice.call.started") {
        setActive((prev) => ({ ...prev, [d.id]: { ...d, lines: [], whispers: [] } }));
      } else if (t === "voice.transcript_delta") {
        setActive((prev) => {
          const call = prev[d.id];
          if (!call) return prev;
          const lines = [...(call.lines || []), { role: d.role, text: d.text, at: d.at }].slice(-25);
          return { ...prev, [d.id]: { ...call, lines } };
        });
      } else if (t === "voice.whisper.sent") {
        setActive((prev) => {
          const call = prev[d.id];
          if (!call) return prev;
          const whispers = [...(call.whispers || []), { by: d.by, text: d.text, at: d.at }].slice(-10);
          return { ...prev, [d.id]: { ...call, whispers } };
        });
      } else if (t === "voice.call.ended") {
        setActive((prev) => {
          const next = { ...prev }; delete next[d.id]; return next;
        });
      }
    };
    ws.onerror = () => { /* transient */ };
    return () => { try { ws.close(); } catch (_) { /* ignore */ } };
  }, []);

  const list = Object.values(active).sort((a, b) => (b.started_at || "").localeCompare(a.started_at || ""));

  if (list.length === 0) {
    return (
      <div className="rounded-xl p-4 flex items-center gap-3"
        style={{ background: "var(--pos-panel)", border: "1px dashed var(--pos-border)" }}>
        <Radio className="w-4 h-4" style={{ color: "var(--pos-muted)" }} />
        <div>
          <div className="text-sm font-bold text-white">No active calls</div>
          <div className="text-xs" style={{ color: "var(--pos-muted)" }}>
            When a call is in progress you&apos;ll see its live transcript here — and can whisper instructions to the AI.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden" data-testid="live-calls-panel"
      style={{ background: "linear-gradient(135deg, #071a12, #0e2515)", border: "1px solid #1d4d2d" }}>
      <div className="px-5 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid #1d4d2d" }}>
        <div className="relative">
          <Radio className="w-4 h-4" style={{ color: "#86efac" }} />
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400" />
        </div>
        <h2 className="text-sm font-bold text-white uppercase tracking-wider">
          Active calls ({list.length})
        </h2>
      </div>
      <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
        {list.map((c) => <LiveCallCard key={c.id} call={c} />)}
      </div>
    </div>
  );
}

function LiveCallCard({ call }) {
  const other = call.direction === "outbound" ? call.to : call.from;
  const bottomRef = useRef(null);
  const [whisper, setWhisper] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollTop = bottomRef.current.scrollHeight;
  }, [call.lines?.length, call.whispers?.length]);

  const sendWhisper = async () => {
    const msg = whisper.trim();
    if (!msg || sending) return;
    setSending(true);
    try {
      await voiceApi.whisper(call.id, msg);
      setWhisper("");
      toast.success("Whisper sent — the AI will fold it into its next reply");
    } catch (e) {
      const detail = e?.response?.data?.detail || "Whisper failed";
      toast.error(String(detail));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-lg overflow-hidden" data-testid={`live-call-${call.id}`}
      style={{ background: "rgba(0,0,0,0.35)", border: "1px solid #1d4d2d" }}>
      <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: "1px solid #1d4d2d" }}>
        <div className="flex items-center gap-2">
          <PhoneCall className="w-3.5 h-3.5" style={{ color: "#86efac" }} />
          <span className="text-sm font-bold text-white tabular-nums">{other || "—"}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full uppercase tracking-wider"
            style={{ background: "rgba(134,239,172,0.15)", color: "#86efac" }}>
            {call.direction}
          </span>
        </div>
        <span className="text-[10px] tabular-nums" style={{ color: "var(--pos-muted)" }}>
          {call.started_at ? new Date(call.started_at).toLocaleTimeString("en-GB") : ""}
        </span>
      </div>
      <div ref={bottomRef} className="p-3 space-y-2 max-h-48 overflow-y-auto">
        {(!call.lines || call.lines.length === 0) && (
          <p className="text-xs italic" style={{ color: "var(--pos-muted)" }}>listening…</p>
        )}
        {(call.lines || []).map((m, i) => (
          <div key={i} className="flex gap-2 text-xs">
            <span className="shrink-0 w-14 uppercase tracking-wider text-[9px] font-bold"
              style={{ color: m.role === "user" ? "#fbbf24" : "#7dd3fc" }}>
              {m.role === "user" ? "Caller" : "Agent"}
            </span>
            <span className="text-white">{m.text}</span>
          </div>
        ))}
        {(call.whispers || []).map((w, i) => (
          <div key={`w${i}`} className="flex gap-2 text-xs px-2 py-1.5 rounded"
            style={{ background: "rgba(168,85,247,0.10)", border: "1px dashed rgba(168,85,247,0.35)" }}>
            <span className="shrink-0 w-14 uppercase tracking-wider text-[9px] font-bold"
              style={{ color: "#c084fc" }}>
              Whisper
            </span>
            <div className="text-white flex-1">
              <div>{w.text}</div>
              <div className="text-[9px] mt-0.5" style={{ color: "#a78bfa" }}>from {w.by}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="px-3 py-2 flex items-center gap-2" style={{ borderTop: "1px solid #1d4d2d" }}>
        <Mic className="w-3.5 h-3.5" style={{ color: "#c084fc" }} />
        <input data-testid={`whisper-input-${call.id}`}
          value={whisper} onChange={(e) => setWhisper(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), sendWhisper())}
          placeholder="Whisper an instruction to the AI (caller won't hear)…"
          className="flex-1 rounded px-2 py-1.5 text-xs text-white outline-none"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(168,85,247,0.30)" }} />
        <button data-testid={`whisper-send-${call.id}`}
          onClick={sendWhisper} disabled={sending || !whisper.trim()}
          className="pos-btn px-2.5 py-1.5 rounded flex items-center gap-1 text-white text-xs"
          style={{ background: "linear-gradient(135deg,#a855f7,#7c3aed)", opacity: (sending || !whisper.trim()) ? 0.5 : 1 }}>
          <Send className="w-3 h-3" /> {sending ? "…" : "Whisper"}
        </button>
      </div>
    </div>
  );
}
