import React, { useState } from "react";
import { useDash } from "../../store/DashContext";
import { useNavigate } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { Input } from "../ui/input";
import { toast } from "sonner";

export default function DashChangePassword() {
  const { user, changePassword } = useDash();
  const navigate = useNavigate();
  const forced = !!user?.must_change_password;
  const [curr, setCurr] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (pw1.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    if (pw1 !== pw2) { toast.error("Passwords don't match"); return; }
    setBusy(true);
    try {
      await changePassword(forced ? null : curr, pw1);
      toast.success("Password updated");
      navigate("/dashboard", { replace: true });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="p-8 max-w-md mx-auto" data-testid="dash-password-screen">
      <div className="flex items-center gap-2 mb-2">
        <KeyRound className="w-5 h-5" style={{ color: "var(--pos-accent)" }} />
        <h1 className="text-xl font-bold" style={{ color: "var(--pos-text)" }}>{forced ? "Set your password" : "Change password"}</h1>
      </div>
      <p className="text-sm mb-5" style={{ color: "var(--pos-muted)" }}>
        {forced ? "Pick a new password to continue using the dashboard." : "Pick a new password — at least 8 characters."}
      </p>
      <form onSubmit={submit} className="space-y-3">
        {!forced && (
          <div>
            <label className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Current password</label>
            <Input data-testid="pw-current" type="password" value={curr} onChange={(e) => setCurr(e.target.value)}
              style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
          </div>
        )}
        <div>
          <label className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>New password</label>
          <Input data-testid="pw-new" type="password" value={pw1} onChange={(e) => setPw1(e.target.value)}
            style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Confirm new password</label>
          <Input data-testid="pw-confirm" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
            style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
        </div>
        <button data-testid="pw-submit" type="submit" disabled={busy}
          className="pos-btn w-full h-11 rounded-lg font-bold text-white text-sm disabled:opacity-50"
          style={{ background: "var(--pos-accent)" }}>
          {busy ? "Saving…" : "Update password"}
        </button>
      </form>
    </div>
  );
}
