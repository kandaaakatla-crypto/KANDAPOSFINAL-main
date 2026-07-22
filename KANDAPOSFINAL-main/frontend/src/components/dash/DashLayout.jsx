import React, { useEffect, useState } from "react";
import { Outlet, NavLink, useNavigate, Navigate } from "react-router-dom";
import { useDash, canManageStaff, canAddLocation } from "../../store/DashContext";
import { Building2, LayoutDashboard, Users, CalendarDays, BookOpen, MapPin, LogOut, KeyRound, PhoneCall, Sparkles, MessageSquare, MessageCircle } from "lucide-react";

const NAV_ITEMS = [
  { to: "/biz", end: true, label: "Overview", icon: LayoutDashboard, allow: () => true },
  { to: "/biz/menu", label: "Menu", icon: BookOpen, allow: () => true },
  { to: "/biz/staff", label: "Staff", icon: Users, allow: (u) => canManageStaff(u) || u?.dash_role === "manager" },
  { to: "/biz/workforce", label: "Rota", icon: CalendarDays, allow: () => true },
  { to: "/biz/voice", label: "Voice Agent", icon: PhoneCall, allow: () => true },
  { to: "/biz/sms", label: "Customer SMS", icon: MessageSquare, allow: () => true },
  { to: "/biz/whatsapp", label: "WhatsApp", icon: MessageCircle, allow: () => true },
  { to: "/biz/digest", label: "Daily Digest", icon: Sparkles, allow: () => true },
  { to: "/biz/locations", label: "Locations", icon: MapPin, allow: () => true },
];

export default function DashLayout() {
  const { user, logout } = useDash();
  const navigate = useNavigate();

  if (!user) return <Navigate to="/biz/login" replace />;
  if (user.must_change_password) return <Navigate to="/biz/account/password" replace />;

  const items = NAV_ITEMS.filter((i) => i.allow(user));
  const roleLabel = { owner: "Restaurant Owner", area_manager: "Area Manager", manager: "Store Manager" }[user.dash_role] || user.dash_role;

  return (
    <div className="min-h-screen flex" style={{ background: "var(--pos-bg)" }} data-testid="dash-layout">
      <aside className="w-60 shrink-0 flex flex-col" style={{ background: "var(--pos-panel)", borderRight: "1px solid var(--pos-border)" }}>
        <div className="p-4 flex items-center gap-2" style={{ borderBottom: "1px solid var(--pos-border)" }}>
          <Building2 className="w-5 h-5" style={{ color: "var(--pos-accent)" }} />
          <div className="leading-tight">
            <div className="text-sm font-bold text-white">KANDA</div>
            <div className="text-[10px] tracking-wider uppercase" style={{ color: "var(--pos-muted)" }}>Dashboard</div>
          </div>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {items.map(({ to, end, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={end} data-testid={`dash-nav-${label.toLowerCase()}`}
              className={({ isActive }) => `pos-btn flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium ${isActive ? "text-white" : ""}`}
              style={({ isActive }) => ({ background: isActive ? "var(--pos-accent)" : "transparent", color: isActive ? "#fff" : "var(--pos-muted)" })}>
              <Icon className="w-4 h-4" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 space-y-2" style={{ borderTop: "1px solid var(--pos-border)" }}>
          <div className="rounded-md p-2.5" style={{ background: "var(--pos-panel-2)" }}>
            <div className="text-xs font-bold text-white truncate">{user.name}</div>
            <div className="text-[10px]" style={{ color: "var(--pos-muted)" }}>{roleLabel}</div>
          </div>
          <button data-testid="dash-password-btn" onClick={() => navigate("/biz/account/password")}
            className="pos-btn w-full flex items-center gap-2 px-3 py-1.5 rounded text-xs"
            style={{ color: "var(--pos-muted)" }}>
            <KeyRound className="w-3.5 h-3.5" /> Change password
          </button>
          <button data-testid="dash-logout-btn" onClick={() => { logout(); navigate("/biz/login"); }}
            className="pos-btn w-full flex items-center gap-2 px-3 py-1.5 rounded text-xs"
            style={{ color: "#f87171" }}>
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 min-h-0 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
