import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { giftCardsApi, storeCreditApi, customersApi } from "../../api/client";
import { Wallet, Gift, Plus, Loader2, Search, Ban, Copy } from "lucide-react";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "../ui/alert-dialog";

const EMPTY_CARD = { value: "", recipient_name: "", recipient_phone: "", recipient_email: "" };

/**
 * Restaurant Dashboard → Gift Cards. Two tabs:
 *   1. Gift Cards — issue a new prepaid card (optionally texted/emailed to
 *      the recipient) and manage existing ones.
 *   2. Store Credit — look up a specific customer's wallet balance and
 *      ledger, and manually top up / adjust it (also fed by refund-to-credit
 *      in the POS Refund modal).
 * Both are prepaid-balance instruments redeemed at POS checkout alongside
 * loyalty points and coupons.
 */
export default function DashGiftCards() {
  const [tab, setTab] = useState("cards");
  return (
    <div className="p-6 space-y-6" data-testid="dash-gift-cards">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: "var(--pos-text)" }}>
          <Wallet className="w-6 h-6" style={{ color: "#7ee2a8" }} />
          Gift Cards &amp; Store Credit
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>
          Prepaid balances customers can redeem at checkout — gift cards by code, store credit by their own account.
        </p>
      </div>

      <div className="flex gap-2">
        <button data-testid="tab-gift-cards" onClick={() => setTab("cards")}
          className="pos-btn h-9 px-4 rounded-md text-xs font-bold"
          style={{ background: tab === "cards" ? "var(--pos-accent)" : "var(--pos-panel-2)", color: tab === "cards" ? "#fff" : "var(--pos-text)" }}>
          Gift Cards
        </button>
        <button data-testid="tab-store-credit" onClick={() => setTab("credit")}
          className="pos-btn h-9 px-4 rounded-md text-xs font-bold"
          style={{ background: tab === "credit" ? "var(--pos-accent)" : "var(--pos-panel-2)", color: tab === "credit" ? "#fff" : "var(--pos-text)" }}>
          Store Credit
        </button>
      </div>

      {tab === "cards" ? <GiftCardsTab /> : <StoreCreditTab />}
    </div>
  );
}

function GiftCardsTab() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_CARD);
  const [issuing, setIssuing] = useState(false);

  const load = () => {
    setLoading(true);
    giftCardsApi.list().then(setCards).catch(() => toast.error("Could not load gift cards")).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const issue = async () => {
    const value = Number(form.value);
    if (!(value > 0)) { toast.error("Enter a value"); return; }
    setIssuing(true);
    try {
      const card = await giftCardsApi.create({
        value,
        recipient_name: form.recipient_name.trim() || null,
        recipient_phone: form.recipient_phone.trim() || null,
        recipient_email: form.recipient_email.trim() || null,
      });
      toast.success(`Gift card ${card.code} issued — ₹${card.initial_value.toFixed(2)}`);
      setForm(EMPTY_CARD);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not issue gift card");
    } finally {
      setIssuing(false);
    }
  };

  const cancelCard = async (card) => {
    try {
      await giftCardsApi.cancel(card.id);
      toast.success(`Gift card ${card.code} cancelled`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not cancel card");
    }
  };

  const copyCode = (code) => {
    navigator.clipboard?.writeText(code);
    toast.success("Code copied");
  };

  const STATUS_COLOR = { active: "#7ee2a8", redeemed: "var(--pos-muted)", cancelled: "#f87171" };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 rounded-xl overflow-hidden" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
        <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--pos-border)" }}>
          <div className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>All gift cards</div>
        </div>
        <div className="p-5">
          {loading && <div className="text-sm" style={{ color: "var(--pos-muted)" }}>Loading…</div>}
          {!loading && cards.length === 0 && (
            <div className="text-sm text-center py-8" style={{ color: "var(--pos-muted)" }}>No gift cards issued yet — issue one on the right.</div>
          )}
          <div className="space-y-1.5">
            {cards.map((c) => (
              <div key={c.id} data-testid={`gift-card-row-${c.id}`} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 flex-wrap"
                style={{ background: "var(--pos-panel-2)" }}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <button onClick={() => copyCode(c.code)} className="pos-btn font-bold tracking-wider flex items-center gap-1" style={{ color: "var(--pos-text)" }} title="Copy code">
                      {c.code} <Copy className="w-3 h-3" style={{ color: "var(--pos-muted)" }} />
                    </button>
                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: "var(--pos-panel)", color: STATUS_COLOR[c.status] }}>{c.status}</span>
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: "var(--pos-muted)" }}>
                    ₹{c.balance.toFixed(2)} / ₹{c.initial_value.toFixed(2)}
                    {c.recipient_name && ` · for ${c.recipient_name}`}
                    {c.recipient_phone && ` · ${c.recipient_phone}`}
                  </div>
                </div>
                {c.status === "active" && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button data-testid={`gift-card-cancel-${c.id}`}
                        className="pos-btn h-7 px-2.5 rounded-md text-[11px] font-bold flex items-center gap-1 shrink-0"
                        style={{ background: "var(--pos-panel)", color: "#f87171", border: "1px solid var(--pos-border)" }}>
                        <Ban className="w-3 h-3" /> Cancel
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Cancel gift card?</AlertDialogTitle>
                        <AlertDialogDescription>Cancel gift card {c.code}? This can't be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep card</AlertDialogCancel>
                        <AlertDialogAction data-testid={`gift-card-cancel-confirm-${c.id}`} onClick={() => cancelCard(c)}>Cancel card</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl overflow-hidden h-fit" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
        <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--pos-border)" }}>
          <div className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>Issue a gift card</div>
        </div>
        <div className="p-5 space-y-3">
          <Field label="Value (₹)">
            <input data-testid="gift-card-form-value" type="number" min={1} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })}
              placeholder="500" className="w-full rounded px-2 py-1.5 text-sm outline-none" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
          </Field>
          <Field label="Recipient name (optional)">
            <input data-testid="gift-card-form-name" value={form.recipient_name} onChange={(e) => setForm({ ...form, recipient_name: e.target.value })}
              className="w-full rounded px-2 py-1.5 text-sm outline-none" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
          </Field>
          <Field label="Recipient phone (optional — texts the code)">
            <input data-testid="gift-card-form-phone" value={form.recipient_phone} onChange={(e) => setForm({ ...form, recipient_phone: e.target.value })}
              className="w-full rounded px-2 py-1.5 text-sm outline-none" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
          </Field>
          <Field label="Recipient email (optional — emails the code)">
            <input data-testid="gift-card-form-email" type="email" value={form.recipient_email} onChange={(e) => setForm({ ...form, recipient_email: e.target.value })}
              className="w-full rounded px-2 py-1.5 text-sm outline-none" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
          </Field>
          <button data-testid="gift-card-issue-btn" onClick={issue} disabled={issuing}
            className="pos-btn w-full mt-1 px-3 py-2 rounded-lg text-xs text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
            style={{ background: "var(--pos-accent)" }}>
            {issuing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Gift className="w-3.5 h-3.5" />} Issue gift card
          </button>
        </div>
      </div>
    </div>
  );
}

