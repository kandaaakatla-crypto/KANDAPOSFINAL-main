import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOwner } from "../../store/OwnerContext";
import { Lock, Mail, Loader2, ShieldCheck } from "lucide-react";
import { Input } from "../ui/input";
import { toast } from "sonner";

export default function OwnerLogin() {
  const { login } = useOwner();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await login(email, password);
      navigate("/owner/verify");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Login failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--pos-bg)" }}>
      <div className="w-full max-w-md rounded-2xl p-8" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }} data-testid="owner-login">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-accent)" }}>
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Kanda POS</div>
            <div className="text-xl font-bold" style={{ color: "var(--pos-text)" }}>Owner Portal</div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block">
            <span className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Email</span>
            <div className="relative mt-1">
              <Mail className="w-4 h-4 absolute left-3 top-3.5" style={{ color: "var(--pos-muted)" }} />
              <Input data-testid="owner-email" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
                className="pl-9 h-11" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
            </div>
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Password</span>
            <div className="relative mt-1">
              <Lock className="w-4 h-4 absolute left-3 top-3.5" style={{ color: "var(--pos-muted)" }} />
              <Input data-testid="owner-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                className="pl-9 h-11" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
            </div>
          </label>
          <button data-testid="owner-login-submit" type="submit" disabled={busy}
            className="pos-btn w-full h-11 rounded-lg font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--pos-accent)" }}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continue"}
          </button>
        </form>
        <div className="mt-6 text-[11px] text-center" style={{ color: "var(--pos-muted)" }}>
          Protected by two-factor authentication.
        </div>
      </div>
    </div>
  );
}
