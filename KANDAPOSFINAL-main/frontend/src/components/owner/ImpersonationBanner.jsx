import React from "react";
import { useNavigate } from "react-router-dom";
import { impersonationCtx, endImpersonation } from "../../api/ownerClient";
import { ShieldAlert, LogOut } from "lucide-react";

/** Sticky banner shown above POSLayout while a Platform Owner is impersonating. */
export default function ImpersonationBanner() {
  const ctx = impersonationCtx.get();
  const navigate = useNavigate();
  if (!ctx) return null;

  const isAuditor = ctx.mode === "auditor";
  const onExit = () => {
    endImpersonation();
    navigate(`/owner/tenants/${ctx.tenantSlug}`);
    // Hard reload so PosContext re-bootstraps cleanly with the owner session.
    setTimeout(() => window.location.reload(), 50);
  };

  return (
    <div data-testid="impersonation-banner" className="flex items-center justify-between px-4 py-2 text-xs font-semibold"
      style={{ background: isAuditor ? "#321519" : "#1c1410", color: isAuditor ? "#fca5a5" : "#fdba74", borderBottom: `1px solid ${isAuditor ? "#7d2e2e" : "#7d4a2e"}` }}>
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-4 h-4" />
        <span>
          {isAuditor ? "Auditing" : "Impersonating"} <span className="font-bold">{ctx.tenantName}</span>
          {isAuditor && " · read-only"}
        </span>
      </div>
      <button data-testid="impersonation-exit" onClick={onExit}
        className="h-7 px-3 rounded-md flex items-center gap-1 text-[11px] font-bold"
        style={{ background: "rgba(0,0,0,0.35)", color: "inherit", border: "1px solid currentColor" }}>
        <LogOut className="w-3 h-3" /> Exit
      </button>
    </div>
  );
}