function StoreCreditTab() {
  const [phone, setPhone] = useState("");
  const [searching, setSearching] = useState(false);
  const [customer, setCustomer] = useState(null);
  const [credit, setCredit] = useState(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const search = async () => {
    if (!phone.trim()) return;
    setSearching(true);
    setCustomer(null); setCredit(null);
    try {
      const cust = await customersApi.search(phone.trim());
      if (!cust) { toast.error("No customer found for that phone"); return; }
      setCustomer(cust);
      const c = await storeCreditApi.get(cust.id);
      setCredit(c);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const adjust = async () => {
    const amt = Number(amount);
    if (!amt) { toast.error("Enter a non-zero amount"); return; }
    if (!note.trim()) { toast.error("A reason note is required"); return; }
    setSaving(true);
    try {
      await storeCreditApi.adjust(customer.id, { amount: amt, note: note.trim() });
      toast.success(`Store credit ${amt > 0 ? "added" : "removed"}`);
      setAmount(""); setNote("");
      const c = await storeCreditApi.get(customer.id);
      setCredit(c);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not adjust balance");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl overflow-hidden max-w-2xl" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
      <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--pos-border)" }}>
        <div className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>Find a customer</div>
      </div>
      <div className="p-5 space-y-4">
        <div className="flex gap-2">
          <input data-testid="credit-search-phone" value={phone} onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Phone number" className="flex-1 rounded px-3 py-2 text-sm outline-none" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
          <button data-testid="credit-search-btn" onClick={search} disabled={searching}
            className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white flex items-center gap-1.5 disabled:opacity-40" style={{ background: "var(--pos-accent)" }}>
            {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} Find
          </button>
        </div>

        {credit && (
          <div className="space-y-4">
            <div className="rounded-lg p-4" style={{ background: "var(--pos-panel-2)" }}>
              <div className="font-bold" style={{ color: "var(--pos-text)" }}>{credit.name}</div>
              <div className="text-xs mt-0.5" style={{ color: "var(--pos-muted)" }}>{credit.phone}</div>
              <div className="text-2xl font-bold mt-2" style={{ color: "#7ee2a8" }}>₹{credit.store_credit.toFixed(2)}</div>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Current balance</div>
            </div>

            <div className="flex gap-2 items-end flex-wrap">
              <Field label="Adjustment (₹, can be negative)">
                <input data-testid="credit-adjust-amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                  placeholder="100" className="w-32 rounded px-2 py-1.5 text-sm outline-none" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
              </Field>
              <Field label="Reason">
                <input data-testid="credit-adjust-note" value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Goodwill gesture" className="w-56 rounded px-2 py-1.5 text-sm outline-none" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
              </Field>
              <button data-testid="credit-adjust-btn" onClick={adjust} disabled={saving}
                className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white flex items-center gap-1.5 disabled:opacity-40" style={{ background: "var(--pos-accent)" }}>
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Apply
              </button>
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--pos-muted)" }}>Recent activity</div>
              <div className="space-y-1" data-testid="credit-recent-activity">
                {credit.transactions.length === 0 && <div className="text-xs" style={{ color: "var(--pos-muted)" }}>No activity yet.</div>}
                {credit.transactions.map((t) => (
                  <div key={t.id} className="flex items-center justify-between text-xs px-2 py-1.5 rounded" style={{ background: "var(--pos-panel-2)" }}>
                    <div className="min-w-0">
                      <span className="capitalize" style={{ color: "var(--pos-text)" }}>{t.kind}</span>
                      {t.note && <span className="ml-2" style={{ color: "var(--pos-muted)" }}>{t.note}</span>}
                    </div>
                    <span className="tabular-nums shrink-0 ml-2" style={{ color: t.amount >= 0 ? "#4ade80" : "#f87171" }}>
                      {t.amount >= 0 ? "+" : ""}₹{t.amount.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
