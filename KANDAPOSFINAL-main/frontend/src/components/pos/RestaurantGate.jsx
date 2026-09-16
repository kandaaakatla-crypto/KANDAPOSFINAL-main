import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Loader2 } from "lucide-react";
import { api, tenantStore } from "../../api/client";
import useSeo from "../../hooks/useSeo";

/**
 * /pos/login — the one-time-per-device entry point for POS staff sign-in.
 *
 * If this browser already has a restaurant pinned (kanda_pos_tenant_slug in
 * localStorage — set the first time someone used this gate, or via
 * /pos/:slug/login directly), silently redirect straight to that
 * restaurant's PIN pad. Otherwise ask for the Restaurant ID once, validate
 * it against the real tenant, then pin it for every login after this.
 */
export default function RestaurantGate() {
  useSeo({ title: "Restaurant sign in", noindex: true });
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [restaurantId, setRestaurantId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const pinned = localStorage.getItem("kanda_pos_tenant_slug");
    if (pinned) {
      navigate(`/pos/${pinned}/login`, { replace: true });
      return;
    }
    setChecking(false);
  }, [navigate]);

  const submit = async (e) => {
    e.preventDefault();
    const slug = restaurantId.trim().toLowerCase();
    if (!slug || busy) return;
    setBusy(true);
    setError("");
    tenantStore.setEphemeral(slug);
    try {
      await api.get("/tenant/public-info");
      tenantStore.clearEphemeral();
      tenantStore.set(slug);
      navigate(`/pos/${slug}/login`);
    } catch {
      tenantStore.clearEphemeral();
      setError("We couldn't find a restaurant with that ID. Double-check it and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (checking) return null;

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--pos-bg)" }} data-testid="restaurant-gate">
      <div className="w-full max-w-sm fade-in">
        <div className="text-center mb-8">
          <img src="/icon-192.png" alt="Kanda POS" className="w-14 h-14 mx-auto mb-4 rounded-xl" />
          <h2 className="text-2xl font-bold" style={{ color: "var(--pos-text)" }}>Restaurant Sign In</h2>
          <p className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>Enter your Restaurant ID to continue</p>
        </div>

        <form onSubmit={submit} className="grid gap-3">
          <input
            required autoFocus placeholder="e.g. xyzpizza" value={restaurantId}
            onChange={(e) => { setRestaurantId(e.target.value); setError(""); }}
            data-testid="restaurant-id-input"
            className="rounded-lg px-4 py-3 text-sm"
            style={{ background: "var(--pos-panel)", border: `1px solid ${error ? "#ef4444" : "var(--pos-border)"}`, color: "var(--pos-text)" }}
          />
          {error && <div className="text-xs" style={{ color: "#ef4444" }}>{error}</div>}
          <button type="submit" disabled={busy} data-testid="restaurant-id-submit"
            className="pos-btn h-12 rounded-lg text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: "var(--pos-accent)", color: "#fff" }}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Continue <ArrowRight className="w-4 h-4" /></>}
          </button>
        </form>

        <p className="text-xs text-center mt-6" style={{ color: "var(--pos-muted)" }}>
          Your Restaurant ID is set up when your store was onboarded — check with your owner or manager if you're not sure.
        </p>
      </div>
    </div>
  );
}
