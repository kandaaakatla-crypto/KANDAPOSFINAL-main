import React, { useState } from "react";
import { ownerData } from "../../api/ownerClient";
import { Switch } from "../ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { SlidersHorizontal, Store, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";

const GROUPS = [
  {
    title: "Dine-in & kitchen",
    rows: [
      { key: "tables", label: "Tables / floor plan", desc: "Dine-in seating, table QR ordering, floor layout editor." },
      { key: "kitchen_display", label: "Kitchen display (KDS)", desc: "Kitchen tablet ticket screen." },
      { key: "packing_station", label: "Packing station", desc: "Pack-and-check screen for collection/delivery." },
      { key: "dispatch", label: "Dispatch & drivers", desc: "Delivery driver assignment and tracking." },
      { key: "meal_deals", label: "Meal deals", desc: "Pick-N-per-category bundle pricing." },
      { key: "pizza_sizing", label: "Multi-size items", desc: "Small/medium/large pricing on a menu item." },
    ],
  },
  {
    title: "Customer & growth",
    rows: [
      { key: "qr_ordering", label: "QR self-ordering", desc: "Customer-facing table/pickup ordering pages." },
      { key: "online_payments", label: "Online payments", desc: "Customers can pay online at checkout (Razorpay)." },
      { key: "loyalty", label: "Loyalty program", desc: "Points earned/redeemed on paid orders." },
      { key: "customer_display", label: "Customer display", desc: "Order-status screen for the counter/waiting area." },
      { key: "voice_agent", label: "Voice agent", desc: "AI phone-ordering assistant." },
      { key: "customer_sms", label: "Customer SMS", desc: "SMS marketing / order notifications." },
      { key: "whatsapp", label: "WhatsApp", desc: "WhatsApp ordering/notifications integration." },
      { key: "daily_digest", label: "Daily digest", desc: "End-of-day summary email/report." },
    ],
  },
];

export default function TenantFeaturesCard({ tenant, onChanged }) {
  const [features, setFeatures] = useState(tenant.features || {});
  const [businessType, setBusinessType] = useState(tenant.business_type || "restaurant");
  const [savingKey, setSavingKey] = useState(null);
  const [savingType, setSavingType] = useState(false);

  const toggle = async (key, value) => {
    setSavingKey(key);
    setFeatures((prev) => ({ ...prev, [key]: value })); // optimistic
    try {
      const r = await ownerData.updateFeatures(tenant.id, { [key]: value });
      setFeatures(r.features);
      onChanged?.(r);
    } catch (e) {
      setFeatures((prev) => ({ ...prev, [key]: !value })); // revert
      toast.error(e?.response?.data?.detail || "Could not update that feature");
    } finally { setSavingKey(null); }
  };

  const changeBusinessType = async (v) => {
    if (v === businessType) return;
    setSavingType(true);
    try {
      const t = await ownerData.updateBusinessType(tenant.id, v);
      setBusinessType(t.business_type);
      setFeatures(t.features || features);
      toast.success(`Switched to ${v}`);
      onChanged?.(t);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not change business type");
    } finally { setSavingType(false); }
  };

  return (
    <div className="rounded-xl" data-testid="tenant-features-card" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
      <div className="px-4 py-3 flex items-center justify-between flex-wrap gap-2" style={{ borderBottom: "1px solid var(--pos-border)" }}>
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4" style={{ color: "var(--pos-accent)" }} />
          <span className="text-sm font-semibold text-white">Features</span>
          <span className="text-[10px]" style={{ color: "var(--pos-muted)" }}>— toggle anything on/off for this client, independent of code or plan.</span>
        </div>
        <div className="flex items-center gap-2">
          {businessType === "retail" ? <Store className="w-3.5 h-3.5" style={{ color: "var(--pos-muted)" }} /> : <UtensilsCrossed className="w-3.5 h-3.5" style={{ color: "var(--pos-muted)" }} />}
          <Select value={businessType} onValueChange={changeBusinessType} disabled={savingType}>
            <SelectTrigger data-testid="tenant-business-type-select" className="h-8 text-xs text-white w-36" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="restaurant">Restaurant</SelectItem>
              <SelectItem value="retail">Retail store</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="p-4 space-y-5">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <div className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--pos-muted)" }}>{g.title}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {g.rows.map(({ key, label, desc }) => (
                <div key={key} data-testid={`owner-feature-row-${key}`} className="flex items-center justify-between gap-3 rounded-lg p-3" style={{ background: "var(--pos-panel-2)" }}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white">{label}</div>
                    <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>{desc}</div>
                  </div>
                  <Switch data-testid={`owner-feature-toggle-${key}`} checked={!!features[key]} disabled={savingKey === key}
                    onCheckedChange={(v) => toggle(key, v)} className="shrink-0" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
