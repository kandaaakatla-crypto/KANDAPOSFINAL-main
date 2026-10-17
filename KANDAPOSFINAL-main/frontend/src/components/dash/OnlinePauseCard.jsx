import React, { useEffect, useState } from "react";
import { Globe, PauseCircle, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { useDash } from "../../store/DashContext";

// "Kitchen is slammed" switch: stop new online pickup and website orders for
// a while, or until reopened. The server enforces it (routes/online_pause.py);
// a timed pause lifts itself, so this card just reflects the state.

const OPTIONS = [
  { minutes: 15, label: "15 min" },
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
  { minutes: null, label: "Until I reopen" },
];

export default function OnlinePauseCard() {
  const { api } = useDash();
  const [state, setState] = useState(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/tenant/online-pause").then((r) => setState(r.data)).catch(() => {});
  }, [api]);

  // A timed pause ends on the server by itself; flip the card back when the
  // end time passes so it doesn't keep saying "paused".
  useEffect(() => {
    if (!state?.paused || !state.until) return undefined;
    const ms = new Date(state.until) - new Date();
    if (ms <= 0) { setState({ paused: false }); return undefined; }
    const id = setTimeout(() => setState({ paused: false }), Math.min(ms, 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [state]);

  const save = async (body, message) => {
    setBusy(true);
    try {
      const r = await api.put("/tenant/online-pause", body);
      setState(r.data);
      setPicking(false);
      toast.success(message);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not change online orders");
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;
  const until = state.until ? new Date(state.until).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : null;

  return (
    <div className="lg-card rounded-2xl p-4" data-testid="online-pause-card"
      style={state.paused ? { borderColor: "rgba(217,119,6,0.55)", background: "rgba(245,158,11,0.10)" } : undefined}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={{ background: state.paused ? "rgba(217,119,6,0.16)" : "rgba(34,197,94,0.14)" }}>
          <Globe className="w-4 h-4" style={{ color: state.paused ? "#d97706" : "#16a34a" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold" style={{ color: "var(--pos-text)" }} data-testid="online-pause-status">
            {state.paused ? "Online orders paused" : "Taking online orders"}
          </div>
          <div className="text-xs" style={{ color: "var(--pos-muted)" }}>
            {state.paused ? (until ? `Back on at ${until}` : "Until you reopen") : "Pickup and website orders are open"}
          </div>
        </div>
        {state.paused ? (
          <button type="button" disabled={busy} onClick={() => save({ resume: true }, "Online orders are back on")} data-testid="online-pause-resume"
            className="lg-press h-9 px-3 rounded-full text-xs font-bold flex items-center gap-1 text-white shrink-0" style={{ background: "#16a34a" }}>
            <PlayCircle className="w-4 h-4" /> Resume
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => setPicking((p) => !p)} data-testid="online-pause-open"
            className="lg-press h-9 px-3 rounded-full text-xs font-bold flex items-center gap-1 shrink-0"
            style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)" }}>
            <PauseCircle className="w-4 h-4" /> Pause
          </button>
        )}
      </div>
      {picking && !state.paused && (
        <div className="mt-3 grid grid-cols-3 gap-2" data-testid="online-pause-options">
          {OPTIONS.map((o) => (
            <button key={o.label} type="button" disabled={busy} data-testid={`online-pause-${o.minutes ?? "closed"}`}
              onClick={() => save({ minutes: o.minutes }, o.minutes ? `Online orders paused for ${o.label}` : "Online orders paused until you reopen")}
              className={`lg-press h-9 rounded-full text-xs font-semibold ${o.minutes == null ? "col-span-2" : ""}`}
              style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)" }}>
              {o.label}
            </button>
          ))}
        </div>
      )}
      <p className="text-[11px] mt-2" style={{ color: "var(--pos-muted)" }}>
        Dine-in QR orders from seated tables still come through. Swiggy and Zomato follow once they're connected.
      </p>
    </div>
  );
}
