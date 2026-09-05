import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDash } from "../../store/DashContext";
import { Building2, LogIn, Eye, EyeOff } from "lucide-react";
import { Input } from "../ui/input";
import { toast } from "sonner";

export default function DashLogin() {
  const { user, login } = useDash();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (user) navigate("/biz", { replace: true }); }, [user, navigate]);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    setBusy(true);
    try {
      const res = await login(email.trim(), password);
      toast.success(`Welcome, ${res.user.name}`);
      navigate(res.must_change_password ? "/biz/account/password" : "/biz", { replace: true });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Login failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex" style={{ background: "var(--pos-bg)" }} data-testid="dash-login">
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-12"
        style={{ background: "linear-gradient(160deg, #101a30 0%, #0b1220 100%)", borderRight: "1px solid var(--pos-border)" }}>
        <div className="flex items-center gap-3">
          <Building2 className="w-7 h-7" style={{ color: "var(--pos-accent)" }} />
          <div>
            <div className="text-2xl font-bold tracking-tight text-white">KANDA</div>
            <div className="text-xs tracking-[0.3em] uppercase" style={{ color: "var(--pos-muted)" }}>Restaurant Dashboard</div>
          </div>
        </div>
        <div>
          <h1 className="text-4xl font-bold text-white leading-tight mb-3">Manage every store from one screen.</h1>
          <p className="text-base max-w-md leading-relaxed" style={{ color: "var(--pos-muted)" }}>
            Menu, staff, rota, promotions, and locations, all in one place.
            Owners see every store. Area managers see the ones they cover. Store managers see theirs.
          </p>
        </div>
        <div className="text-xs" style={{ color: "var(--pos-muted)" }}>
          Demo accounts:<br />
          <span className="text-white">owner@demo.com</span> / OwnerPass#2025<br />
          <span className="text-white">manager@demo.com</span> / DemoMgr#2025<br />
          <span className="text-white">area@demo.com</span> / DemoArea#2025
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4" data-testid="dash-login-form">
          <div>
            <h2 className="text-2xl font-bold text-white">Sign in</h2>
            <p className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>Owner, area manager, or store manager.</p>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Email</label>
            <Input data-testid="dash-email-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
              className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Password</label>
            <div className="relative">
              <Input data-testid="dash-password-input" type={show ? "text" : "password"} value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="text-white pr-9" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
              <button type="button" onClick={() => setShow((v) => !v)}
                className="pos-btn absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded" style={{ color: "var(--pos-muted)" }}>
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <button data-testid="dash-submit-btn" type="submit" disabled={busy || !email || !password}
            className="pos-btn w-full h-12 rounded-lg font-bold text-white text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--pos-accent)" }}>
            <LogIn className="w-4 h-4" /> {busy ? "Signing in..." : "Sign in"}
          </button>
          <p className="text-[11px] text-center pt-2" style={{ color: "var(--pos-muted)" }}>
            POS staff with a 4-digit PIN — use the <a href="/login" className="text-white underline">terminal login</a> instead.
          </p>
        </form>
      </div>
    </div>
  );
}
