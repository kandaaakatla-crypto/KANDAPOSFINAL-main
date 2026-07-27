import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useDash, canAddLocation } from "../../store/DashContext";
import { Lock, ShoppingBag, IndianRupee, Users, Boxes, MapPin, Plus, AlertCircle, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "../ui/switch";
import PeakHoursHeatmap from "./PeakHoursHeatmap";

const FEATURE_LABELS = [
  { key: "tables", label: "Tables / floor plan", desc: "Dine-in seating, table QR ordering." },
  { key: "kitchen_display", label: "Kitchen display (KDS)", desc: "Kitchen tablet ticket screen." },
  { key: "packing_station", label: "Packing station", desc: "Pack-and-check screen for collection/delivery." },
  { key: "dispatch", label: "Dispatch & drivers", desc: "Delivery driver assignment and tracking." },
  { key: "meal_deals", label: "Meal deals", desc: "Pick-N-per-category bundle pricing." },
  { key: "pizza_sizing", label: "Multi-size items", desc: "Small/medium/large pricing on a menu item." },
];

/**
 * Multi-store overview — one card per location the user can see.
 * - Owner: all locations (location_ids is empty array → all).
 * - Area Manager: only the locations in their location_ids.
 * - Manager: only their single location.
 */
export default function DashHome() {
  const { user, api } = useDash();
  const [locations, setLocations] = useState([]);
  const [summary, setSummary] = useState(null);
  const [staffCount, setStaffCount] = useState(0);
  const [lowCount, setLowCount] = useState(0);
  const [tenantInfo, setTenantInfo] = useState(null);
  const [savingFeature, setSavingFeature] = useState(null);

  useEffect(() => {
    api.get("/locations").then((r) => {
      const allowed = user.location_ids && user.location_ids.length
        ? r.data.filter((l) => user.location_ids.includes(l.id))
        : r.data;
      setLocations(allowed);
    }).catch(() => {});
    api.get("/reports/summary").then((r) => setSummary(r.data)).catch(() => {});
    api.get("/staff").then((r) => setStaffCount(r.data.filter((s) => s.active).length)).catch(() => {});
    api.get("/inventory").then((r) => setLowCount(r.data.filter((i) => i.stock <= i.reorder).length)).catch(() => {});
    api.get("/tenant/info").then((r) => setTenantInfo(r.data)).catch(() => {});
  }, [api, user.location_ids]);

  const toggleFeature = async (key, value) => {
    setSavingFeature(key);
    try {
      const r = await api.patch("/tenant/features", { [key]: value });
      setTenantInfo(r.data);
    } catch {
      toast.error("Could not update that setting");
    } finally { setSavingFeature(null); }
  };

  const roleLabel = { owner: "Owner", area_manager: "Area Manager", manager: "Manager" }[user.dash_role];

  return (
    <div className="p-6 space-y-6" data-testid="dash-home">
      <div>
        <h1 className="text-2xl font-bold text-white">Welcome back, {user.name.split(" ")[0]}</h1>
        <p className="text-sm" style={{ color: "var(--pos-muted)" }}>
          {roleLabel} · {locations.length} {locations.length === 1 ? "store" : "stores"} in your scope.
        </p>
      </div>

      {/* Top-line KPIs across the user's scope */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Today's sales" value={summary ? `₹${summary.todaySales.toFixed(0)}` : "—"} icon={IndianRupee} accent="#22c55e" testid="kpi-sales" />
        <Kpi label="Orders today" value={summary?.ordersToday ?? "—"} icon={ShoppingBag} accent="#7dd3fc" testid="kpi-orders" />
        <Kpi label="Active staff" value={staffCount} icon={Users} accent="#fcd34d" testid="kpi-staff" />
        <Kpi label="Low-stock items" value={lowCount} icon={Boxes} accent={lowCount > 0 ? "#fca5a5" : "#86efac"} testid="kpi-low" />
      </div>

      {/* Peak hours heatmap — reveals your busiest weekday × hour buckets */}
      <PeakHoursHeatmap days={28} />

      {/* Store type + feature toggles */}
      {tenantInfo && (
        <div className="rounded-xl p-4" data-testid="store-features-card" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          <div className="flex items-center gap-2 mb-1">
            <Settings2 className="w-4 h-4" style={{ color: "var(--pos-accent)" }} />
            <h2 className="text-base font-bold text-white">Store features</h2>
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>
              {tenantInfo.businessType === "retail" ? "Retail store" : "Restaurant"}
            </span>
          </div>
          <p className="text-xs mb-4" style={{ color: "var(--pos-muted)" }}>
            Turn any of these on or off for this store — none of them are locked to restaurant or retail.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {FEATURE_LABELS.map(({ key, label, desc }) => (
              <div key={key} data-testid={`feature-row-${key}`} className="flex items-center justify-between gap-3 rounded-lg p-3" style={{ background: "var(--pos-panel-2)" }}>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white">{label}</div>
                  <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>{desc}</div>
                </div>
                <Switch data-testid={`feature-toggle-${key}`} checked={!!tenantInfo.features?.[key]} disabled={savingFeature === key}
                  onCheckedChange={(v) => toggleFeature(key, v)} className="shrink-0" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Store cards */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-white">Your stores</h2>
          {canAddLocation(user) ? (
            <Link to="/biz/locations" data-testid="dash-add-location-btn"
              className="pos-btn h-9 px-3 rounded-md text-xs font-bold flex items-center gap-2 text-white"
              style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)" }}>
              <Plus className="w-3.5 h-3.5" /> Add location
            </Link>
          ) : null}
        </div>
        {locations.length === 0 ? (
          <div className="rounded-xl p-6 text-center" style={{ background: "var(--pos-panel)", border: "1px dashed var(--pos-border)" }} data-testid="dash-no-locations">
            <AlertCircle className="w-6 h-6 mx-auto mb-2" style={{ color: "var(--pos-muted)" }} />
            <p className="text-sm" style={{ color: "var(--pos-muted)" }}>No stores assigned to you yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {locations.map((l) => (
              <div key={l.id} data-testid={`dash-store-${l.id}`} className="rounded-xl p-4"
                style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-bold text-white flex items-center gap-2">
                      <MapPin className="w-4 h-4" style={{ color: "var(--pos-accent)" }} /> {l.name}
                      {l.is_default && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "#0e2515", color: "#86efac" }}>Default</span>}
                    </div>
                    <div className="text-xs mt-1" style={{ color: "var(--pos-muted)" }}>{l.address || "—"}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <Mini label="Phone" value={l.phone || "—"} />
                  <Mini label="Store #" value={l.store_number || "—"} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, icon: Icon, accent, testid }) {
  return (
    <div className="rounded-xl p-4 flex items-center gap-3" data-testid={testid}
      style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
      <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${accent}22` }}>
        <Icon className="w-5 h-5" style={{ color: accent }} />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>{label}</div>
        <div className="text-xl font-bold text-white tabular-nums truncate">{value}</div>
      </div>
    </div>
  );
}

function Mini({ label, value }) {
  return (
    <div className="rounded-md px-2 py-1.5" style={{ background: "var(--pos-panel-2)" }}>
      <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>{label}</div>
      <div className="text-xs text-white truncate">{value}</div>
    </div>
  );
}
