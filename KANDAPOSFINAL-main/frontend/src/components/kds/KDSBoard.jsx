import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { kdsApi } from "../../api/kdsClient";
import { ChefHat, AlertTriangle, Loader2, RotateCcw, CheckCircle2, Clock, Volume2, VolumeX, RefreshCw } from "lucide-react";

const LANES = [
  { key: "new",        label: "New",        accent: "#3b82f6" },
  { key: "preparing",  label: "Preparing",  accent: "#f59e0b" },
  { key: "ready",      label: "Ready",      accent: "#22c55e" },
  { key: "recall",     label: "Recall",     accent: "#ef4444" },
];

const NEXT_STATUS = { new: "preparing", preparing: "ready", ready: "new" };

// Simple Web Audio API beep — no external assets needed.
function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "triangle"; osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
    setTimeout(() => ctx.close(), 700);
  } catch {}
}

function formatElapsed(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function TicketCard({ ticket, onItemStatus, onRecall, justArrived }) {
  const lane = ticket.lane;
  const accent = LANES.find((l) => l.key === lane)?.accent || "#fff";
  const elapsedMin = ticket.placed_at ? (Date.now() - new Date(ticket.placed_at).getTime()) / 60000 : 0;
  const overdue = elapsedMin > 15 && lane !== "ready";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      data-testid={`kds-ticket-${ticket.id}`}
      data-lane={lane}
      className={`rounded-xl p-3 transition-all ${justArrived ? "animate-pulse" : ""}`}
      style={{
        background: "var(--pos-panel)",
        border: `1px solid ${justArrived ? accent : "var(--pos-border)"}`,
        boxShadow: justArrived ? `0 0 0 2px ${accent}40` : "none",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg font-extrabold tabular-nums" style={{ color: "var(--pos-text)" }}>#{ticket.number}</span>
          <span className="text-[11px] uppercase font-bold px-1.5 py-0.5 rounded-md"
            style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>
            {ticket.type === "dine-in" ? `Table ${ticket.table || "?"}` : ticket.type}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] tabular-nums" style={{ color: overdue ? "#fca5a5" : "var(--pos-muted)" }}>
          <Clock className="w-3 h-3" />
          {formatElapsed(ticket.placed_at)}
        </div>
      </div>
      <div className="text-[12px] mb-2 truncate" style={{ color: "var(--pos-muted)" }}>{ticket.customer_name}</div>
      <ul className="space-y-1.5">
        {ticket.items.map((it) => (
          <li key={it.index} className="flex items-start gap-2">
            <button
              data-testid={`kds-item-toggle-${ticket.id}-${it.index}`}
              onClick={() => onItemStatus(ticket.id, it.index, NEXT_STATUS[it.kds_status] || "new")}
              className="mt-0.5 w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
              title={`Click to mark as ${NEXT_STATUS[it.kds_status]}`}
              style={{
                background: it.kds_status === "ready" ? "#22c55e" : it.kds_status === "preparing" ? "#f59e0b" : "var(--pos-panel-2)",
                border: "1px solid var(--pos-border)",
                color: it.kds_status === "new" ? "var(--pos-muted)" : "#0a0a0a",
              }}
            >
              {it.kds_status === "ready" ? <CheckCircle2 className="w-3.5 h-3.5" /> : it.kds_status === "preparing" ? "•" : ""}
            </button>
            <div className="flex-1 min-w-0">
              <div className={`text-sm ${it.kds_status === "ready" ? "line-through opacity-60" : ""}`} style={{ color: "var(--pos-text)" }}>
                <span className="font-bold tabular-nums mr-1">×{it.qty}</span>
                {it.name}
              </div>
              {it.mods?.length > 0 && (
                <div className="text-[11px] mt-0.5 truncate" style={{ color: "var(--pos-muted)" }}>{it.mods.join(" · ")}</div>
              )}
            </div>
            <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded mt-0.5"
              style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>{it.station}</span>
          </li>
        ))}
      </ul>
      {lane === "ready" && (
        <button data-testid={`kds-recall-${ticket.id}`} onClick={() => onRecall(ticket.id)}
          className="mt-3 w-full pos-btn h-8 rounded-md text-[11px] font-bold flex items-center justify-center gap-1.5"
          style={{ background: "var(--pos-panel-2)", color: "#fca5a5", border: "1px solid #7d2e2e" }}>
          <RotateCcw className="w-3 h-3" /> Recall
        </button>
      )}
    </motion.div>
  );
}

function Lane({ laneKey, label, accent, tickets, onItemStatus, onRecall, newIds }) {
  return (
    <div data-testid={`kds-lane-${laneKey}`} className="flex flex-col rounded-xl flex-1 min-w-0"
      style={{ background: "var(--pos-bg)", border: "1px solid var(--pos-border)" }}>
      <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: `2px solid ${accent}`, background: "var(--pos-panel)" }}>
        <div className="text-sm font-extrabold uppercase tracking-wider" style={{ color: accent }}>{label}</div>
        <div data-testid={`kds-lane-count-${laneKey}`} className="text-xs tabular-nums px-2 py-0.5 rounded-full font-bold"
          style={{ background: accent + "22", color: accent }}>{tickets.length}</div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
        {tickets.length === 0 ? (
          <div className="text-center text-[11px] py-8" style={{ color: "var(--pos-muted)" }}>—</div>
        ) : (
          <AnimatePresence initial={false}>
            {tickets.map((t) => (
              <TicketCard key={t.id} ticket={t} onItemStatus={onItemStatus} onRecall={onRecall} justArrived={newIds.has(t.id) && laneKey === "new"} />
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

/** Standalone Kitchen Display board — no Pos auth, just a long-lived ?token=.
 *  URL forms:
 *     /kds?token=...                    → all stations
 *     /kds/:station?token=...           → single station (kitchen / pizza / grill / drinks / desserts)
 */
export default function KDSBoard() {
  const { station: stationParam } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const token = search.get("token") || "";
  const station = stationParam || "all";
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(true);
  const [soundOn, setSoundOn] = useState(true);
  const knownIds = useRef(new Set());
  const newIds = useRef(new Set());

  const refresh = useCallback(async () => {
    try {
      const d = await kdsApi.tickets(token, station);
      setError(null);
      const incomingNew = new Set();
      for (const t of d.tickets) {
        if (t.lane === "new" && !knownIds.current.has(t.id)) incomingNew.add(t.id);
      }
      if (incomingNew.size > 0 && knownIds.current.size > 0 && soundOn) playBeep();
      newIds.current = incomingNew;
      knownIds.current = new Set(d.tickets.map((t) => t.id));
      setData(d);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Could not load KDS");
    } finally { setBusy(false); }
  }, [token, station, soundOn]);

  useEffect(() => {
    if (!token) { setBusy(false); setError("Missing ?token= in the URL"); return; }
    refresh();
    // WebSocket push for instant updates with exponential-backoff reconnect.
    // Also re-validates the token periodically by refreshing — if the server
    // starts returning 401 we surface a clear "token expired" banner instead
    // of going silent.
    const wsBase = (process.env.REACT_APP_BACKEND_URL || "").replace(/^http/, "ws");
    let ws = null;
    let pollId = null;
    let reconnectId = null;
    let closed = false;
    let attempt = 0;
    const connect = () => {
      try {
        ws = new WebSocket(`${wsBase}/api/ws/kds?token=${encodeURIComponent(token)}`);
        ws.onopen = () => { attempt = 0; };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (["order.upserted", "kds.updated", "kds.ticket"].includes(msg.type)) refresh();
          } catch {}
        };
        ws.onclose = () => {
          if (closed) return;
          attempt += 1;
          // 1s, 2s, 4s, 8s, capped at 30s — avoids hammering a flapping server.
          const delay = Math.min(30000, 1000 * Math.pow(2, attempt - 1));
          reconnectId = setTimeout(connect, delay);
        };
        ws.onerror = () => { try { ws.close(); } catch {} };
      } catch {}
    };
    connect();
    pollId = setInterval(refresh, 30000); // safety net + token-staleness check
    return () => {
      closed = true;
      clearTimeout(reconnectId);
      try { ws && ws.close(); } catch {}
      clearInterval(pollId);
    };
  }, [refresh, token]);

  const onItemStatus = async (orderId, idx, status) => {
    await kdsApi.setItemStatus(token, orderId, idx, status);
    refresh();
  };
  const onRecall = async (orderId) => {
    await kdsApi.recall(token, orderId);
    refresh();
  };

  const grouped = useMemo(() => {
    const out = { new: [], preparing: [], ready: [], recall: [] };
    (data?.tickets || []).forEach((t) => { (out[t.lane] || out.new).push(t); });
    return out;
  }, [data]);

  if (!token || error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "var(--pos-bg)" }}>
        <div className="max-w-md text-center" data-testid="kds-error">
          <AlertTriangle className="w-10 h-10 mx-auto mb-3" style={{ color: "#ef4444" }} />
          <h1 className="text-xl font-bold" style={{ color: "var(--pos-text)" }}>Cannot open Kitchen Display</h1>
          <p className="text-sm mt-2" style={{ color: "var(--pos-muted)" }}>
            {error || "This screen requires a long-lived KDS token in the URL."}
          </p>
          <p className="text-xs mt-3" style={{ color: "var(--pos-muted)" }}>
            Ask the Platform Owner for the URL from Owner Portal → Tenant detail → KDS token.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="kds-board" className="min-h-screen flex flex-col" style={{ background: "var(--pos-bg)" }}>
      <header className="flex items-center justify-between px-4 py-3" style={{ background: "var(--pos-panel)", borderBottom: "1px solid var(--pos-border)" }}>
        <div className="flex items-center gap-3">
          <ChefHat className="w-6 h-6" style={{ color: "var(--pos-accent)" }} />
          <div>
            <div className="text-base font-extrabold" style={{ color: "var(--pos-text)" }}>Kitchen Display</div>
            <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>{data?.tenant?.name || "—"} · {station}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {(data?.stations || []).concat(["all"]).map((s) => {
            const active = (station === s) || (s === "all" && station === "all");
            return (
              <button key={s} data-testid={`kds-station-${s}`} onClick={() => {
                const path = s === "all" ? "/kds" : `/kds/${s}`;
                navigate(`${path}?token=${encodeURIComponent(token)}`);
              }} className="pos-btn h-8 px-3 rounded-md text-[11px] font-bold capitalize"
                style={{ background: active ? "var(--pos-accent)" : "var(--pos-panel-2)", color: active ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                {s}
              </button>
            );
          })}
          <button data-testid="kds-toggle-sound" onClick={() => setSoundOn((s) => !s)}
            className="pos-btn h-8 w-8 rounded-md flex items-center justify-center ml-2"
            style={{ background: "var(--pos-panel-2)", color: soundOn ? "var(--pos-accent)" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}
            title={soundOn ? "Mute alerts" : "Enable audio alerts"}>
            {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <button data-testid="kds-refresh" onClick={refresh} className="pos-btn h-8 w-8 rounded-md flex items-center justify-center"
            style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
            <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-3 p-3 min-h-0">
        {LANES.map((l) => (
          <Lane key={l.key} laneKey={l.key} label={l.label} accent={l.accent}
            tickets={grouped[l.key] || []} onItemStatus={onItemStatus} onRecall={onRecall} newIds={newIds.current} />
        ))}
      </main>
      {busy && !data && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ color: "var(--pos-text)" }}>
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}
    </div>
  );
}
