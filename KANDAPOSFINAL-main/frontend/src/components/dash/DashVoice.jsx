import React, { useEffect, useMemo, useState } from "react";
import { voiceApi } from "../../api/client";
import { toast } from "sonner";
import { Phone, PhoneCall, Loader2, CheckCircle2, AlertTriangle, Link2, Copy, Download, PhoneOutgoing, Play, ShoppingCart } from "lucide-react";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import TwilioNumberDialog from "./TwilioNumberDialog";
import LiveCallsPanel from "./LiveCallsPanel";

/**
 * Restaurant Owner Dashboard — Voice agent config + call log.
 * Route: /biz/voice (mounted from App.js)
 */
export default function DashVoice() {
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [calls, setCalls] = useState([]);
  const [selected, setSelected] = useState(null);
  // Local drafts for text-heavy fields (only sync back to server on explicit Save).
  const [greetingDraft, setGreetingDraft] = useState("");
  const [personaDraft, setPersonaDraft] = useState("");
  const [testDialing, setTestDialing] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [buyOpen, setBuyOpen] = useState(false);
  const DEFAULT_TEST_MSG = "Briefly greet in English, then Hindi, then Telugu. Then ask how you can help.";
  const [testMessage, setTestMessage] = useState(() =>
    localStorage.getItem("kanda_voice_test_msg") || DEFAULT_TEST_MSG
  );

  const load = () => {
    voiceApi.config().then((c) => {
      setCfg(c);
      setGreetingDraft(c?.greeting || "");
      setPersonaDraft(c?.persona || "");
    }).catch(() => toast.error("Failed to load voice config"));
    voiceApi.calls(100).then(setCalls).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  if (!cfg) return <div className="p-6 text-sm" style={{ color: "var(--pos-muted)" }}>Loading voice agent…</div>;

  const save = async (patch) => {
    setBusy(true);
    try {
      const next = await voiceApi.saveConfig(patch);
      setCfg(next);
      if (patch.greeting !== undefined) setGreetingDraft(next.greeting || "");
      if (patch.persona !== undefined) setPersonaDraft(next.persona || "");
      toast.success("Saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally { setBusy(false); }
  };

  const autoConfigure = async () => {
    if (!cfg.twilio_number) { toast.error("Add a Twilio number first"); return; }
    setBusy(true);
    try {
      const r = await voiceApi.configureTwilio();
      toast.success(`Twilio webhook updated → ${r.configured_url}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Auto-configure failed — fall back to manual setup");
    } finally { setBusy(false); }
  };

  const placeTestCall = async (opts = {}) => {
    const to = (opts.to || testTo).trim();
    if (!/^\+?\d{10,15}$/.test(to.replace(/\s+/g, ""))) {
      toast.error("Enter a valid phone number in E.164 format (e.g. +916303435484)");
      return;
    }
    setTestDialing(true);
    try {
      const r = await voiceApi.testCall({ to, purpose: opts.purpose || "test_call", message: opts.message || testMessage });
      toast.success(`Calling ${r.to}… pick up your phone!`, { duration: 8000 });
      setTimeout(() => voiceApi.calls(100).then(setCalls).catch(() => {}), 30000);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Call failed");
    } finally { setTestDialing(false); }
  };

  const callBack = (number) => {
    if (!number) { toast.error("No number on this call to call back"); return; }
    setTestTo(number);
    placeTestCall({ to: number, purpose: "callback",
      message: "You are calling this customer back. Politely introduce yourself and ask if they'd like to place an order or need assistance." });
  };

  const copy = (txt) => { navigator.clipboard.writeText(txt); toast.success("Copied"); };
  const greetingDirty = greetingDraft !== (cfg.greeting || "");
  const personaDirty = personaDraft !== (cfg.persona || "");

  return (
    <div className="p-6 max-w-5xl space-y-6" data-testid="dash-voice">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--pos-text)" }}>AI Calling Agent</h1>
        <p className="text-sm" style={{ color: "var(--pos-muted)" }}>
          A multilingual phone agent that picks up calls, takes orders, books reservations,
          and answers questions in English, Hindi, or Telugu — auto-detected from the caller.
        </p>
      </div>

      {/* Status banner */}
      <div className="rounded-xl p-4 flex items-center justify-between"
        style={{ background: cfg.enabled ? "linear-gradient(135deg, #0e2515, #14361f)" : "var(--pos-panel)",
                 border: `1px solid ${cfg.enabled ? "#1d4d2d" : "var(--pos-border)"}` }}>
        <div className="flex items-center gap-3">
          {cfg.enabled
            ? <CheckCircle2 className="w-6 h-6" style={{ color: "#86efac" }} />
            : <AlertTriangle className="w-6 h-6" style={{ color: "#fbbf24" }} />}
          <div>
            <div className="text-base font-bold" style={{ color: cfg.enabled ? "#fff" : "var(--pos-text)" }}>
              {cfg.enabled ? "Agent is LIVE" : "Agent is OFF"}
            </div>
            <div className="text-xs" style={{ color: "var(--pos-muted)" }}>
              {cfg.enabled
                ? <>Customers dialing <strong>{cfg.twilio_number || "(no number)"}</strong> will reach the AI assistant.</>
                : "Toggle on after you've configured your Twilio number below."}
            </div>
          </div>
        </div>
        <Switch data-testid="voice-enable-toggle" checked={cfg.enabled}
          disabled={busy}
          onCheckedChange={(v) => save({ enabled: v })} />
      </div>

      {/* Configuration panel */}
      <div className="rounded-xl p-5 space-y-4"
        style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
        <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--pos-text)" }}>Configuration</h2>

        <Field label="Twilio phone number" hint="The Twilio number customers will dial. Must already exist in your Twilio account.">
          <div className="flex items-center gap-2 flex-wrap">
            <Input data-testid="voice-twilio-number" value={cfg.twilio_number || ""}
              onChange={(e) => setCfg({ ...cfg, twilio_number: e.target.value })}
              onBlur={(e) => e.target.value !== cfg.twilio_number && save({ twilio_number: e.target.value })}
              placeholder="+19086498077"
              className="max-w-xs"
              style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
            <button data-testid="voice-auto-configure" onClick={autoConfigure} disabled={busy || !cfg.twilio_number}
              className="pos-btn h-9 px-3 rounded-md text-xs font-bold text-white flex items-center gap-2"
              style={{ background: "var(--pos-accent)", opacity: (busy || !cfg.twilio_number) ? 0.5 : 1 }}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
              Auto-wire webhook
            </button>
            <button data-testid="voice-buy-number" onClick={() => setBuyOpen(true)}
              className="pos-btn h-9 px-3 rounded-md text-xs font-bold text-white flex items-center gap-2"
              style={{ background: "#0ea5e9" }}>
              <ShoppingCart className="w-3.5 h-3.5" /> Buy a new number
            </button>
          </div>
          <p className="text-[11px] mt-2" style={{ color: "var(--pos-muted)" }}>
            Or set this URL manually in your Twilio number&apos;s
            <em> Voice & Fax → A CALL COMES IN → Webhook</em>:
            <button onClick={() => copy(cfg.webhook_url)} className="ml-2 underline inline-flex items-center gap-1">
              <code className="text-xs" style={{ color: "#7dd3fc" }}>{cfg.webhook_url}</code>
              <Copy className="w-3 h-3" />
            </button>
          </p>
        </Field>

        <Field label="Default language" hint="Which language the agent speaks first. It will switch if the caller responds in a different language.">
          <Select value={cfg.default_language || "te"} onValueChange={(v) => save({ default_language: v })}>
            <SelectTrigger data-testid="voice-lang-select" className="max-w-xs" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="te">Telugu (Telangana) — default</SelectItem>
              <SelectItem value="hi">Hindi</SelectItem>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="auto">Auto-detect (start Telugu, switch on caller)</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="Voice" hint="'marin' / 'sage' / 'coral' sound the most natural for Indian languages. Avoid 'alloy' — it's the most robotic.">
          <Select value={cfg.voice || "marin"} onValueChange={(v) => save({ voice: v })}>
            <SelectTrigger data-testid="voice-voice-select" className="max-w-xs" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["marin", "sage", "coral", "ash", "ballad", "echo", "shimmer", "verse", "alloy"].map((v) =>
                <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Custom greeting" hint="What the agent says when answering (leave blank to auto-generate).">
          <div className="flex items-center gap-2">
            <Input data-testid="voice-greeting" value={greetingDraft}
              onChange={(e) => setGreetingDraft(e.target.value)}
              placeholder="Hello, thank you for calling Kanda Pizza! How can I help you today?"
              className="flex-1"
              style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
            <button data-testid="voice-greeting-save"
              onClick={() => save({ greeting: greetingDraft })}
              disabled={!greetingDirty || busy}
              className="pos-btn h-9 px-4 rounded-md text-xs font-bold shrink-0"
              style={{ background: greetingDirty ? "var(--pos-accent)" : "var(--pos-panel-2)", opacity: (!greetingDirty || busy) ? 0.5 : 1, color: greetingDirty ? "#fff" : "var(--pos-text)" }}>
              {greetingDirty ? "Save" : "Saved"}
            </button>
          </div>
        </Field>

        <Field label="Owner instructions (optional)" hint="Free-form prompt additions — e.g. 'Always suggest garlic bread as an upsell', 'Mention our weekday combo'.">
          <textarea data-testid="voice-persona" value={personaDraft}
            onChange={(e) => setPersonaDraft(e.target.value)}
            placeholder="Be warm and friendly. Suggest pairing drinks with pizza orders. Mention our 10% loyalty discount for repeat customers."
            rows={3}
            className="w-full rounded-md px-3 py-2 text-sm"
            style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
          <div className="flex items-center justify-between mt-2">
            <span className="text-[11px]" style={{ color: personaDirty ? "#fbbf24" : "var(--pos-muted)" }}>
              {personaDirty ? "Unsaved changes" : "Changes saved. The AI will use these on the next call."}
            </span>
            <div className="flex items-center gap-2">
              <button data-testid="voice-persona-clear"
                onClick={() => { setPersonaDraft(""); save({ persona: "" }); }}
                disabled={busy || (!personaDraft && !cfg.persona)}
                className="pos-btn h-9 px-3 rounded-md text-xs"
                style={{ background: "var(--pos-panel-2)", opacity: (busy || (!personaDraft && !cfg.persona)) ? 0.5 : 1, color: "var(--pos-text)" }}>
                Clear
              </button>
              <button data-testid="voice-persona-save"
                onClick={() => save({ persona: personaDraft })}
                disabled={!personaDirty || busy}
                className="pos-btn h-9 px-4 rounded-md text-xs font-bold"
                style={{ background: personaDirty ? "var(--pos-accent)" : "var(--pos-panel-2)", opacity: (!personaDirty || busy) ? 0.5 : 1, color: personaDirty ? "#fff" : "var(--pos-text)" }}>
                {personaDirty ? "Save instructions" : "Saved"}
              </button>
            </div>
          </div>
        </Field>
      </div>

      {/* Outbound Test Call panel */}
      <div className="rounded-xl p-5 space-y-3"
        style={{ background: "linear-gradient(135deg, #14213a, #1a2b4d)", border: "1px solid #1e3a5f" }}>
        <div className="flex items-center gap-2">
          <PhoneCall className="w-4 h-4" style={{ color: "#7dd3fc" }} />
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Place a test call</h2>
        </div>
        <p className="text-xs" style={{ color: "var(--pos-muted)" }}>
          Dial any number and the AI agent will call it, greeting the caller in English / Hindi / Telugu.
          Great for showing the agent to staff or verifying config after edits.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input data-testid="voice-test-to" value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="+916303435484"
            className="text-white flex-1"
            style={{ background: "rgba(0,0,0,0.3)", borderColor: "#1e3a5f" }} />
          <button data-testid="voice-test-call-btn" onClick={placeTestCall}
            disabled={testDialing || !testTo.trim()}
            className="pos-btn h-10 px-5 rounded-md text-xs font-bold text-white flex items-center justify-center gap-2 shrink-0"
            style={{ background: "#0ea5e9", opacity: (testDialing || !testTo.trim()) ? 0.5 : 1 }}>
            {testDialing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneCall className="w-4 h-4" />}
            {testDialing ? "Dialling…" : "Call now"}
          </button>
        </div>
        <textarea data-testid="voice-test-message" value={testMessage}
          onChange={(e) => setTestMessage(e.target.value)}
          rows={2} placeholder="What should the AI say/do on this call?"
          className="w-full rounded-md px-3 py-2 text-xs text-white"
          style={{ background: "rgba(0,0,0,0.3)", border: "1px solid #1e3a5f" }} />
        <div className="flex items-center justify-between">
          <p className="text-[11px]" style={{ color: "var(--pos-muted)" }}>
            <strong style={{ color: "#fbbf24" }}>Tip:</strong> save this as your default script so you don&apos;t retype it every time.
          </p>
          <button data-testid="voice-test-msg-save"
            onClick={() => {
              localStorage.setItem("kanda_voice_test_msg", testMessage);
              toast.success("Saved as your default test-call script");
            }}
            className="pos-btn h-8 px-3 rounded-md text-[11px] font-bold text-white"
            style={{ background: "rgba(255,255,255,0.1)", border: "1px solid #1e3a5f" }}>
            Save as default
          </button>
        </div>
      </div>

      {/* OpenAI billing notice */}
      <div className="rounded-xl p-4 text-xs"
        style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-muted)" }}>
        <strong style={{ color: "var(--pos-text)" }}>Heads up:</strong> The AI brain runs on OpenAI&apos;s Realtime API
        (~₹5 per call minute). Make sure your OpenAI account at
        {" "}<a href="https://platform.openai.com/account/billing" target="_blank" rel="noreferrer" className="underline" style={{ color: "#7dd3fc" }}>platform.openai.com/account/billing</a>
        {" "}has at least $5 credit before going live, or every call will end immediately after pickup.
      </div>

      {/* Live call panel — real-time WebSocket-pushed transcripts */}
      <LiveCallsPanel />

      {/* Call log */}
      <div className="rounded-xl"
        style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
        <div className="p-5 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--pos-text)" }}>Call Log ({calls.length})</h2>
          <button onClick={load} className="pos-btn h-8 px-3 rounded-md text-xs" style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)" }}>Refresh</button>
        </div>
        <table className="w-full text-sm">
          <thead style={{ color: "var(--pos-muted)" }}>
            <tr style={{ borderTop: "1px solid var(--pos-border)" }}>
              <th className="text-left py-2 px-4 uppercase text-[10px] tracking-wider">Time</th>
              <th className="text-left py-2 px-4 uppercase text-[10px] tracking-wider">From</th>
              <th className="text-left py-2 px-4 uppercase text-[10px] tracking-wider">Direction</th>
              <th className="text-right py-2 px-4 uppercase text-[10px] tracking-wider">Duration</th>
              <th className="text-left py-2 px-4 uppercase text-[10px] tracking-wider">Outcome</th>
              <th className="py-2 px-4"></th>
            </tr>
          </thead>
          <tbody style={{ color: "var(--pos-text)" }}>
            {calls.length === 0 && <tr><td colSpan={6} className="text-center py-12" style={{ color: "var(--pos-muted)" }}>
              <Phone className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No calls yet. Toggle the agent on and dial your Twilio number to test.
            </td></tr>}
            {calls.map((c) => {
              const other = c.direction === "outbound" ? c.to : c.from;
              const hasRec = !!c.recording_sid;
              return (
                <tr key={c.id} data-testid={`call-row-${c.id}`}
                  style={{ borderTop: "1px solid var(--pos-border)" }}
                  className="hover:bg-white/5">
                  <td className="py-2 px-4 tabular-nums cursor-pointer" style={{ color: "var(--pos-muted)" }}
                    onClick={() => voiceApi.call(c.id).then(setSelected)}>
                    {new Date(c.started_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="py-2 px-4 tabular-nums cursor-pointer"
                    onClick={() => voiceApi.call(c.id).then(setSelected)}>
                    {other || "—"}
                  </td>
                  <td className="py-2 px-4 cursor-pointer" style={{ color: "var(--pos-muted)" }}
                    onClick={() => voiceApi.call(c.id).then(setSelected)}>
                    {c.direction}
                  </td>
                  <td className="py-2 px-4 text-right tabular-nums cursor-pointer"
                    onClick={() => voiceApi.call(c.id).then(setSelected)}>
                    {c.duration_seconds}s
                  </td>
                  <td className="py-2 px-4 cursor-pointer"
                    onClick={() => voiceApi.call(c.id).then(setSelected)}>
                    <IntentBadge intent={c.intent} />
                  </td>
                  <td className="py-2 px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button data-testid={`call-view-${c.id}`}
                        onClick={() => voiceApi.call(c.id).then(setSelected)}
                        title="View transcript"
                        className="pos-btn p-1.5 rounded-md" style={{ background: "var(--pos-panel-2)" }}>
                        <PhoneCall className="w-3.5 h-3.5" style={{ color: "#7dd3fc" }} />
                      </button>
                      {hasRec && (
                        <button data-testid={`call-rec-${c.id}`}
                          onClick={(e) => { e.stopPropagation(); voiceApi.call(c.id).then(setSelected); }}
                          title={`Play recording (${c.recording_duration || "?"}s)`}
                          className="pos-btn p-1.5 rounded-md flex items-center" style={{ background: "var(--pos-panel-2)" }}>
                          <Play className="w-3.5 h-3.5" style={{ color: "#86efac" }} />
                        </button>
                      )}
                      <button data-testid={`call-back-${c.id}`}
                        onClick={(e) => { e.stopPropagation(); callBack(other); }}
                        disabled={!other || testDialing}
                        title={`Call ${other || "(no number)"} back`}
                        className="pos-btn p-1.5 rounded-md" style={{ background: "var(--pos-panel-2)", opacity: !other || testDialing ? 0.4 : 1 }}>
                        <PhoneOutgoing className="w-3.5 h-3.5" style={{ color: "#fbbf24" }} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <CallTranscriptDialog call={selected} onClose={() => setSelected(null)}
        onCallBack={callBack} testDialing={testDialing} />
      <TwilioNumberDialog open={buyOpen} onClose={() => setBuyOpen(false)}
        onPurchased={(num) => { setCfg({ ...cfg, twilio_number: num, enabled: true }); load(); }} />
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="text-xs font-bold block mb-1" style={{ color: "var(--pos-text)" }}>{label}</label>
      {hint && <p className="text-[11px] mb-2" style={{ color: "var(--pos-muted)" }}>{hint}</p>}
      {children}
    </div>
  );
}

function IntentBadge({ intent }) {
  if (!intent) return <span className="text-xs" style={{ color: "var(--pos-muted)" }}>—</span>;
  const colour = {
    order_placed: ["#0e2515", "#86efac"],
    reservation_booked: ["#13283c", "#7dd3fc"],
  }[intent] || ["var(--pos-panel-2)", "var(--pos-muted)"];
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: colour[0], color: colour[1] }}>
      {intent.replace("_", " ")}
    </span>
  );
}

function CallTranscriptDialog({ call: initialCall, onClose, onCallBack, testDialing }) {
  const [call, setCall] = useState(initialCall);
  const [recSrc, setRecSrc] = useState("");  // blob URL for authenticated MP3
  useEffect(() => { setCall(initialCall); setRecSrc(""); }, [initialCall]);

  // Fetch the recording as a blob (so the Bearer auth header is sent), then
  // hand it to the <audio> element as an object URL. The bare <audio src=API>
  // approach doesn't work because browsers don't propagate custom headers.
  useEffect(() => {
    if (!call?.recording_sid) { setRecSrc(""); return; }
    let cancelled = false;
    let objectUrl = "";
    voiceApi.recordingBlob(call.id).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setRecSrc(objectUrl);
    }).catch(() => setRecSrc(""));
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [call?.id, call?.recording_sid]);

  useEffect(() => {
    if (!call) return;
    const isComplete = call.recording_sid && (call.transcript?.length ?? 0) > 0 && call.ended_at;
    if (isComplete) return;
    const t = setInterval(async () => {
      try {
        const fresh = await voiceApi.call(call.id);
        setCall(fresh);
      } catch (e) { /* silent */ }
    }, 15000);
    return () => clearInterval(t);
  }, [call?.id, call?.recording_sid, call?.transcript?.length, call?.ended_at]);

  const messages = call?.transcript || [];
  const other = call?.direction === "outbound" ? call?.to : call?.from;

  const downloadTranscript = () => {
    if (!call) return;
    const header = [
      `Kanda POS — Call Transcript`,
      `Call ID: ${call.id}`,
      `Direction: ${call.direction}`,
      `From: ${call.from || "—"}   To: ${call.to || "—"}`,
      `Started: ${call.started_at}`,
      `Duration: ${call.duration_seconds}s`,
      `Intent: ${call.intent || "—"}`,
      "",
      "-".repeat(60), "",
    ].join("\n");
    const body = messages.map((m) =>
      `[${new Date(m.at).toLocaleTimeString("en-GB")}] ${m.role === "user" ? "CALLER" : "AGENT"}: ${m.text}`
    ).join("\n");
    const blob = new Blob([header + body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `call-${call.id}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast.success("Transcript downloaded");
  };

  return (
    <Dialog open={!!call} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl border max-h-[85vh] overflow-y-auto"
        style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: "var(--pos-text)" }}>
            <PhoneCall className="w-4 h-4" /> Call transcript
            {call && <span className="text-xs font-normal" style={{ color: "var(--pos-muted)" }}>
              · {other} · {call.duration_seconds}s · <IntentBadge intent={call.intent} />
            </span>}
          </DialogTitle>
        </DialogHeader>

        {call && (
          <div className="flex flex-wrap gap-2 pb-2">
            {call.recording_sid ? (
              recSrc ? (
                <div className="flex items-center gap-2 rounded-lg px-3 py-2 flex-1 min-w-[280px]"
                  style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                  <Play className="w-4 h-4" style={{ color: "#86efac" }} />
                  <audio data-testid="call-recording-player" controls preload="metadata"
                    src={recSrc} className="flex-1" style={{ height: 32 }} />
                  <a href={recSrc} download={`call-${call.id}.mp3`}
                    data-testid="call-recording-download"
                    title="Download MP3" className="pos-btn p-1.5 rounded-md"
                    style={{ background: "var(--pos-panel)" }}>
                    <Download className="w-3.5 h-3.5" style={{ color: "#7dd3fc" }} />
                  </a>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
                  style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-muted)" }}>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading recording…
                </div>
              )
            ) : (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
                style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-muted)" }}>
                Recording still processing (Twilio delivers ~30 s after the call ends). Refresh in a minute.
              </div>
            )}
            <button data-testid="call-download-transcript" onClick={downloadTranscript}
              disabled={messages.length === 0}
              className="pos-btn h-9 px-3 rounded-md text-xs font-bold flex items-center gap-2"
              style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", opacity: messages.length === 0 ? 0.5 : 1, color: "var(--pos-text)" }}>
              <Download className="w-3.5 h-3.5" /> Download .txt
            </button>
            <button data-testid="call-callback-btn" onClick={() => onCallBack && onCallBack(other)}
              disabled={!other || testDialing}
              className="pos-btn h-9 px-3 rounded-md text-xs font-bold text-white flex items-center gap-2"
              style={{ background: "#0ea5e9", opacity: (!other || testDialing) ? 0.5 : 1 }}>
              <PhoneOutgoing className="w-3.5 h-3.5" /> Call {other || "(no number)"} back
            </button>
          </div>
        )}

        {messages.length === 0
          ? <p className="text-sm text-center py-8" style={{ color: "var(--pos-muted)" }}>
              No transcript captured (call may have been too short).
            </p>
          : <div className="space-y-3">
            {messages.map((m, i) => (
              <div key={i} className="flex gap-3" data-testid={`transcript-line-${i}`}>
                <div className="text-[10px] tabular-nums shrink-0 w-12" style={{ color: "var(--pos-muted)" }}>
                  {new Date(m.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </div>
                <div className="text-[10px] uppercase tracking-wider shrink-0 w-16"
                  style={{ color: m.role === "user" ? "#fbbf24" : "#7dd3fc" }}>
                  {m.role === "user" ? "Caller" : "Agent"}
                </div>
                <div className="text-sm" style={{ color: "var(--pos-text)" }}>{m.text}</div>
              </div>
            ))}
          </div>}
      </DialogContent>
    </Dialog>
  );
}
