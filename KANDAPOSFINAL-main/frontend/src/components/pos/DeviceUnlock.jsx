import React, { useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { Input } from "../ui/input";
import { posDevicesApi, deviceStore } from "../../api/client";

/**
 * One-time till unlock, shown in place of the staff PIN pad on a browser
 * that hasn't been unlocked for this restaurant yet. A dashboard owner or
 * manager signs in once with their email + password; the till then keeps
 * a device token (api/client.js deviceStore) and goes straight to the PIN
 * pad from then on, until the till is removed from Dashboard → Devices.
 */
export default function DeviceUnlock({ slug, restaurantName, onUnlocked, onSwitch }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setError("");
    try {
      const res = await posDevicesApi.register({ email: email.trim(), password, name: name.trim() || undefined });
      deviceStore.set(slug, res.device_token);
      setPassword("");
      toast.success("Till unlocked. Staff can now sign in with their PIN.");
      onUnlocked();
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      setError(
        status === 401 ? "Wrong email or password."
          : status === 429 ? "Too many attempts. Wait a few minutes and try again."
            : typeof detail === "string" ? detail
              : "Couldn't unlock this till. Check your connection and try again."
      );
    } finally {
      setBusy(false);
    }
  };

  const field = { background: "var(--pos-panel)", borderColor: "var(--pos-border)", color: "var(--pos-text)" };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--pos-bg)" }} data-testid="device-unlock">
      <form onSubmit={submit} className="w-full max-w-sm fade-in">
        <div className="text-center mb-6">
          <div className="w-14 h-14 mx-auto mb-4 rounded-xl flex items-center justify-center" style={{ background: "var(--pos-panel-2)" }}>
            <Lock className="w-6 h-6" style={{ color: "var(--pos-accent)" }} />
          </div>
          <h2 className="text-2xl font-bold" style={{ color: "var(--pos-text)" }}>Unlock this till</h2>
          <p className="text-sm mt-2" style={{ color: "var(--pos-muted)" }}>
            A manager signs in once to set up this device for {restaurantName || slug}. After that, staff just use their PIN.
          </p>
        </div>
        <div className="space-y-3">
          <Input data-testid="device-unlock-email" type="email" autoComplete="username" placeholder="Manager email"
            value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" style={field} />
          <Input data-testid="device-unlock-password" type="password" autoComplete="current-password" placeholder="Dashboard password"
            value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" style={field} />
          <Input data-testid="device-unlock-name" placeholder="Till name (optional, e.g. Front counter)"
            value={name} onChange={(e) => setName(e.target.value)} className="h-11" style={field} />
        </div>
        {error && <div className="text-sm mt-3" style={{ color: "#f87171" }} data-testid="device-unlock-error">{error}</div>}
        <button type="submit" data-testid="device-unlock-submit" disabled={busy || !email.trim() || !password}
          className="pos-btn w-full h-11 mt-4 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ background: "var(--pos-accent)" }}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Unlock till
        </button>
        {onSwitch && (
          <button type="button" onClick={onSwitch} className="w-full mt-4 text-xs text-center hover:underline" style={{ color: "var(--pos-muted)" }}>
            Not your restaurant? Switch
          </button>
        )}
      </form>
    </div>
  );
}
