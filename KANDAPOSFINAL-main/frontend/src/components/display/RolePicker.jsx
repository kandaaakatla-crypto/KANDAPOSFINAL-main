import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChefHat, Package, MonitorSmartphone, Link2 } from "lucide-react";
import useSeo from "../../hooks/useSeo";

// Kanda Display devices don't carry a staff PIN identity — they're a fixed
// station (kitchen/packing/counter screen) configured once. KDS/Packing/
// CustomerDisplay all already authenticate off one shared per-tenant
// `kds_token` read from the URL's `?token=` (see backend/kds.py and each
// screen's own useSearchParams call) — this just persists that same token
// locally so the device doesn't need it pasted in again after a restart.
const STORAGE_KEY = "kanda_display_token";

const ROLES = [
  { key: "kds", label: "Kitchen Display", description: "Ticket routing by station, with prep timers.", path: "/kds", icon: ChefHat },
  { key: "packing", label: "Packing Station", description: "Pack and hand off orders for pickup or dispatch.", path: "/packing", icon: Package },
  { key: "display", label: "Customer Display", description: "Order status shown to waiting customers.", path: "/display", icon: MonitorSmartphone },
];

function extractToken(input) {
  const trimmed = input.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const fromQuery = url.searchParams.get("token");
    if (fromQuery) return fromQuery;
  } catch {
    // Not a URL — the user pasted the raw token itself.
  }
  return trimmed;
}

function TokenSetup({ onSaved }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    const token = extractToken(draft);
    if (!token) { setError(true); return; }
    localStorage.setItem(STORAGE_KEY, token);
    onSaved(token);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--pos-bg)" }}>
      <form onSubmit={submit} className="w-full max-w-sm fade-in" data-testid="display-token-setup">
        <div className="text-center mb-8">
          <div className="w-14 h-14 mx-auto mb-4 rounded-xl flex items-center justify-center" style={{ background: "var(--pos-accent)" }}>
            <Link2 className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white">Set up this device</h2>
          <p className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>
            Paste the station link or token from Owner Portal → Tenant detail → Kiosk tablet tokens.
          </p>
        </div>
        <input
          autoFocus
          data-testid="display-token-input"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setError(false); }}
          placeholder="Paste link or token"
          className="w-full h-12 rounded-xl px-4 text-white mb-3"
          style={{ background: "var(--pos-panel)", border: `1px solid ${error ? "#ef4444" : "var(--pos-border)"}` }}
        />
        {error && <p className="text-xs mb-3" style={{ color: "#ef4444" }}>That doesn't look like a valid link or token.</p>}
        <button type="submit" data-testid="display-token-continue" className="pos-btn w-full h-12 rounded-xl text-sm font-bold text-white" style={{ background: "var(--pos-accent)" }}>
          Continue
        </button>
      </form>
    </div>
  );
}

export default function RolePicker() {
  const navigate = useNavigate();
  useSeo({ title: "Set up device", noindex: true });
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEY) || "");

  const resetDevice = () => {
    localStorage.removeItem(STORAGE_KEY);
    setToken("");
  };

  if (!token) return <TokenSetup onSaved={setToken} />;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: "var(--pos-bg)" }} data-testid="display-role-picker">
      <div className="text-center mb-8">
        <div className="text-2xl font-bold tracking-tight text-white">KANDA DISPLAY</div>
        <p className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>What is this device?</p>
      </div>
      <div className="w-full max-w-sm flex flex-col gap-3">
        {ROLES.map(({ key, label, description, path, icon: Icon }) => (
          <button
            key={key}
            data-testid={`display-role-${key}`}
            onClick={() => navigate(`${path}?token=${encodeURIComponent(token)}`)}
            className="pos-btn flex items-center gap-4 rounded-xl p-4 text-left"
            style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}
          >
            <div className="w-11 h-11 shrink-0 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-accent)" }}>
              <Icon className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="text-base font-semibold text-white">{label}</div>
              <div className="text-xs" style={{ color: "var(--pos-muted)" }}>{description}</div>
            </div>
          </button>
        ))}
      </div>
      <button data-testid="display-reset-device" onClick={resetDevice} className="mt-8 text-xs" style={{ color: "var(--pos-muted)" }}>
        Change device / re-enter token
      </button>
    </div>
  );
}
