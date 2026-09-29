import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, useAnimation } from "framer-motion";
import { usePos } from "../../store/PosContext";
import { DEMO_STAFF_HINTS_BY_TENANT } from "../../data/mock";
import { ShoppingBag, Delete, LogIn, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, tenantStore } from "../../api/client";
import useSeo from "../../hooks/useSeo";
import { pressableSmall } from "../../lib/motion";

const BRAND_COPY = {
  restaurant: {
    headline: <>Every order.<br />One screen.</>,
    body: "Delivery, collection and dine-in orders processed on a single easy-to-use screen, built for busy pizza & fast-food stores.",
  },
  retail: {
    headline: <>Every sale.<br />One screen.</>,
    body: "Basket checkout, barcode scanning and inventory tracking on a single easy-to-use screen, built for busy retail stores.",
  },
};

export default function LoginScreen({ isDemo = false }) {
  const { login } = usePos();
  const navigate = useNavigate();
  const { slug: routeSlug } = useParams();
  useSeo({ title: "Staff sign in", noindex: true });
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const dotsShake = useAnimation();
  // Defaults to "restaurant" until the fetch below resolves, so the panel
  // still renders something sensible before the network round-trip finishes.
  const [businessType, setBusinessType] = useState("restaurant");

  // /demo/login uses an in-memory-only override so visiting the public demo
  // never overwrites a real device's pinned restaurant (see tenantStore in
  // api/client.js). /pos/:slug/login persists the slug — that's what makes
  // this device "belong" to that restaurant for next time.
  useEffect(() => {
    if (isDemo) {
      tenantStore.setEphemeral("demo");
    } else if (routeSlug) {
      tenantStore.clearEphemeral();
      tenantStore.set(routeSlug);
    }
  }, [isDemo, routeSlug]);

  useEffect(() => {
    let cancelled = false;
    api.get("/tenant/public-info")
      .then((r) => { if (!cancelled) setBusinessType(r.data.businessType || "restaurant"); })
      .catch(() => {}); // keep the restaurant default — never block sign-in on this
    return () => { cancelled = true; };
  }, [isDemo, routeSlug]);

  const copy = BRAND_COPY[businessType] || BRAND_COPY.restaurant;

  const BrandMark = ({ box, icon }) => businessType === "retail" ? (
    <div className={`${box} rounded-xl flex items-center justify-center`} style={{ background: "var(--pos-accent)" }}>
      <ShoppingBag className={`${icon} text-white`} />
    </div>
  ) : (
    <img src="/icon-192.png" alt="Kanda POS" className={`${box} rounded-xl`} />
  );

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
      const slug = routeSlug || (isDemo ? "demo" : tenantStore.get());
      navigate(user.role === "Driver" ? `/${slug}/driver` : `/${slug}/pos`);
    } else {
      setError(true);
      setPin("");
      toast.error("Invalid PIN. Try again.");
      dotsShake.start({ x: [0, -10, 10, -6, 6, -3, 3, 0], transition: { duration: 0.4, ease: "easeInOut" } });
    }
  };

  const handleEnter = () => {
    if (pin.length === 4) submit(pin);
  };

  return (
    <div className="min-h-screen flex" style={{ background: "var(--pos-bg)" }} data-testid="login-screen">
      {/* Left brand panel — this gradient is fixed regardless of the app's
          light/dark toggle (shared via localStorage across every surface),
          so its text must be fixed too — var(--pos-text) etc. would follow
          the toggle and render near-white text on this permanently-light
          background whenever a visitor last chose dark mode anywhere else
          in the app. */}
      <div className="hidden lg:flex flex-col justify-between w-[42%] p-12" style={{ background: "linear-gradient(165deg, #fbe9d6 0%, #f6dcc0 100%)", borderRight: "1px solid #ece1cd" }}>
        <div className="flex items-center gap-3">
          <BrandMark box="w-12 h-12" icon="w-7 h-7" />
          <div>
            <div className="text-2xl font-bold tracking-tight" style={{ color: "#251d13" }}>KANDA</div>
            <div className="text-xs tracking-[0.3em] uppercase" style={{ color: "#93805f" }}>Point of Sale</div>
          </div>
        </div>
        <div>
          <h1 className="text-4xl font-bold leading-tight mb-4" style={{ color: "#251d13" }}>{copy.headline}</h1>
          <p className="text-base leading-relaxed max-w-md" style={{ color: "#93805f" }}>
            {copy.body}
          </p>
        </div>
        <div className="text-xs" style={{ color: "#93805f" }}>
          Store #0042 — HiTech City, Hyderabad · Terminal 1
        </div>
      </div>

      {/* Right login panel */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm fade-in">
          <div className="text-center mb-8">
            <BrandMark box="lg:hidden w-14 h-14 mx-auto mb-4" icon="w-8 h-8" />
            <h2 className="text-2xl font-bold" style={{ color: "var(--pos-text)" }}>Staff Sign In</h2>
            <p className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>Enter your 4-digit PIN</p>
          </div>

          {/* PIN dots */}
          <motion.div animate={dotsShake} className="flex justify-center gap-4 mb-8" data-testid="pin-dots">
            {[0, 1, 2, 3].map((i) => (
              <motion.div key={i} className="w-4 h-4 rounded-full"
                animate={{ background: i < pin.length ? "var(--pos-accent)" : "var(--pos-border)", scale: i < pin.length ? 1.15 : 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 25 }}
                style={{ boxShadow: error ? "0 0 0 2px #ef4444" : "none" }} />
            ))}
          </motion.div>

          {/* Keypad */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <motion.button key={n} data-testid={`pin-key-${n}`} onClick={() => press(String(n))} {...pressableSmall}
                className="pin-key h-16 rounded-xl text-2xl font-semibold"
                style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
                {n}
              </motion.button>
            ))}
            <motion.button data-testid="pin-key-clear" onClick={() => setPin("")} {...pressableSmall}
              className="pin-key h-16 rounded-xl flex items-center justify-center"
              style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
              <Delete className="w-6 h-6" style={{ color: "var(--pos-muted)" }} />
            </motion.button>
            <motion.button data-testid="pin-key-0" onClick={() => press("0")} {...pressableSmall}
              className="pin-key h-16 rounded-xl text-2xl font-semibold"
              style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
              0
            </motion.button>
            <motion.button data-testid="pin-enter" onClick={handleEnter} disabled={pin.length !== 4 || busy} {...pressableSmall}
              className="pin-key h-16 rounded-xl flex items-center justify-center disabled:opacity-40"
              style={{ background: "var(--pos-accent)" }}>
              {busy ? <Loader2 className="w-6 h-6 text-white animate-spin" /> : <LogIn className="w-6 h-6 text-white" />}
            </motion.button>
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
                    <div className="text-sm font-medium" style={{ color: "var(--pos-text)" }}>{s.name}</div>
                    <div className="text-xs" style={{ color: "var(--pos-muted)" }}>{s.role} · PIN {s.pin}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button data-testid="open-timeclock-btn" onClick={() => navigate("/clock")}
            className="pos-btn w-full mt-4 h-10 rounded-lg text-xs font-bold flex items-center justify-center gap-2"
            style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
            Open Time Clock terminal →
          </button>

          {!isDemo && (
            <button data-testid="switch-restaurant-btn" onClick={() => { tenantStore.clear(); navigate("/pos/login"); }}
              className="w-full mt-4 text-xs text-center underline-offset-2 hover:underline"
              style={{ color: "var(--pos-muted)" }}>
              Not your restaurant? Switch
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
