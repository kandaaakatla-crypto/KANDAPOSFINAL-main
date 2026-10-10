import React, { useEffect, useState } from "react";
import { useDash } from "../../store/DashContext";
import { teamApi } from "../../api/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Store } from "lucide-react";

/** Rendered for anyone with more than one store — an owner with a brand, or
 * an area manager the owner gave several stores — and lets them jump their
 * whole dashboard session to another of those stores without a separate
 * login per store. The API decides the list (/dash/stores). */
export default function StoreSwitcher() {
  const { user, switchStore } = useDash();
  const [stores, setStores] = useState([]);
  const [busy, setBusy] = useState(false);

  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    teamApi.myStores().then(setStores).catch(() => {});
  }, [userId]);

  if (stores.length < 2) return null;

  const onChange = async (tenantId) => {
    if (tenantId === user.tenant_id || busy) return;
    setBusy(true);
    try {
      await switchStore(tenantId); // hard-reloads on success
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="px-3 pb-2">
      <div className="text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1" style={{ color: "var(--pos-muted)" }}>
        <Store className="w-3 h-3" /> Active store
      </div>
      <Select value={user.tenant_id} onValueChange={onChange} disabled={busy}>
        <SelectTrigger data-testid="store-switcher" className="h-9 text-xs" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {stores.map((s) => (
            <SelectItem key={s.id} value={s.id} data-testid={`store-switcher-option-${s.id}`}>{s.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
