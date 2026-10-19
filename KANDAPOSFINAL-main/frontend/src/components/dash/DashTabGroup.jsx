import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useDash } from "../../store/DashContext";
import { sectionByKey, visibleTabs } from "./dashNav";

// A plain tab strip above a sidebar section's pages. Each tab is the page's
// existing URL and the page component renders unchanged below it (Outlet).
export default function DashTabGroup({ section }) {
  const { user, features } = useDash();
  const def = sectionByKey(section);
  const tabs = def ? visibleTabs(def, user, features) : [];

  return (
    <>
      {tabs.length > 1 && (
        <div className="px-4 md:px-6 pt-4 flex gap-2 overflow-x-auto" data-testid="dash-tabs">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end data-testid={`dash-tab-${t.to.split("/").pop()}`}
              className="pos-btn shrink-0 whitespace-nowrap px-3 py-1.5 rounded-md text-xs font-semibold"
              style={({ isActive }) => ({
                background: isActive ? "var(--pos-accent)" : "var(--pos-panel)",
                color: isActive ? "#fff" : "var(--pos-muted)",
                border: "1px solid var(--pos-border)",
              })}>
              {t.label}
            </NavLink>
          ))}
        </div>
      )}
      <Outlet />
    </>
  );
}
