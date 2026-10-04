import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, useAnimation } from "framer-motion";
import { Camera, Delete, LogIn, LogOut, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { api, timeclockApi, tenantStore, deviceStore, isDeviceLocked } from "../../api/client";
import { pressableSmall } from "../../lib/motion";

/**
 * Public-ish "Time Clock" terminal. Anyone can walk up, type their 4-digit PIN,
 * and punch in/out. While the keypad is shown we keep the webcam stream live so
 * the moment the 4th digit lands we snap a small JPEG selfie and ship it with
 * the punch request — deters buddy-punching without needing a biometric device.
 *
 * Lives at /pos/:slug/clock, one per restaurant. The slug in the URL is the
 * only thing that decides whose staff list a PIN is checked against (sent as
 * an in-memory override, never saved to the device), so a till pinned to one
 * restaurant can't punch staff into another, and an unknown slug shows
 * "Restaurant not found" instead of a keypad.
 */
export default function TimeClockScreen() {
  const navigate = useNavigate();
  const { slug: rawSlug } = useParams();
  const slug = (rawSlug || "").toLowerCase();
  // null = still checking, false = no such restaurant, string = its name.
  const [tenantName, setTenantName] = useState(null);
  // Punches need this till to have been unlocked by a manager (see
  // DeviceUnlock on the PIN pad); the public demo is exempt.
  const [deviceLocked, setDeviceLocked] = useState(() => deviceStore.needsUnlock(slug));
  useEffect(() => { setDeviceLocked(deviceStore.needsUnlock(slug)); }, [slug]);

  useEffect(() => {
    let cancelled = false;
    setTenantName(null);
    tenantStore.setEphemeral(slug);
    api.get("/tenant/public-info")
      .then((r) => { if (!cancelled) setTenantName(r.data.name || slug); })
      .catch((err) => { if (!cancelled) setTenantName(err?.response?.status === 404 ? false : slug); });
    return () => { cancelled = true; tenantStore.clearEphemeral(); };
  }, [slug]);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [pin, setPin] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lastPunch, setLastPunch] = useState(null);
  const dotsShake = useAnimation();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Only open the camera once the restaurant is confirmed real, so a mistyped
  // /pos/<id>/clock never asks for camera access or leaves the light on.
  const tenantOk = typeof tenantName === "string" && !deviceLocked;
  useEffect(() => {
    if (!tenantOk) return undefined;
    let stream;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, facingMode: "user" }, audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
      } catch (e) {
        if (!cancelled) setCameraError(e?.message || "Camera unavailable");
      }
    })();
    return () => { cancelled = true; if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, [tenantOk]);

  const captureSelfie = () => {
    if (!cameraReady || !videoRef.current || !canvasRef.current) return null;
    const v = videoRef.current; const c = canvasRef.current;
    c.width = 160; c.height = 120;
    const ctx = c.getContext("2d");
    ctx.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.6);
  };

  const submit = async (newPin) => {
    if (busy) return;
    setBusy(true);
    const selfie = captureSelfie();
    try {
      const res = await timeclockApi.punch({
        pin: newPin,
        selfie_b64: selfie,
        device_id: window.location.hostname || "kanda-terminal",
      });
      setLastPunch(res);
      toast.success(`${res.user_name} clocked ${res.type === "in" ? "IN" : "OUT"}`, { duration: 4000 });
      setPin("");
      setTimeout(() => setLastPunch(null), 6000);
    } catch (e) {
      if (isDeviceLocked(e)) {
        deviceStore.clear(slug);
        setDeviceLocked(true);
        setPin("");
        return;
      }
      const detail = e?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Punch failed");
      setPin("");
      dotsShake.start({ x: [0, -10, 10, -6, 6, -3, 3, 0], transition: { duration: 0.4, ease: "easeInOut" } });
    } finally {
      setBusy(false);
    }
  };

  const press = (d) => {
    if (busy) return;
    const next = (pin + d).slice(0, 4);
    setPin(next);
    if (next.length === 4) submit(next);
  };
  const clear = () => setPin("");

  // Only once the restaurant is confirmed real — an unknown slug must land
  // on "Restaurant not found", never on a link that would pin it.
  if (deviceLocked && typeof tenantName === "string") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--pos-bg)" }} data-testid="timeclock-device-locked">
        <div className="w-full max-w-sm text-center">
          <h2 className="text-2xl font-bold mb-2" style={{ color: "var(--pos-text)" }}>This till isn't unlocked</h2>
          <p className="text-sm mb-6" style={{ color: "var(--pos-muted)" }}>
            A manager needs to unlock this device once on the staff sign-in screen before the clock can be used.
          </p>
          <button onClick={() => navigate(`/pos/${slug}/login`)} className="pos-btn w-full h-11 rounded-lg text-sm font-semibold text-white"
            style={{ background: "var(--pos-accent)" }}>
            Go to staff sign-in
          </button>
        </div>
      </div>
    );
  }

  if (tenantName === false) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--pos-bg)" }} data-testid="timeclock-tenant-not-found">
        <div className="w-full max-w-sm text-center">
          <h2 className="text-2xl font-bold mb-2" style={{ color: "var(--pos-text)" }}>Restaurant not found</h2>
          <p className="text-sm mb-6" style={{ color: "var(--pos-muted)" }}>
            There's no restaurant with the ID "{rawSlug}". Check the link, or sign in with your Restaurant ID.
          </p>
          <button onClick={() => navigate("/pos/login")} className="pos-btn w-full h-11 rounded-lg text-sm font-semibold text-white"
            style={{ background: "var(--pos-accent)" }}>
            Enter Restaurant ID
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex" style={{ background: "var(--pos-bg)" }} data-testid="timeclock-screen">
      <div className="hidden lg:flex flex-col justify-between w-[42%] p-12"
        style={{ background: "linear-gradient(165deg, #fbe9d6 0%, #f6dcc0 100%)", borderRight: "1px solid var(--pos-border)" }}>
        <div className="flex items-center gap-3">
          <button data-testid="timeclock-back-btn" onClick={() => navigate(slug === "demo" ? "/demo/login" : `/pos/${slug}/login`)}
            className="pos-btn p-2 rounded-md" style={{ background: "var(--pos-panel-2)" }}>
            <ArrowLeft className="w-4 h-4" style={{ color: "var(--pos-text)" }} />
          </button>
          <div>
            <div className="text-2xl font-bold tracking-tight" style={{ color: "var(--pos-text)" }}>KANDA</div>
            <div className="text-xs tracking-[0.3em] uppercase" style={{ color: "var(--pos-muted)" }}>Time Clock{tenantName ? ` · ${tenantName}` : ""}</div>
          </div>
        </div>
        <div>
          <div className="text-6xl font-bold mb-2 tabular-nums" style={{ color: "var(--pos-text)" }} data-testid="timeclock-time">
            {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
          <div className="text-base" style={{ color: "var(--pos-muted)" }}>
            {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </div>
          <p className="text-sm mt-8 max-w-md leading-relaxed" style={{ color: "var(--pos-muted)" }}>
            Tap your 4-digit PIN to clock in or out. The webcam will snap a small selfie when you submit — this is reviewed by managers to deter buddy-punching.
          </p>
        </div>
        <div className="text-xs" style={{ color: "var(--pos-muted)" }}>Powered by Kanda POS</div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="mb-6 rounded-lg overflow-hidden relative" style={{ border: "1px solid var(--pos-border)", background: "#000" }}>
          <video ref={videoRef} className="w-64 h-48" autoPlay playsInline muted data-testid="timeclock-webcam" />
          <canvas ref={canvasRef} className="hidden" />
          {!cameraReady && (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center" data-testid="timeclock-camera-cta"
              style={{ background: "rgba(0,0,0,0.85)" }}>
              <Camera className="w-7 h-7 mb-2" style={{ color: cameraError ? "#fca5a5" : "#fcd34d" }} />
              <div className="text-xs font-semibold text-white">
                {cameraError ? "Camera blocked" : "Camera needed for selfie capture"}
              </div>
              <div className="text-[10px] mt-1 leading-snug" style={{ color: "var(--pos-muted)" }}>
                {cameraError
                  ? "Allow camera access in your browser address bar, then reload."
                  : "Starting camera… You can still clock in by tapping your PIN."}
              </div>
            </div>
          )}
        </div>
        <div className="text-xs mb-6 flex items-center gap-2" style={{ color: cameraReady ? "#86efac" : "#fca5a5" }}>
          <Camera className="w-4 h-4" />
          {cameraReady ? "Camera ready — selfie will capture on submit" : (cameraError ? `Camera off — punches will save without selfie` : "Starting camera…")}
        </div>

        <motion.div animate={dotsShake} className="flex justify-center gap-4 mb-8" data-testid="timeclock-pin-dots">
          {[0, 1, 2, 3].map((i) => (
            <motion.div key={i} className="w-4 h-4 rounded-full"
              animate={{ background: i < pin.length ? "var(--pos-accent)" : "var(--pos-panel-2)", scale: i < pin.length ? 1.15 : 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 25 }}
              style={{ border: "1px solid var(--pos-border)" }} />
          ))}
        </motion.div>

        <div className="grid grid-cols-3 gap-3 max-w-xs w-full">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <motion.button key={n} data-testid={`tc-pin-${n}`} onClick={() => press(String(n))} disabled={busy} {...pressableSmall}
              className="pos-btn h-16 rounded-lg text-xl font-bold disabled:opacity-50"
              style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>{n}</motion.button>
          ))}
          <motion.button data-testid="tc-pin-clear" onClick={clear} disabled={busy} {...pressableSmall}
            className="pos-btn h-16 rounded-lg flex items-center justify-center disabled:opacity-50"
            style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
            <Delete className="w-6 h-6" />
          </motion.button>
          <motion.button data-testid="tc-pin-0" onClick={() => press("0")} disabled={busy} {...pressableSmall}
            className="pos-btn h-16 rounded-lg text-xl font-bold disabled:opacity-50"
            style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>0</motion.button>
          <div />
        </div>

        {lastPunch && (
          <div className="mt-8 rounded-xl px-6 py-4 flex items-center gap-4" data-testid="timeclock-confirmation"
            style={{ background: lastPunch.type === "in" ? "#0e2515" : "#25190e", border: "1px solid var(--pos-border)" }}>
            {lastPunch.type === "in" ? <LogIn className="w-6 h-6" style={{ color: "#86efac" }} /> : <LogOut className="w-6 h-6" style={{ color: "#fcd34d" }} />}
            <div>
              <div className="font-bold text-white">{lastPunch.user_name} — Clocked {lastPunch.type === "in" ? "IN" : "OUT"}</div>
              <div className="text-xs" style={{ color: "var(--pos-muted)" }}>{new Date(lastPunch.at).toLocaleString()}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
