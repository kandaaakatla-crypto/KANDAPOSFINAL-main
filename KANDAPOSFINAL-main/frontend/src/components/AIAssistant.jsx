import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { assistantApi } from "../api/client";
import { Sparkles, Send, X, Loader2, Bot, User as UserIcon, Mic, MicOff, Volume2, VolumeX } from "lucide-react";

/**
 * Floating "Ask AI" bubble — text and voice.
 *
 * Voice mode uses MediaRecorder to capture a short clip, POSTs it to
 * /api/assistant/transcribe (server-side Whisper), then sends the text to
 * /api/assistant/chat. AI replies are read aloud via speechSynthesis.
 * Chosen over the browser SpeechRecognition API because the latter is
 * unreliable inside embedded previews and Safari.
 */
export default function AIAssistant() {
  const location = useLocation();
  const token = localStorage.getItem("kanda_pos_token_v1");
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  // Voice mode state
  const [voiceMode, setVoiceMode] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speakOut, setSpeakOut] = useState(true);
  const [voiceError, setVoiceError] = useState("");
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const bottomRef = useRef(null);

  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const mediaSupported = typeof navigator !== "undefined"
    && navigator.mediaDevices?.getUserMedia
    && typeof window !== "undefined" && "MediaRecorder" in window;

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollTop = bottomRef.current.scrollHeight;
  }, [messages, busy, transcribing]);

  // Cleanup on close/unmount.
  useEffect(() => {
    const cleanup = () => {
      try {
        if (ttsSupported) window.speechSynthesis.cancel();
      } catch (_) { /* ignore */ }
      const rec = mediaRecorderRef.current;
      if (rec && rec.state !== "inactive") {
        try { rec.stop(); } catch (_) { /* ignore */ }
      }
      mediaRecorderRef.current = null;
      try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch (_) { /* ignore */ }
      streamRef.current = null;
    };
    if (!open) cleanup();
    return cleanup;
  }, [open, ttsSupported]);

  if (!token) return null;
  const path = location.pathname || "";
  if (["/login", "/biz/login", "/owner/login", "/clock"].some((p) => path === p || path.startsWith(p + "/"))) {
    return null;
  }

  const speak = (text) => {
    if (!speakOut || !text || !ttsSupported) return;
    try {
      window.speechSynthesis.cancel();
      const clean = text
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/`(.*?)`/g, "$1")
        .replace(/[#*_>]/g, "")
        .replace(/\n+/g, ". ");
      const u = new SpeechSynthesisUtterance(clean);
      u.rate = 1.05; u.pitch = 1.0; u.lang = "en-IN";
      window.speechSynthesis.speak(u);
    } catch (_) { /* ignore */ }
  };

  const send = async (rawText) => {
    const q = (rawText ?? input).trim();
    if (!q || busy) return;
    const next = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const r = await assistantApi.chat({
        messages: next.map(({ role, content }) => ({ role, content })),
        route: path,
      });
      setMessages([...next, { role: "assistant", content: r.reply, tools_used: r.tools_used }]);
      speak(r.reply);
    } catch (e) {
      const detail = e?.response?.data?.detail;
      const status = e?.response?.status;
      let msg = "Sorry — I couldn't answer just now. Try again in a moment.";
      if (status === 401) msg = "Your session expired. Please log in again.";
      else if (status === 402) msg = "AI credits exhausted for this workspace — please top up the Anthropic API key's billing.";
      else if (typeof detail === "string" && detail) msg = `AI error: ${detail}`;
      setMessages([...next, { role: "assistant", content: msg }]);
    } finally { setBusy(false); }
  };

  const pickMime = () => {
    // Prefer opus in webm (Chrome/Edge/Firefox); fall back for Safari.
    const opts = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg", ""];
    for (const t of opts) {
      if (!t) return "";
      if (window.MediaRecorder && window.MediaRecorder.isTypeSupported?.(t)) return t;
    }
    return "";
  };

  const startRecording = async () => {
    setVoiceError("");
    if (!mediaSupported) {
      setVoiceError("This browser doesn't support microphone capture. Try Chrome, Edge, Firefox or Safari.");
      return;
    }
    if (ttsSupported) window.speechSynthesis.cancel();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMime();
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        const type = rec.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        stopStream();
        if (blob.size < 1000) {
          setVoiceError("Didn't catch anything — please try again.");
          return;
        }
        setTranscribing(true);
        try {
          const ext = type.includes("mp4") ? "mp4" : type.includes("mpeg") ? "mp3" : "webm";
          const r = await assistantApi.transcribe(blob, `voice.${ext}`);
          const text = (r?.text || "").trim();
          if (!text) {
            setVoiceError("Couldn't hear you clearly — please try again.");
            return;
          }
          await send(text);
        } catch (e) {
          const detail = e?.response?.data?.detail || e?.message || "Transcription failed";
          setVoiceError(String(detail));
        } finally {
          setTranscribing(false);
        }
      };
      mediaRecorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (e) {
      const name = e?.name || "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setVoiceError("Microphone access was blocked. Allow it in your browser settings and reload.");
      } else if (name === "NotFoundError") {
        setVoiceError("No microphone found on this device.");
      } else {
        setVoiceError(`Mic error: ${e?.message || name || "unknown"}`);
      }
    }
  };

  const stopStream = () => {
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch (_) { /* ignore */ }
    streamRef.current = null;
  };

  const stopRecording = (silent = false) => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      try { rec.stop(); } catch (_) { /* ignore */ }
    }
    mediaRecorderRef.current = null;
    setRecording(false);
    if (silent) stopStream();
  };

  const toggleVoiceMode = () => {
    const next = !voiceMode;
    setVoiceMode(next);
    setVoiceError("");
    if (!next) {
      stopRecording(true);
      if (ttsSupported) window.speechSynthesis.cancel();
    }
  };

  const suggested = [
    "How do I refund an order?",
    "What's my revenue today?",
    "Any low stock items?",
    "How do I add a menu item?",
  ];

  return (
    <>
      {!open && (
        <button
          data-testid="ai-assistant-open"
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-5 z-[9999] pos-btn h-14 w-14 rounded-full shadow-2xl flex items-center justify-center transition-transform hover:scale-110"
          style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)" }}
          title="Ask Kanda AI"
        >
          <Sparkles className="w-6 h-6 text-white" />
        </button>
      )}

      {open && (
        <div
          data-testid="ai-assistant-panel"
          className="fixed bottom-20 right-5 z-[9999] w-[min(28rem,calc(100vw-2rem))] h-[min(36rem,calc(100vh-6rem))] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}
        >
          <div className="px-4 py-3 flex items-center justify-between"
            style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)" }}>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-white" />
              <span className="text-sm font-bold text-white">Kanda AI Assistant</span>
              {voiceMode && (
                <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                  style={{ background: "rgba(255,255,255,0.20)", color: "#fff" }}>Voice</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button data-testid="ai-toggle-voice"
                onClick={toggleVoiceMode}
                title={voiceMode ? "Switch to text mode" : "Switch to voice mode"}
                className="pos-btn w-7 h-7 rounded-md flex items-center justify-center"
                style={{ background: voiceMode ? "rgba(255,255,255,0.30)" : "rgba(255,255,255,0.15)" }}>
                {voiceMode ? <Mic className="w-4 h-4 text-white" /> : <MicOff className="w-4 h-4 text-white" />}
              </button>
              {voiceMode && (
                <button data-testid="ai-toggle-speak"
                  onClick={() => setSpeakOut(!speakOut)}
                  title={speakOut ? "Mute AI voice" : "Unmute AI voice"}
                  className="pos-btn w-7 h-7 rounded-md flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.15)" }}>
                  {speakOut ? <Volume2 className="w-4 h-4 text-white" /> : <VolumeX className="w-4 h-4 text-white" />}
                </button>
              )}
              <button data-testid="ai-assistant-close" onClick={() => setOpen(false)}
                className="pos-btn w-7 h-7 rounded-md flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.15)" }}>
                <X className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>

          <div ref={bottomRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="space-y-3">
                <div className="text-xs" style={{ color: "var(--pos-muted)" }}>
                  Hi! I can help with how-tos AND live business data. Try one of these:
                </div>
                {suggested.map((s) => (
                  <button key={s} data-testid={`ai-suggest-${s.slice(0, 15)}`}
                    onClick={() => { setInput(s); setTimeout(() => send(s), 30); }}
                    className="pos-btn w-full text-left px-3 py-2 rounded-lg text-xs text-white"
                    style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                    {s}
                  </button>
                ))}
                {voiceMode && (
                  <div className="text-[11px] p-2 rounded" style={{ background: "rgba(124,58,237,0.10)", color: "#c4b5fd" }}>
                    Voice mode is ON. Tap the mic below and speak — I&apos;ll transcribe and answer aloud.
                  </div>
                )}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className="flex gap-2" data-testid={`ai-msg-${i}`}>
                <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: m.role === "user" ? "#334155" : "#7c3aed" }}>
                  {m.role === "user"
                    ? <UserIcon className="w-3 h-3 text-white" />
                    : <Bot className="w-3 h-3 text-white" />}
                </div>
                <div className="text-sm text-white whitespace-pre-wrap flex-1 leading-relaxed">
                  {m.content}
                  {m.tools_used && m.tools_used.length > 0 && (
                    <div className="text-[10px] mt-1" style={{ color: "var(--pos-muted)" }}>
                      Live data: {m.tools_used.join(", ")}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {(busy || transcribing) && (
              <div className="flex gap-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: "#7c3aed" }}>
                  <Bot className="w-3 h-3 text-white" />
                </div>
                <div className="text-sm flex items-center gap-2" style={{ color: "var(--pos-muted)" }}>
                  <Loader2 className="w-3 h-3 animate-spin" /> {transcribing ? "transcribing…" : "thinking…"}
                </div>
              </div>
            )}
            {voiceError && (
              <div className="text-[11px] p-2 rounded" style={{ background: "rgba(220,38,38,0.15)", color: "#fca5a5" }}>
                {voiceError}
              </div>
            )}
          </div>

          <div className="p-3 flex items-center gap-2" style={{ borderTop: "1px solid var(--pos-border)" }}>
            {voiceMode ? (
              <button data-testid="ai-mic"
                onClick={recording ? () => stopRecording(false) : startRecording}
                disabled={busy || transcribing}
                className="pos-btn flex-1 h-11 rounded-lg flex items-center justify-center gap-2 text-white text-sm font-medium"
                style={{
                  background: recording
                    ? "linear-gradient(135deg,#dc2626,#b91c1c)"
                    : "linear-gradient(135deg,#7c3aed,#4f46e5)",
                  opacity: (busy || transcribing) ? 0.6 : 1,
                }}>
                {recording ? (
                  <><span className="w-2 h-2 rounded-full bg-white animate-pulse" /> Recording… tap to send</>
                ) : transcribing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Transcribing…</>
                ) : (
                  <><Mic className="w-4 h-4" /> Tap and speak</>
                )}
              </button>
            ) : (
              <>
                <input data-testid="ai-input" value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
                  placeholder="Ask about this page or your business…"
                  className="flex-1 rounded-lg px-3 py-2 text-sm text-white outline-none"
                  style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} />
                <button data-testid="ai-send" onClick={() => send()} disabled={busy || !input.trim()}
                  className="pos-btn w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ background: "#7c3aed", opacity: (busy || !input.trim()) ? 0.5 : 1 }}>
                  <Send className="w-4 h-4 text-white" />
                </button>
              </>
            )}
          </div>
          <div className="px-3 pb-2 text-[10px]" style={{ color: "var(--pos-muted)" }}>
            {voiceMode
              ? "Voice mode uses OpenAI Whisper for transcription. Grant mic permission when prompted."
              : "🎤 Tap the mic icon in the header to switch to voice mode."}
          </div>
        </div>
      )}
    </>
  );
}
