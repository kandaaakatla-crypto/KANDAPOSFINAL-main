import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDash } from "../../store/DashContext";
import { LogIn, Eye, EyeOff } from "lucide-react";
import { Input } from "../ui/input";
import { toast } from "sonner";
import { dashAuthApi } from "../../api/client";

export default function DashLogin() {
  const { user, login } = useDash();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);

  const sendReset = async () => {
    setForgotBusy(true);
    try {
      await dashAuthApi.forgot(forgotEmail.trim());
      toast.success("If that is an owner account, a reset link is on its way. It expires in 30 minutes.");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not send the link");
    } finally {
      setForgotBusy(false);
    }
  };

  useEffect(() => { if (user) navigate("/dashboard", { replace: true }); }, [user, navigate]);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    setBusy(true);
    try {
      const res = await login(email.trim(), password);
      toast.success(`Welcome, ${res.user.name}`);
      navigate(res.must_change_password ? "/dashboard/account/password" : "/dashboard", { replace: true });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Login failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex" style={{ background: "var(--pos-bg)" }} data-testid="dash-login">
      {/* This panel's warm gradient is fixed regardless of the app's
          light/dark toggle (shared via localStorage across every surface),
          so its text must be fixed too — var(--pos-text) etc. would follow
          the toggle and render near-white text on this permanently-light
          background whenever a visitor last chose dark mode anywhere else
          in the app. */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-12"
        style={{ background: "linear-gradient(165deg, #fbe9d6 0%, #f6dcc0 100%)", borderRight: "1px solid #ece1cd" }}>
        <div className="flex items-center gap-3">
          <img src="/icon-192.png" alt="Kanda POS" className="w-11 h-11 rounded-lg shrink-0" />
          <div>
            <div className="text-2xl font-bold tracking-tight" style={{ color: "#251d13" }}>KANDA</div>
            <div className="text-xs tracking-[0.3em] uppercase" style={{ color: "#93805f" }}>Restaurant Dashboard</div>
          </div>
        </div>
        <div>
          <h1 className="text-4xl font-bold leading-tight mb-3" style={{ color: "#251d13" }}>Manage every store from one screen.</h1>
          <p className="text-base max-w-md leading-relaxed" style={{ color: "#93805f" }}>
            Menu, staff, rota, promotions, and locations, all in one place.
            Owners see every store. Area managers see the ones they cover. Store managers see theirs.
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4" data-testid="dash-login-form">
          <div>
            <h2 className="text-2xl font-bold" style={{ color: "var(--pos-text)" }}>Sign in</h2>
            <p className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>Owner, area manager, or store manager.</p>
          </div>
          <div>
            <label htmlFor="dash-email" className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Email</label>
            <Input id="dash-email" data-testid="dash-email-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
              style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
          </div>
          <div>
            <label htmlFor="dash-password" className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Password</label>
            <div className="relative">
              <Input id="dash-password" data-testid="dash-password-input" type={show ? "text" : "password"} value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-9" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
              <button type="button" aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} onClick={() => setShow((v) => !v)}
                className="pos-btn absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded" style={{ color: "var(--pos-muted)" }}>
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <details className="text-xs" data-testid="dash-forgot">
            <summary className="cursor-pointer" style={{ color: "var(--pos-muted)" }}>Forgot password?</summary>
            <div className="mt-2 space-y-2" style={{ color: "var(--pos-muted)" }}>
              <p className="leading-relaxed">
                Owners: enter your email and we will send you a link to choose a new password.
                Store and area managers: ask your owner to use <b>Reset password</b> on the Team screen.
              </p>
              <div className="flex gap-2">
                <Input aria-label="Owner email for password reset" data-testid="forgot-email" type="email" value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)} placeholder="Owner email" className="h-9 text-xs"
                  style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
                <button type="button" data-testid="forgot-send" onClick={sendReset} disabled={!forgotEmail.trim() || forgotBusy}
                  className="pos-btn h-9 px-3 rounded-md text-xs font-bold text-white shrink-0 disabled:opacity-50" style={{ background: "var(--pos-accent)" }}>
                  {forgotBusy ? "Sending…" : "Send link"}
                </button>
              </div>
            </div>
          </details>
          <button data-testid="dash-submit-btn" type="submit" disabled={busy || !email || !password}
            className="pos-btn w-full h-12 rounded-lg font-bold text-white text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--pos-accent)" }}>
            <LogIn className="w-4 h-4" /> {busy ? "Signing in..." : "Sign in"}
          </button>
          <p className="text-[11px] text-center pt-2" style={{ color: "var(--pos-muted)" }}>
            POS staff with a 4-digit PIN — use the <a href="/pos/login" className="underline" style={{ color: "var(--pos-text)" }}>terminal login</a> instead.
          </p>
        </form>
      </div>
    </div>
  );
}
