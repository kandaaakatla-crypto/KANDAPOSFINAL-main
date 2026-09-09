import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOwner } from "../../store/OwnerContext";
import { pre2faToken } from "../../api/ownerClient";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { Input } from "../ui/input";
import { toast } from "sonner";

export default function OwnerTotp() {
  const { verify, owner } = useOwner();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  // If a session already exists (owner verified), go to the dashboard.
  useEffect(() => {
    if (owner) navigate("/owner", { replace: true });
  }, [owner, navigate]);

  // If the user lands here without a pending 2FA *and* without a session, bounce to login.
  useEffect(() => {
    if (!pre2faToken.get() && !owner) navigate("/owner/login", { replace: true });
  }, [owner, navigate]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (busy || code.length !== 6) return;
    setBusy(true);
    try {
      await verify(code);
      toast.success("Owner session active");
      navigate("/owner", { replace: true });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Invalid code");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--pos-bg)" }}>
      <div className="w-full max-w-md rounded-2xl p-8" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }} data-testid="owner-totp">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-accent)" }}>
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Step 2 of 2</div>
            <div className="text-xl font-bold text-white">Enter 6-digit code</div>
          </div>
        </div>

        <p className="text-sm mb-5" style={{ color: "var(--pos-muted)" }}>
          Open your authenticator app (e.g. Google Authenticator or Authy) and enter the current 6-digit code for this account.
        </p>

        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block">
            <span className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Authenticator code</span>
            <div className="relative mt-1">
              <KeyRound className="w-4 h-4 absolute left-3 top-3.5" style={{ color: "var(--pos-muted)" }} />
              <Input data-testid="owner-totp-input" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoFocus required
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="pl-9 h-12 text-white text-xl tabular-nums tracking-[0.4em] text-center"
                style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
            </div>
          </label>
          <button data-testid="owner-totp-submit" type="submit" disabled={busy || code.length !== 6}
            className="pos-btn w-full h-11 rounded-lg font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
            style={{ background: "var(--pos-accent)" }}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify"}
          </button>
        </form>
      </div>
    </div>
  );
}
