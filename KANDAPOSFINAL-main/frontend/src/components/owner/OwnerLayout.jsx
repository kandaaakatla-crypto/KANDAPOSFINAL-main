import React from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useOwner } from "../../store/OwnerContext";
import { LayoutDashboard, Store, Plus, LogOut, ShieldCheck, AlertOctagon, ClipboardCheck, LifeBuoy, Inbox } from "lucide-react";

export default function OwnerLayout() {
  const { owner, logout } = useOwner();
  const navigate = useNavigate();

  const NAV = [
    { to: "/owner", end: true, icon: LayoutDashboard, label: "Dashboard" },
    { to: "/owner/tenants", icon: Store, label: "Tenants" },
    { to: "/owner/tenants/new", icon: Plus, label: "New tenant" },
    { to: "/owner/ops/leads", icon: Inbox, label: "Website leads" },
    { to: "/owner/ops/support", icon: LifeBuoy, label: "Support" },
    { to: "/owner/ops/audit", icon: ClipboardCheck, label: "Audit log" },
    { to: "/owner/ops/errors", icon: AlertOctagon, label: "Errors" },
  ];

  return (
    <div className="h-screen flex" style={{ background: "var(--pos-bg)" }}>
      <aside className="w-60 flex-shrink-0 flex flex-col" style={{ background: "var(--pos-panel)", borderRight: "1px solid var(--pos-border)" }}>
        <div className="px-5 py-4 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5" style={{ color: "var(--pos-accent)" }} />
          <div>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Kanda POS</div>
            <div className="font-bold" style={{ color: "var(--pos-text)" }}>Owner Portal</div>
          </div>
        </div>
        <nav className="px-2 space-y-1 flex-1 min-h-0 overflow-y-auto">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className="flex items-center gap-2.5 h-10 px-3 rounded-lg text-sm font-medium"
              style={({ isActive }) => ({
                background: isActive ? "var(--pos-panel-2)" : "transparent",
                color: isActive ? "var(--pos-text)" : "var(--pos-muted)",
                border: `1px solid ${isActive ? "var(--pos-border)" : "transparent"}`,
              })}
              data-testid={`owner-nav-${n.label.toLowerCase().replace(/\s/g, "-")}`}>
              <n.icon className="w-4 h-4" /> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-3" style={{ borderTop: "1px solid var(--pos-border)" }}>
          <div className="text-xs font-semibold" style={{ color: "var(--pos-text)" }}>{owner?.name}</div>
          <div className="text-[10px]" style={{ color: "var(--pos-muted)" }}>{owner?.email}</div>
          <button data-testid="owner-logout" onClick={() => { logout(); navigate("/owner/login"); }}
            className="mt-2 w-full h-9 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5"
            style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto pos-scroll p-6">
        <Outlet />
      </main>
    </div>
  );
}
