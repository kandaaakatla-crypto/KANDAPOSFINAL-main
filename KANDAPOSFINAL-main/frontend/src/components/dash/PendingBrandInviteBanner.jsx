import React, { useEffect, useState } from "react";
import { useDash } from "../../store/DashContext";
import { brandApi } from "../../api/client";
import { Mail, Check, X } from "lucide-react";
import { toast } from "sonner";

/** Shown to any store owner with a pending invite to join someone else's
 * brand. Accepting only adds this store to that brand for their switcher,
 * reporting, and royalties — it does not hand this owner reciprocal access
 * to any other store in that brand. */
export default function PendingBrandInviteBanner() {
  const { user } = useDash();
  const [invites, setInvites] = useState([]);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (user?.dash_role !== "owner") return;
    brandApi.myPendingInvites().then(setInvites).catch(() => {});
  }, [user?.dash_role]);

  if (user?.dash_role !== "owner" || invites.length === 0) return null;

  const respond = async (id, accept) => {
    setBusy(id);
    try {
      if (accept) {
        await brandApi.acceptInvite(id);
        toast.success("Joined the brand");
        window.location.reload(); // picks up the new tenant.brand_id everywhere
      } else {
        await brandApi.declineInvite(id);
        setInvites((prev) => prev.filter((i) => i.id !== id));
        toast.success("Invite declined");
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not respond to invite");
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2" data-testid="brand-invite-banner">
      {invites.map((inv) => (
        <div key={inv.id} className="rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap"
          style={{ background: "linear-gradient(135deg, rgba(249,115,22,0.15), rgba(234,88,12,0.08))", border: "1px solid rgba(249,115,22,0.4)" }}>
          <div className="flex items-center gap-2.5">
            <Mail className="w-4 h-4 shrink-0" style={{ color: "var(--pos-accent)" }} />
            <div className="text-sm" style={{ color: "var(--pos-text)" }}>
              <b>{inv.brand_name}</b> invited your store to join their brand.
            </div>
          </div>
          <div className="flex gap-2">
            <button data-testid={`brand-invite-accept-${inv.id}`} onClick={() => respond(inv.id, true)} disabled={busy === inv.id}
              className="pos-btn h-8 px-3 rounded-md text-xs font-bold text-white flex items-center gap-1 disabled:opacity-40"
              style={{ background: "var(--pos-accent)" }}>
              <Check className="w-3.5 h-3.5" /> Accept
            </button>
            <button data-testid={`brand-invite-decline-${inv.id}`} onClick={() => respond(inv.id, false)} disabled={busy === inv.id}
              className="pos-btn h-8 px-3 rounded-md text-xs font-bold flex items-center gap-1 disabled:opacity-40"
              style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
              <X className="w-3.5 h-3.5" /> Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
