import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { usePos } from "../../store/PosContext";
import { DEMO_STAFF_HINTS_BY_TENANT } from "../../data/mock";
import { Pizza, ShoppingBag, Delete, LogIn, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, tenantStore } from "../../api/client";
import { impersonationCtx } from "../../api/ownerClient";

const BRAND_COPY = {
  restaurant: {
    headline: <>Every order.<br />One screen.</>,
    body: "Delivery, collection and dine-in orders processed on a single easy-to-use screen — built for busy pizza & fast-food stores.",
  },
  retail: {
    headline: <>Every sale.<br />One screen.</>,
    body: "Basket checkout, barcode scanning and inventory tracking on a single easy-to-use screen — built for busy retail stores.",
  },
};

export default function LoginScreen() {
  const { login } = usePos();
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  // Defaults to "restaurant" until the fetch below resolves, so the panel
  // still renders something sensible before the network round-trip finishes.
  const [businessType, setBusinessType] = useState("restaurant");

  useEffect(() => {
    let cancelled = false;
    api.get("/tenant/public-info")
      .then((r) => { if (!cancelled) setBusinessType(r.data.businessType || "restaurant"); })
      .catch(() => {}); // keep the restaurant default — never block sign-in on this
    return () => { cancelled = true; };
  }, []);

  const BrandIcon = businessType === "retail" ? ShoppingBag : Pizza;
  const copy = BRAND_COPY[businessType] || BRAND_COPY.restaurant;

  // Self-heal: if a previous impersonation left a stale tenant slug in
  // localStorage that doesn't match the host, drop it so login resolves to
  // the right tenant. This was the root cause of "Invalid PIN" after the
  // Owner Portal exited impersonation.
  useEffect(() => {
    if (impersonationCtx.get()) return;  // legit impersonation context, leave alone
    if (new URLSearchParams(window.location.search).get("tenant")) return;  // explicit ?tenant= link, leave alone
    const host = window.location.hostname.split(".");
    const onSubdomain = host.length >= 3 && host[1] === "kanda";
    if (!onSubdomain) tenantStore.clear();
  }, []);

  const staffHints = DEMO_STAFF_HINTS_BY_TENANT[tenantStore.get()] || [];

  const press = (d) => {
    if (pin.length >= 4 || busy) return;
    setError(false);
    setPin((p) => p + d);
  };

  const submit = async (value) => {
    if (busy) return;
    setBusy(true);
    const user = await login(value);
    setBusy(false);
    if (user) {
      toast.success(`Welcome back, ${user.name}`);
      navigate(user.role === "Driver" ? "/driver" : "/pos");
    } else {
      setError(true);
      setPin("");
      toast.error("Invalid PIN. Try again.");
    }
  };

  const handleEnter = () => {
    if (pin.length === 4) submit(pin);
  };

  return (
    <div className="min-h-screen flex" style={{ background: "var(--pos-bg)" }} data-testid="login-screen">
      {/* Left brand panel */}
      <div className="hidden lg:flex flex-col justify-between w-[42%] p-12" style={{ background: "linear-gradient(160deg, #101a30 0%, #0b1220 100%)", borderRight: "1px solid var(--pos-border)" }}>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "var(--pos-accent)" }}>
            <BrandIcon className="w-7 h-7 text-white" />
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-white">KANDA</div>
            <div className="text-xs tracking-[0.3em] uppercase" style={{ color: "var(--pos-muted)" }}>Point of Sale</div>
          </div>
        </div>
        <div>
          <h1 className="text-4xl font-bold text-white leading-tight mb-4">{copy.headline}</h1>
          <p className="text-base leading-relaxed max-w-md" style={{ color: "var(--pos-muted)" }}>
            {copy.body}
          </p>
        </div>
        <div className="text-xs" style={{ color: "var(--pos-muted)" }}>
          Store #0042 — HiTech City, Hyderabad · Terminal 1
        </div>
      </div>

      {/* Right login panel */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm fade-in">
          <div className="text-center mb-8">
            <div className="lg:hidden w-14 h-14 mx-auto mb-4 rounded-xl flex items-center justify-center" style={{ background: "var(--pos-accent)" }}>
              <BrandIcon className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-white">Staff Sign In</h2>
            <p className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>Enter your 4-digit PIN</p>
          </div>

          {/* PIN dots */}
          <div className="flex justify-center gap-4 mb-8" data-testid="pin-dots">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="w-4 h-4 rounded-full transition-colors" style={{ background: i < pin.length ? "var(--pos-accent)" : "#243352", boxShadow: error ? "0 0 0 2px #ef4444" : "none" }} />
            ))}
          </div>

          {/* Keypad */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <button key={n} data-testid={`pin-key-${n}`} onClick={() => press(String(n))}
                className="pin-key h-16 rounded-xl text-2xl font-semibold text-white"
                style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
                {n}
              </button>
            ))}
            <button data-testid="pin-key-clear" onClick={() => setPin("")}
              className="pin-key h-16 rounded-xl flex items-center justify-center"
              style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
              <Delete className="w-6 h-6" style={{ color: "var(--pos-muted)" }} />
            </button>
            <button data-testid="pin-key-0" onClick={() => press("0")}
              className="pin-key h-16 rounded-xl text-2xl font-semibold text-white"
              style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
              0
            </button>
            <button data-testid="pin-enter" onClick={handleEnter} disabled={pin.length !== 4 || busy}
              className="pin-key h-16 rounded-xl flex items-center justify-center disabled:opacity-40"
              style={{ background: "var(--pos-accent)" }}>
              {busy ? <Loader2 className="w-6 h-6 text-white animate-spin" /> : <LogIn className="w-6 h-6 text-white" />}
            </button>
          </div>

          {/* Quick staff hint — only for tenants we have known demo PINs for */}
          {staffHints.length > 0 && (
            <div className="rounded-xl p-4" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
              <div className="text-xs uppercase tracking-wider mb-3" style={{ color: "var(--pos-muted)" }}>Demo staff PINs</div>
              <div className="grid grid-cols-2 gap-2">
                {staffHints.map((s) => (
                  <button key={s.id} data-testid={`staff-quick-${s.id}`} onClick={() => submit(s.pin)}
                    className="pos-btn text-left rounded-lg px-3 py-2"
                    style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                    <div className="text-sm font-medium text-white">{s.name}</div>
                    <div className="text-xs" style={{ color: "var(--pos-muted)" }}>{s.role} · PIN {s.pin}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button data-testid="open-timeclock-btn" onClick={() => navigate("/clock")}
            className="pos-btn w-full mt-4 h-10 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-2"
            style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
            Open Time Clock terminal →
          </button>
        </div>
      </div>
    </div>
  );
}
