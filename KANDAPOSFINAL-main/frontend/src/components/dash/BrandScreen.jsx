import React, { useEffect, useState } from "react";
import { useDash } from "../../store/DashContext";
import { brandApi } from "../../api/client";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Switch } from "../ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import {
  Store, Plus, Loader2, Image as ImageIcon, MessageSquare,
  IndianRupee, Copy, Trash2, Send, UploadCloud, CheckCircle2,
  ShieldCheck, Mail, X, FileText, Download,
} from "lucide-react";
import { toast } from "sonner";

function ensureRazorpayScript() {
  if (window.Razorpay) return Promise.resolve();
  if (window.__razorpayScript) return window.__razorpayScript;
  window.__razorpayScript = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load Razorpay"));
    document.body.appendChild(s);
  });
  return window.__razorpayScript;
}

const FEATURE_ROWS = [
  ["tables", "Tables / floor plan"], ["kitchen_display", "Kitchen display"], ["packing_station", "Packing station"],
  ["dispatch", "Dispatch & drivers"], ["meal_deals", "Meal deals"], ["pizza_sizing", "Multi-size items"],
  ["qr_ordering", "QR self-ordering"], ["online_payments", "Online payments"], ["loyalty", "Loyalty program"],
  ["customer_display", "Customer display"], ["payroll", "Payroll"],
];

function isoDate(d) { return d.toISOString().slice(0, 10); }

export default function BrandScreen() {
  const { user } = useDash();
  const [brand, setBrand] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    if (!user?.brand_id) { setLoading(false); return; }
    setLoading(true);
    brandApi.get(user.brand_id).then(setBrand).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [user?.brand_id]); // eslint-disable-line

  if (!user?.brand_id) return <CreateBrandOnboarding />;
  if (loading) return <div className="p-6 flex items-center gap-2 text-white"><Loader2 className="w-5 h-5 animate-spin" /> Loading brand…</div>;
  if (!brand) return <div className="p-6 text-white">Brand not found.</div>;

  return <BrandDashboard brand={brand} onBrandChanged={setBrand} />;
}

// ===================================================================
// Onboarding — owner has no brand yet
// ===================================================================
function CreateBrandOnboarding() {
  const [form, setForm] = useState({ slug: "", name: "", royalty_percent: 0 });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await brandApi.create(form);
      toast.success(`${form.name} is now a brand`);
      window.location.reload(); // simplest way to pick up brand_id on the dash user
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not create brand");
    } finally { setBusy(false); }
  };

  return (
    <div className="p-6 max-w-lg mx-auto" data-testid="brand-onboarding">
      <div className="text-center mb-6">
        <Store className="w-10 h-10 mx-auto mb-2" style={{ color: "var(--pos-accent)" }} />
        <h1 className="text-2xl font-bold text-white">Turn this store into a brand</h1>
        <p className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>
          Group multiple stores or franchisees under one brand — this store becomes the first one.
          You'll be able to switch between every store, push shared menus and defaults, and see combined reporting.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-3 rounded-xl p-4" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Brand slug</span>
          <Input data-testid="brand-slug" required placeholder="zzfoods" value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.replace(/[^a-z0-9]/gi, "").toLowerCase() }))}
            className="h-10 text-white mt-1" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Brand name</span>
          <Input data-testid="brand-name" required placeholder="ZZ Foods" value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="h-10 text-white mt-1" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Default royalty % (per store, owed to you)</span>
          <Input data-testid="brand-royalty" type="number" min="0" max="100" step="0.5" value={form.royalty_percent}
            onChange={(e) => setForm((f) => ({ ...f, royalty_percent: Number(e.target.value) }))}
            className="h-10 text-white mt-1" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
        </label>
        <button data-testid="brand-create-submit" type="submit" disabled={busy}
          className="pos-btn w-full h-11 rounded-lg font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
          style={{ background: "var(--pos-accent)" }}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create brand
        </button>
      </form>
    </div>
  );
}

