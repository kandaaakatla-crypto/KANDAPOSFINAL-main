import React, { useEffect, useState } from "react";
import { ownerData } from "../../api/ownerClient";
import { CreditCard, Loader2, Link as LinkIcon, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "../ui/alert-dialog";
import { fmtDate } from "../../utils/formatDate";

const STATUS_COLOR = {
  active: "#22c55e",
  pending: "#f59e0b",
  halted: "#ef4444",
  cancelled: "#6b7280",
  completed: "#3b82f6",
  expired: "#ef4444",
  none: "#6b7280",
  created: "#a3a3a3",
};

export default function TenantBillingCard({ tenantId }) {
  const [billing, setBilling] = useState(null);
  const [plans, setPlans] = useState([]);
  const [selected, setSelected] = useState("starter");
  const [busy, setBusy] = useState(false);
  const [lastUrl, setLastUrl] = useState(null);

  const load = () => {
    Promise.all([ownerData.billing(tenantId), ownerData.plans()])
      .then(([b, p]) => { setBilling(b); setPlans(p); if (b?.plan && b.plan !== "none" && b.plan !== "trial") setSelected(b.plan); })
      .catch(() => {});
  };
  useEffect(() => { load(); }, [tenantId]); // eslint-disable-line

  const onSubscribe = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await ownerData.subscribe(tenantId, selected);
      toast.success(`Subscription created (${r.status})`);
      setLastUrl(r.short_url || null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not create subscription");
    } finally { setBusy(false); }
  };

  const onCancel = async () => {
    setBusy(true);
    try {
      await ownerData.cancel(tenantId);
      toast.success("Subscription will cancel at cycle end");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not cancel");
    } finally { setBusy(false); }
  };

  if (!billing) return null;

  return (
    <div className="rounded-xl" data-testid="tenant-billing" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--pos-border)" }}>
        <div className="flex items-center gap-2">
          <CreditCard className="w-4 h-4" style={{ color: "var(--pos-accent)" }} />
          <span className="text-sm font-semibold" style={{ color: "var(--pos-text)" }}>Subscription</span>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full font-bold uppercase tracking-wider"
          style={{ background: "var(--pos-panel-2)", color: STATUS_COLOR[billing.status] || "#a3a3a3" }}>
          {billing.status}
        </span>
      </div>

      <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Plan</div>
          <div className="font-bold mt-0.5" style={{ color: "var(--pos-text)" }} data-testid="billing-plan">{billing.plan}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Renews</div>
          <div className="tabular-nums mt-0.5" style={{ color: "var(--pos-text)" }}>{billing.current_period_end ? fmtDate(billing.current_period_end) : "—"}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Grace until</div>
          <div className="tabular-nums mt-0.5" style={{ color: "var(--pos-text)" }}>{billing.grace_until ? fmtDate(billing.grace_until) : "—"}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Last paid</div>
          <div className="tabular-nums mt-0.5" style={{ color: "var(--pos-text)" }}>{billing.last_payment_at ? fmtDate(billing.last_payment_at) : "—"}</div>
        </div>
      </div>

      <div className="px-4 pb-4 space-y-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--pos-muted)" }}>Change plan</div>
          <div className="grid grid-cols-3 gap-2">
            {plans.map((p) => {
              const active = selected === p.key;
              return (
                <button key={p.key} type="button" data-testid={`plan-${p.key}`} onClick={() => setSelected(p.key)}
                  className="pos-btn rounded-lg p-3 text-left"
                  style={{ background: active ? "var(--pos-accent)" : "var(--pos-panel-2)", color: active ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                  <div className="text-sm font-bold">{p.name}</div>
                  <div className="text-[11px] mt-0.5">₹{p.amount_inr}/mo</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button data-testid="subscribe-btn" onClick={onSubscribe} disabled={busy}
            className="pos-btn h-10 px-4 rounded-lg text-sm font-bold text-white flex items-center gap-1.5 disabled:opacity-40"
            style={{ background: "var(--pos-accent)" }}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LinkIcon className="w-4 h-4" />}
            {billing.subscription_id ? "Send new payment link" : "Create subscription"}
          </button>
          {billing.subscription_id && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button data-testid="cancel-sub-btn" disabled={busy}
                  className="pos-btn h-10 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5"
                  style={{ background: "var(--pos-panel-2)", color: "#dc2626", border: "1px solid rgba(220,38,38,0.4)" }}>
                  <XCircle className="w-3.5 h-3.5" /> Cancel at cycle end
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel subscription?</AlertDialogTitle>
                  <AlertDialogDescription>Cancel this subscription at the end of the current cycle?</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep subscription</AlertDialogCancel>
                  <AlertDialogAction data-testid="cancel-sub-confirm-btn" onClick={onCancel}>Cancel subscription</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {lastUrl && (
          <div className="text-[11px] rounded-md p-2 flex items-center gap-2" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
            <LinkIcon className="w-3 h-3" style={{ color: "var(--pos-accent)" }} />
            <a data-testid="subscription-short-url" href={lastUrl} target="_blank" rel="noreferrer" style={{ color: "var(--pos-accent)" }} className="underline truncate">{lastUrl}</a>
            <button onClick={() => { navigator.clipboard.writeText(lastUrl); toast.success("Link copied"); }}
              className="ml-auto h-6 px-2 rounded-md text-[10px]" style={{ background: "var(--pos-panel)", color: "var(--pos-muted)" }}>Copy</button>
          </div>
        )}
      </div>
    </div>
  );
}
