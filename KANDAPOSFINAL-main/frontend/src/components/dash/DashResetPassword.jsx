import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { Input } from "../ui/input";
import { dashAuthApi } from "../../api/client";

/** Landing page for the emailed owner reset link: /dashboard/reset-password?token=... */
export default function DashResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const mismatch = confirm !== "" && pw !== confirm;
  const tooShort = pw !== "" && pw.length < 8;

  const submit = async (e) => {
    e.preventDefault();
    if (busy || mismatch || tooShort || !pw) return;
    setBusy(true);
    try {
      await dashAuthApi.reset(token, pw);
      toast.success("Password changed. Sign in with your new password.");
      navigate("/dashboard/login", { replace: true });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not reset the password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--pos-bg)" }} data-testid="dash-reset">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: "var(--pos-text)" }}>
            <KeyRound className="w-6 h-6" /> Choose a new password
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>At least 8 characters. This link works once.</p>
        </div>
        {!token && (
          <p role="alert" className="text-sm" style={{ color: "#f87171" }}>
            This link is missing its token. Open the link from your email again, or <Link to="/dashboard/login" className="underline">ask for a new one</Link>.
          </p>
        )}
        <div>
          <label htmlFor="reset-pw" className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>New password</label>
          <Input id="reset-pw" data-testid="reset-password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)}
            style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
          {tooShort && <p className="text-xs mt-1" role="alert" style={{ color: "#f87171" }}>Use at least 8 characters.</p>}
        </div>
        <div>
          <label htmlFor="reset-confirm" className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Confirm password</label>
          <Input id="reset-confirm" data-testid="reset-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
          {mismatch && <p className="text-xs mt-1" role="alert" style={{ color: "#f87171" }}>The passwords don&apos;t match.</p>}
        </div>
        <button data-testid="reset-submit" type="submit" disabled={busy || !token || !pw || mismatch || tooShort}
          className="pos-btn w-full h-12 rounded-lg font-bold text-white text-sm disabled:opacity-50" style={{ background: "var(--pos-accent)" }}>
          {busy ? "Saving…" : "Change password"}
        </button>
      </form>
    </div>
  );
}