// ===================================================================
// Main brand dashboard
// ===================================================================
function BrandDashboard({ brand, onBrandChanged }) {
  const [tab, setTab] = useState("overview");
  const tabs = [
    ["overview", "Overview"], ["stores", "Stores"], ["menu", "Menu & defaults"],
    ["royalties", "Royalties"], ["marketing", "Marketing"],
  ];

  return (
    <div className="p-5" data-testid="brand-screen">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2"><Store className="w-5 h-5" style={{ color: "var(--pos-accent)" }} /> {brand.name}</h1>
          <p className="text-sm" style={{ color: "var(--pos-muted)" }}>Brand-wide reporting, shared menu, defaults, royalties, and marketing.</p>
        </div>
      </div>
      <div className="flex gap-2 mt-4 mb-5 flex-wrap">
        {tabs.map(([key, label]) => (
          <button key={key} data-testid={`brand-tab-${key}`} onClick={() => setTab(key)}
            className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white"
            style={{ background: tab === key ? "var(--pos-accent)" : "var(--pos-panel-2)" }}>{label}</button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab brand={brand} />}
      {tab === "stores" && <StoresTab brand={brand} />}
      {tab === "menu" && <MenuDefaultsTab brand={brand} onBrandChanged={onBrandChanged} />}
      {tab === "royalties" && <RoyaltiesTab brand={brand} />}
      {tab === "marketing" && <MarketingTab brand={brand} />}
    </div>
  );
}

function Card({ children, testid }) {
  return <div data-testid={testid} className="rounded-xl p-4" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>{children}</div>;
}

// ===================================================================
// Overview — rollup reporting
// ===================================================================
function OverviewTab({ brand }) {
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    brandApi.rollup(brand.id).then((d) => { setRows(d.stores); setTotals(d.totals); }).catch(() => {}).finally(() => setLoading(false));
  }, [brand.id]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 max-w-xl">
        <Card>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Stores</div>
          <div className="text-2xl font-bold text-white tabular-nums">{totals?.store_count ?? "—"}</div>
        </Card>
        <Card>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Orders (30d)</div>
          <div className="text-2xl font-bold text-white tabular-nums">{totals?.orders ?? "—"}</div>
        </Card>
        <Card>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Sales (30d)</div>
          <div className="text-2xl font-bold tabular-nums" style={{ color: "var(--pos-accent)" }}>₹{(totals?.sales ?? 0).toFixed(0)}</div>
        </Card>
      </div>
      <Card testid="brand-rollup-table">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--pos-border)" }}>
              <th className="text-left py-2 text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Store</th>
              <th className="text-right py-2 text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Orders</th>
              <th className="text-right py-2 text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Sales</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={3} className="text-center py-6" style={{ color: "var(--pos-muted)" }}>Loading…</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.tenant_id} data-testid={`rollup-row-${r.tenant_id}`} style={{ borderTop: "1px solid var(--pos-border)" }}>
                <td className="py-2 text-white">{r.store_name}</td>
                <td className="py-2 text-right tabular-nums text-white">{r.orders}</td>
                <td className="py-2 text-right tabular-nums font-bold" style={{ color: "var(--pos-accent)" }}>₹{r.sales.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ===================================================================
// Stores — list + add a new franchisee store
// ===================================================================
function StoresTab({ brand }) {
  const [stores, setStores] = useState([]);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null);
  const [invites, setInvites] = useState([]);
  const [inviteSlug, setInviteSlug] = useState("");
  const [inviting, setInviting] = useState(false);
  const [editingRoyalty, setEditingRoyalty] = useState(null); // tenant_id being edited
  const [royaltyValue, setRoyaltyValue] = useState("");

  const load = () => brandApi.listStores(brand.id).then(setStores).catch(() => {});
  const loadInvites = () => brandApi.listSentInvites(brand.id).then(setInvites).catch(() => {});
  useEffect(() => { load(); loadInvites(); }, [brand.id]); // eslint-disable-line

  const sendInvite = async (e) => {
    e.preventDefault();
    if (!inviteSlug.trim()) return;
    setInviting(true);
    try {
      await brandApi.sendInvite(brand.id, inviteSlug.trim());
      toast.success(`Invite sent to ${inviteSlug.trim()}`);
      setInviteSlug("");
      loadInvites();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not send invite");
    } finally { setInviting(false); }
  };

  const cancelInvite = async (id) => {
    await brandApi.cancelInvite(brand.id, id);
    loadInvites();
  };

  const startEditRoyalty = (s) => {
    setEditingRoyalty(s.id);
    setRoyaltyValue(s.royalty_percent ?? "");
  };

  const saveRoyalty = async (tenantId) => {
    try {
      const v = royaltyValue === "" ? null : Number(royaltyValue);
      await brandApi.updateStoreRoyalty(brand.id, tenantId, v);
      setEditingRoyalty(null);
      load();
      toast.success("Royalty updated");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not update royalty");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button data-testid="brand-add-store-btn" onClick={() => setCreating(true)}
          className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white flex items-center gap-2"
          style={{ background: "var(--pos-accent)" }}>
          <Plus className="w-4 h-4" /> Add store
        </button>
      </div>
      <Card testid="brand-stores-list">
        <div className="space-y-2">
          {stores.map((s) => (
            <div key={s.id} data-testid={`brand-store-row-${s.id}`} className="flex items-center justify-between rounded-lg p-3" style={{ background: "var(--pos-panel-2)" }}>
              <div>
                <div className="text-sm font-bold text-white">{s.name}</div>
                <div className="text-xs" style={{ color: "var(--pos-muted)" }}>{s.slug} · {s.business_type}</div>
              </div>
              {editingRoyalty === s.id ? (
                <div className="flex items-center gap-1.5">
                  <Input type="number" min="0" max="100" step="0.5" autoFocus value={royaltyValue}
                    onChange={(e) => setRoyaltyValue(e.target.value)}
                    placeholder={String(brand.royalty_percent)}
                    className="h-8 w-20 text-white text-xs" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} />
                  <button onClick={() => saveRoyalty(s.id)} className="pos-btn h-8 px-2 rounded-md text-[11px] font-bold text-white" style={{ background: "var(--pos-accent)" }}>Save</button>
                  <button onClick={() => setEditingRoyalty(null)} className="pos-btn h-8 px-2 rounded-md text-[11px]" style={{ color: "var(--pos-muted)" }}>Cancel</button>
                </div>
              ) : (
                <button data-testid={`brand-edit-royalty-${s.id}`} onClick={() => startEditRoyalty(s)}
                  className="pos-btn text-xs font-bold px-2.5 py-1.5 rounded-md" style={{ color: "var(--pos-accent)", background: "var(--pos-panel)" }}>
                  royalty {s.royalty_percent ?? brand.royalty_percent}%
                </button>
              )}
            </div>
          ))}
          {stores.length === 0 && <div className="text-sm text-center py-6" style={{ color: "var(--pos-muted)" }}>No stores yet.</div>}
        </div>
      </Card>

      <Card testid="brand-invite-card">
        <div className="text-sm font-bold text-white mb-1 flex items-center gap-2"><Mail className="w-4 h-4" style={{ color: "var(--pos-accent)" }} /> Invite an existing store</div>
        <p className="text-xs mb-3" style={{ color: "var(--pos-muted)" }}>
          For a store that's already up and running on its own. Its own owner has to accept from their dashboard before it joins — you don't get access until they do.
        </p>
        <form onSubmit={sendInvite} className="flex gap-2 mb-3">
          <Input placeholder="store-slug" value={inviteSlug} onChange={(e) => setInviteSlug(e.target.value.toLowerCase())}
            className="h-9 text-white text-sm" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
          <button type="submit" disabled={inviting} className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white shrink-0 disabled:opacity-40" style={{ background: "var(--pos-accent)" }}>
            {inviting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Send invite"}
          </button>
        </form>
        <div className="space-y-1.5">
          {invites.map((inv) => (
            <div key={inv.id} data-testid={`brand-invite-${inv.id}`} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--pos-panel-2)" }}>
              <div className="text-xs">
                <span className="text-white font-bold">{inv.tenant_name}</span>
                <span style={{ color: "var(--pos-muted)" }}> · {inv.tenant_slug} · {inv.status}</span>
              </div>
              {inv.status === "pending" && (
                <button onClick={() => cancelInvite(inv.id)} className="pos-btn p-1 rounded" style={{ color: "#f87171" }}><X className="w-3.5 h-3.5" /></button>
              )}
            </div>
          ))}
          {invites.length === 0 && <div className="text-xs text-center py-2" style={{ color: "var(--pos-muted)" }}>No invites sent yet.</div>}
        </div>
      </Card>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-md border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
          <DialogHeader><DialogTitle className="text-white">Add a store to {brand.name}</DialogTitle></DialogHeader>
          <NewStoreForm brand={brand} onDone={(res) => { setCreating(false); setCreated(res); load(); }} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!created} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent className="max-w-md border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
          <DialogHeader><DialogTitle className="text-white flex items-center gap-2"><CheckCircle2 className="w-5 h-5" style={{ color: "var(--pos-accent)" }} /> {created?.name} added</DialogTitle></DialogHeader>
          <p className="text-xs mb-2" style={{ color: "var(--pos-muted)" }}>
            Dashboard accounts for this store, shown <b>only here, once</b> — copy them down.
          </p>
          <div className="space-y-2">
            {(created?.dashboard_accounts || []).map((a) => (
              <div key={a.email} className="flex items-center justify-between gap-2 rounded-lg p-2.5" style={{ background: "var(--pos-panel-2)" }}>
                <div className="min-w-0 text-xs">
                  <div className="font-bold uppercase tracking-wider" style={{ color: "var(--pos-accent)" }}>{a.dash_role}</div>
                  <div className="text-white font-mono truncate">{a.email}</div>
                  <div className="text-white font-mono truncate">{a.password}</div>
                </div>
                <button onClick={() => { navigator.clipboard.writeText(`${a.email} / ${a.password}`); toast.success("Copied"); }}
                  className="pos-btn h-8 px-2.5 rounded-md text-[11px] font-bold flex items-center gap-1 shrink-0"
                  style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                  <Copy className="w-3 h-3" /> Copy
                </button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewStoreForm({ brand, onDone }) {
  const [form, setForm] = useState({
    slug: "", name: "", contact_email: "", manager_name: "Manager", manager_pin: "",
    store: { name: "", address: "", phone: "", tax_id: "" },
    business_type: "restaurant", apply_brand_defaults: true,
  });
  const [busy, setBusy] = useState(false);
  const [paymentNeeded, setPaymentNeeded] = useState(null); // {price, currency} from the 402
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setStore = (k, v) => setForm((f) => ({ ...f, store: { ...f.store, [k]: v } }));

  const attemptCreate = async () => {
    const res = await brandApi.createStore(brand.id, form);
    toast.success(`${res.name} created`);
    onDone(res);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await attemptCreate();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 402 && detail?.code === "payment_required") {
        setPaymentNeeded(detail);
      } else {
        toast.error(detail?.message || detail || "Could not create store");
      }
    } finally { setBusy(false); }
  };

  const pay = async () => {
    setBusy(true);
    try {
      await ensureRazorpayScript();
      const order = await brandApi.purchaseStoreSlot(brand.id);
      const rzp = new window.Razorpay({
        key: order.key_id, amount: order.amount, currency: order.currency, order_id: order.order_id,
        name: "Kanda POS", description: order.description, theme: { color: "#f97316" },
        handler: async (resp) => {
          try {
            await brandApi.verifyStoreSlot(brand.id, {
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            });
            toast.success("Payment successful — adding store…");
            setPaymentNeeded(null);
            await attemptCreate();
          } catch (e) {
            toast.error(e?.response?.data?.detail || "Payment verification or store creation failed");
          } finally { setBusy(false); }
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.on("payment.failed", (r) => { toast.error(r?.error?.description || "Payment failed"); setBusy(false); });
      rzp.open();
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "Could not start checkout");
      setBusy(false);
    }
  };

  const fld = "h-9 text-white text-sm mt-1";
  const fldStyle = { background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" };

  if (paymentNeeded) {
    return (
      <div className="space-y-4" data-testid="brand-store-payment-step">
        <div className="p-4 rounded-xl text-center"
          style={{ background: "linear-gradient(135deg, rgba(249,115,22,0.20), rgba(234,88,12,0.10))", border: "1px solid rgba(249,115,22,0.40)" }}>
          <div className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>One-time charge</div>
          <div className="mt-1 text-4xl font-bold text-white tabular-nums">₹{paymentNeeded.price.toFixed(0)}</div>
          <div className="text-[11px] mt-1" style={{ color: "var(--pos-muted)" }}>
            {paymentNeeded.used}/{paymentNeeded.total_slots} store slots used — pay to add another
          </div>
        </div>
        <button data-testid="brand-store-pay-btn" onClick={pay} disabled={busy}
          className="pos-btn w-full h-11 rounded-lg font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
          style={{ background: "var(--pos-accent)" }}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Pay ₹{paymentNeeded.price.toFixed(0)} & add store
        </button>
        <button type="button" onClick={() => setPaymentNeeded(null)}
          className="pos-btn w-full h-9 rounded-lg text-xs font-bold text-white"
          style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
          Back to store details
        </button>
        <div className="text-[10px] text-center" style={{ color: "var(--pos-muted)" }}>
          Test card <code>4111 1111 1111 1111</code> · any future date · any CVC · OTP <code>1234</code>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <label><span className="text-[10px] uppercase" style={{ color: "var(--pos-muted)" }}>Slug</span>
          <Input required value={form.slug} onChange={(e) => set("slug", e.target.value.replace(/[^a-z0-9]/gi, "").toLowerCase())} className={fld} style={fldStyle} /></label>
        <label><span className="text-[10px] uppercase" style={{ color: "var(--pos-muted)" }}>Store name</span>
          <Input required value={form.name} onChange={(e) => set("name", e.target.value)} className={fld} style={fldStyle} /></label>
      </div>
      <label className="block"><span className="text-[10px] uppercase" style={{ color: "var(--pos-muted)" }}>Contact email</span>
        <Input required type="email" value={form.contact_email} onChange={(e) => set("contact_email", e.target.value)} className={fld} style={fldStyle} /></label>
      <div className="grid grid-cols-2 gap-2.5">
        <label><span className="text-[10px] uppercase" style={{ color: "var(--pos-muted)" }}>Address</span>
          <Input required value={form.store.address} onChange={(e) => setStore("address", e.target.value)} className={fld} style={fldStyle} /></label>
        <label><span className="text-[10px] uppercase" style={{ color: "var(--pos-muted)" }}>Phone</span>
          <Input required value={form.store.phone} onChange={(e) => setStore("phone", e.target.value)} className={fld} style={fldStyle} /></label>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <label><span className="text-[10px] uppercase" style={{ color: "var(--pos-muted)" }}>Manager name</span>
          <Input required value={form.manager_name} onChange={(e) => set("manager_name", e.target.value)} className={fld} style={fldStyle} /></label>
        <label><span className="text-[10px] uppercase" style={{ color: "var(--pos-muted)" }}>Manager PIN</span>
          <Input required inputMode="numeric" maxLength={6} value={form.manager_pin} onChange={(e) => set("manager_pin", e.target.value.replace(/\D/g, "").slice(0, 6))} className={fld} style={fldStyle} /></label>
      </div>
      <div className="flex items-center justify-between rounded-lg p-2.5 mt-1" style={{ background: "var(--pos-panel-2)" }}>
        <span className="text-xs text-white">Apply brand defaults on creation</span>
        <Switch checked={form.apply_brand_defaults} onCheckedChange={(v) => set("apply_brand_defaults", v)} />
      </div>
      <button type="submit" disabled={busy} className="pos-btn w-full h-10 rounded-lg font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40 mt-2"
        style={{ background: "var(--pos-accent)" }}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create store
      </button>
    </form>
  );
}

// ===================================================================
// Menu template push + brand-wide defaults
// ===================================================================
function MenuDefaultsTab({ brand, onBrandChanged }) {
  const [defaults, setDefaults] = useState({
    features: brand.defaults?.features || {},
    store_footer: brand.defaults?.store_footer || "",
    logo_url: brand.defaults?.logo_url || "",
  });
  const [saving, setSaving] = useState(false);
  const [pushingMenu, setPushingMenu] = useState(false);
  const [pushingDefaults, setPushingDefaults] = useState(false);

  const toggleFeature = (key, v) => setDefaults((d) => ({ ...d, features: { ...d.features, [key]: v } }));

  const saveDefaults = async () => {
    setSaving(true);
    try {
      const r = await brandApi.update(brand.id, { defaults });
      onBrandChanged(r);
      toast.success("Defaults saved");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not save");
    } finally { setSaving(false); }
  };

  const pushMenu = async () => {
    if (!window.confirm("Push this store's current menu to every other store in the brand? New items/categories are added and matching ones (by name) are updated to match — each store's own sold-out status is left alone.")) return;
    setPushingMenu(true);
    try {
      const r = await brandApi.pushMenuTemplate(brand.id);
      const added = r.results.reduce((n, s) => n + s.items_added + s.categories_added, 0);
      const updated = r.results.reduce((n, s) => n + s.items_updated + s.categories_updated, 0);
      toast.success(`Pushed to ${r.pushed_to} store(s) — ${added} added, ${updated} updated`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Push failed");
    } finally { setPushingMenu(false); }
  };

  const pushDefaults = async () => {
    if (!window.confirm("Apply these saved defaults to every store in the brand right now?")) return;
    setPushingDefaults(true);
    try {
      const r = await brandApi.pushDefaults(brand.id);
      toast.success(`Applied to ${r.applied_to} store(s)`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Push failed");
    } finally { setPushingDefaults(false); }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <Card testid="brand-menu-push-card">
        <div className="text-sm font-bold text-white mb-1">Shared menu template</div>
        <p className="text-xs mb-3" style={{ color: "var(--pos-muted)" }}>
          Pushes categories and items from your currently-active store into every other store in the brand.
          New ones are added, and existing ones (matched by name) are updated to match — so price/description/image
          edits made here propagate on the next push. Each store's own sold-out status is left alone.
        </p>
        <button data-testid="brand-push-menu-btn" onClick={pushMenu} disabled={pushingMenu}
          className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white flex items-center gap-2 disabled:opacity-40"
          style={{ background: "var(--pos-accent)" }}>
          {pushingMenu ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />} Push menu to all stores
        </button>
      </Card>

      <Card testid="brand-defaults-card">
        <div className="text-sm font-bold text-white mb-1">Brand-wide defaults</div>
        <p className="text-xs mb-3" style={{ color: "var(--pos-muted)" }}>
          Saved here, applied to every store only when you push — a store keeps whatever it has until then.
        </p>
        <label className="block mb-2">
          <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Receipt footer</span>
          <Input value={defaults.store_footer} onChange={(e) => setDefaults((d) => ({ ...d, store_footer: e.target.value }))}
            className="h-9 text-white text-sm mt-1" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
        </label>
        <label className="block mb-3">
          <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Logo URL</span>
          <Input value={defaults.logo_url} onChange={(e) => setDefaults((d) => ({ ...d, logo_url: e.target.value }))}
            className="h-9 text-white text-sm mt-1" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
        </label>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {FEATURE_ROWS.map(([key, label]) => (
            <div key={key} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--pos-panel-2)" }}>
              <span className="text-xs text-white">{label}</span>
              <Switch checked={!!defaults.features?.[key]} onCheckedChange={(v) => toggleFeature(key, v)} />
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button data-testid="brand-save-defaults-btn" onClick={saveDefaults} disabled={saving}
            className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white disabled:opacity-40"
            style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
            {saving ? "Saving…" : "Save defaults"}
          </button>
          <button data-testid="brand-push-defaults-btn" onClick={pushDefaults} disabled={pushingDefaults}
            className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white flex items-center gap-2 disabled:opacity-40"
            style={{ background: "var(--pos-accent)" }}>
            {pushingDefaults ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />} Push to all stores now
          </button>
        </div>
      </Card>
    </div>
  );
}

// ===================================================================
// Royalties
// ===================================================================
const INVOICE_STATUS_COLOR = { pending: "#fcd34d", paid: "#7ee2a8", void: "var(--pos-muted)" };

function RoyaltiesTab({ brand }) {
  const [rows, setRows] = useState([]);
  const [totalOwed, setTotalOwed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState([]);
  const [range, setRange] = useState(() => {
    const end = new Date();
    const start = new Date(end); start.setDate(start.getDate() - 30);
    return { start: isoDate(start), end: isoDate(end) };
  });
  const [generating, setGenerating] = useState(false);

  const loadReport = () => {
    setLoading(true);
    brandApi.royalties(brand.id).then((d) => { setRows(d.rows); setTotalOwed(d.total_owed); }).catch(() => {}).finally(() => setLoading(false));
  };
  const loadInvoices = () => brandApi.listInvoices(brand.id).then(setInvoices).catch(() => {});
  useEffect(() => { loadReport(); loadInvoices(); }, [brand.id]); // eslint-disable-line

  const generateInvoices = async () => {
    if (!window.confirm(`Generate royalty invoices for ${range.start} to ${range.end}? One per store with a non-zero amount owed.`)) return;
    setGenerating(true);
    try {
      const end = new Date(`${range.end}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 1);
      const created = await brandApi.generateInvoices(brand.id, { start: `${range.start}T00:00:00Z`, end: end.toISOString() });
      toast.success(`Generated ${created.length} invoice(s)`);
      loadInvoices();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not generate invoices");
    } finally { setGenerating(false); }
  };

  const setInvoiceStatus = async (invoiceId, status) => {
    try {
      await brandApi.updateInvoiceStatus(brand.id, invoiceId, status);
      loadInvoices();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not update invoice");
    }
  };

  const downloadInvoice = async (invoiceId) => {
    try {
      await brandApi.downloadInvoicePdf(brand.id, invoiceId);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not download invoice");
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <Card>
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Total royalty owed (last 30 days)</div>
          <IndianRupee className="w-4 h-4" style={{ color: "var(--pos-accent)" }} />
        </div>
        <div className="text-3xl font-bold tabular-nums mt-1" style={{ color: "var(--pos-accent)" }}>₹{totalOwed.toFixed(2)}</div>
      </Card>
      <Card testid="brand-royalties-table">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--pos-border)" }}>
              <th className="text-left py-2 text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Store</th>
              <th className="text-right py-2 text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Sales</th>
              <th className="text-right py-2 text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Rate</th>
              <th className="text-right py-2 text-xs uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Owed</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="text-center py-6" style={{ color: "var(--pos-muted)" }}>Loading…</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.tenant_id} data-testid={`royalty-row-${r.tenant_id}`} style={{ borderTop: "1px solid var(--pos-border)" }}>
                <td className="py-2 text-white">{r.store_name}</td>
                <td className="py-2 text-right tabular-nums text-white">₹{r.sales.toFixed(2)}</td>
                <td className="py-2 text-right tabular-nums" style={{ color: "var(--pos-muted)" }}>{r.royalty_percent}%</td>
                <td className="py-2 text-right tabular-nums font-bold" style={{ color: "var(--pos-accent)" }}>₹{r.owed.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card testid="brand-invoices-card">
        <div className="text-sm font-bold text-white mb-1 flex items-center gap-2"><FileText className="w-4 h-4" style={{ color: "var(--pos-accent)" }} /> Royalty invoices</div>
        <p className="text-xs mb-3" style={{ color: "var(--pos-muted)" }}>Generate a tracked invoice per store for a period, then mark it paid as royalties come in.</p>
        <div className="flex items-end gap-2 mb-3 flex-wrap">
          <label><span className="text-[10px] uppercase" style={{ color: "var(--pos-muted)" }}>From</span>
            <Input type="date" value={range.start} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
              className="h-9 text-white text-sm mt-1" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} /></label>
          <label><span className="text-[10px] uppercase" style={{ color: "var(--pos-muted)" }}>To</span>
            <Input type="date" value={range.end} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
              className="h-9 text-white text-sm mt-1" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} /></label>
          <button data-testid="brand-generate-invoices-btn" onClick={generateInvoices} disabled={generating}
            className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white flex items-center gap-2 disabled:opacity-40"
            style={{ background: "var(--pos-accent)" }}>
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Generate invoices
          </button>
        </div>
        <div className="space-y-1.5">
          {invoices.map((inv) => (
            <div key={inv.id} data-testid={`brand-invoice-${inv.id}`} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2" style={{ background: "var(--pos-panel-2)" }}>
              <div className="text-xs min-w-0">
                <div className="text-white font-bold truncate">{inv.store_name}</div>
                <div style={{ color: "var(--pos-muted)" }}>{inv.period_start.slice(0, 10)} → {inv.period_end.slice(0, 10)} · ₹{inv.sales.toFixed(2)} × {inv.royalty_percent}%</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm font-bold tabular-nums" style={{ color: "var(--pos-accent)" }}>₹{inv.amount.toFixed(2)}</span>
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ color: INVOICE_STATUS_COLOR[inv.status], border: `1px solid ${INVOICE_STATUS_COLOR[inv.status]}` }}>{inv.status}</span>
                <button data-testid={`brand-invoice-download-${inv.id}`} onClick={() => downloadInvoice(inv.id)}
                  className="pos-btn h-7 w-7 rounded-md flex items-center justify-center" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }} title="Download PDF">
                  <Download className="w-3.5 h-3.5 text-white" />
                </button>
                {inv.status === "pending" && (
                  <button data-testid={`brand-invoice-mark-paid-${inv.id}`} onClick={() => setInvoiceStatus(inv.id, "paid")}
                    className="pos-btn h-7 px-2 rounded-md text-[11px] font-bold text-white" style={{ background: "var(--pos-accent)" }}>Mark paid</button>
                )}
              </div>
            </div>
          ))}
          {invoices.length === 0 && <div className="text-xs text-center py-4" style={{ color: "var(--pos-muted)" }}>No invoices generated yet.</div>}
        </div>
      </Card>
    </div>
  );
}

// ===================================================================
// Marketing — shared asset library + coordinated SMS campaign
// ===================================================================
function MarketingTab({ brand }) {
  const [assets, setAssets] = useState([]);
  const [form, setForm] = useState({ kind: "text", title: "", content: "" });
  const [smsBody, setSmsBody] = useState("");
  const [sending, setSending] = useState(false);

  const load = () => brandApi.listAssets(brand.id).then(setAssets).catch(() => {});
  useEffect(() => { load(); }, [brand.id]); // eslint-disable-line

  const addAsset = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim()) return;
    try {
      await brandApi.createAsset(brand.id, form);
      setForm({ kind: "text", title: "", content: "" });
      load();
      toast.success("Asset added");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not add asset");
    }
  };

  const removeAsset = async (id) => {
    await brandApi.deleteAsset(brand.id, id);
    load();
  };

  const sendCampaign = async () => {
    if (!smsBody.trim()) return;
    if (!window.confirm("Send this SMS to every customer across every store in the brand?")) return;
    setSending(true);
    try {
      const r = await brandApi.smsBroadcast(brand.id, { body: smsBody });
      toast.success(`Sent ${r.total_sent}, failed ${r.total_failed}`);
      setSmsBody("");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Broadcast failed");
    } finally { setSending(false); }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <Card testid="brand-assets-card">
        <div className="text-sm font-bold text-white mb-1 flex items-center gap-2"><ImageIcon className="w-4 h-4" style={{ color: "var(--pos-accent)" }} /> Shared asset library</div>
        <p className="text-xs mb-3" style={{ color: "var(--pos-muted)" }}>Logos, promo images, and ad copy any store's staff can reuse.</p>
        <form onSubmit={addAsset} className="flex gap-2 mb-3 flex-wrap">
          <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
            className="h-9 rounded-md px-2 text-xs text-white" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
            <option value="text">Text</option>
            <option value="image">Image URL</option>
          </select>
          <Input placeholder="Title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="h-9 text-white text-sm flex-1 min-w-[120px]" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
          <Input placeholder={form.kind === "image" ? "https://…" : "Promo copy"} value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            className="h-9 text-white text-sm flex-[2] min-w-[160px]" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
          <button type="submit" className="pos-btn h-9 px-3 rounded-md text-xs font-bold text-white" style={{ background: "var(--pos-accent)" }}>Add</button>
        </form>
        <div className="space-y-2">
          {assets.map((a) => (
            <div key={a.id} data-testid={`brand-asset-${a.id}`} className="flex items-center justify-between gap-2 rounded-lg p-2.5" style={{ background: "var(--pos-panel-2)" }}>
              <div className="min-w-0">
                <div className="text-xs font-bold text-white">{a.title} <span style={{ color: "var(--pos-muted)" }}>· {a.kind}</span></div>
                <div className="text-xs truncate" style={{ color: "var(--pos-muted)" }}>{a.content}</div>
              </div>
              <button onClick={() => removeAsset(a.id)} className="pos-btn p-1.5 rounded-md shrink-0" style={{ color: "#f87171" }}><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          {assets.length === 0 && <div className="text-xs text-center py-4" style={{ color: "var(--pos-muted)" }}>No assets yet.</div>}
        </div>
      </Card>

      <Card testid="brand-sms-card">
        <div className="text-sm font-bold text-white mb-1 flex items-center gap-2"><MessageSquare className="w-4 h-4" style={{ color: "var(--pos-accent)" }} /> Coordinated SMS campaign</div>
        <p className="text-xs mb-3" style={{ color: "var(--pos-muted)" }}>
          Sends to every customer with a phone number across every store in the brand (capped at 200/store). Use <code>{"{name}"}</code> to personalise.
        </p>
        <Textarea value={smsBody} onChange={(e) => setSmsBody(e.target.value)} rows={3} placeholder="Hi {name}, this weekend only…"
          className="text-white text-sm mb-3" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
        <button data-testid="brand-send-campaign-btn" onClick={sendCampaign} disabled={sending}
          className="pos-btn h-9 px-4 rounded-md text-xs font-bold text-white flex items-center gap-2 disabled:opacity-40"
          style={{ background: "var(--pos-accent)" }}>
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send to all stores
        </button>
      </Card>
    </div>
  );
}
