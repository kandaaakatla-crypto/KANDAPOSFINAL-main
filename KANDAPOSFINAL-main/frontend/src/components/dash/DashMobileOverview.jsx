import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useDash, canManageSettings } from "../../store/DashContext";
import { teamApi } from "../../api/client";
import { shareReport } from "../../lib/shareReport";
import { ShoppingBag, Receipt, Truck, BookOpen, Boxes, Users, BarChart3, AlertTriangle, ChevronRight, ChevronDown, Store, Undo2, Banknote, CreditCard, Clock3, TrendingUp, TrendingDown, Target, Share2 } from "lucide-react";

// Phone-first overview, shaped after what owner apps (Toast Now, Petpooja,
// Swiggy/Zomato partner apps) put on their first screen: today's money in
// one big number, the few counts an owner checks between services, what is
// selling, and one-tap jumps to the things they change from a phone (stock
// and menu). Everything comes from the /reports/summary payload DashHome
// already fetched — no extra requests.

const inr = (n) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// 7-day sparkline from summary.weeklySales (oldest → today). Plain SVG so
// it costs nothing next to the recharts charts further down the page.
function Sparkline({ points }) {
  const w = 300, h = 64, pad = 4;
  const max = Math.max(1, ...points.map((p) => p.sales || 0));
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const xy = points.map((p, i) => [pad + i * step, h - pad - ((p.sales || 0) / max) * (h - pad * 2)]);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${xy[xy.length - 1][0].toFixed(1)},${h} L${xy[0][0].toFixed(1)},${h} Z`;
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="lg-spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f97316" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#lg-spark)" />
      <path d={line} fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="4" fill="#f97316" stroke="#fff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>
        <Icon className="w-3 h-3 shrink-0" /> <span className="truncate">{label}</span>
      </div>
      <div className="text-base font-bold tabular-nums truncate" style={{ color: "var(--pos-text)" }}>{value}</div>
    </div>
  );
}

function PaymentMix({ summary }) {
  const parts = [
    { key: "cash", label: "Cash", icon: Banknote, value: summary.cashTotal || 0, color: "#22c55e" },
    { key: "card", label: "Card", icon: CreditCard, value: summary.cardTotal || 0, color: "#3b82f6" },
    { key: "unpaid", label: "Unpaid", icon: Clock3, value: summary.unpaidTotal || 0, color: "#f59e0b" },
  ];
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div className="lg-card rounded-3xl p-4" data-testid="m-payment-mix">
      <div className="text-sm font-bold mb-3" style={{ color: "var(--pos-text)" }}>How you were paid today</div>
      <div className="flex h-2.5 rounded-full overflow-hidden mb-3" style={{ background: "var(--pos-panel-2)" }}>
        {total > 0 && parts.map((p) => p.value > 0 && (
          <div key={p.key} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {parts.map(({ key, label, icon: Icon, value, color }) => (
          <div key={key} className="min-w-0">
            <div className="flex items-center gap-1 text-[11px]" style={{ color: "var(--pos-muted)" }}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
              <Icon className="w-3 h-3 shrink-0" /> <span className="truncate">{label}</span>
            </div>
            <div className="text-sm font-bold tabular-nums truncate" style={{ color: "var(--pos-text)" }}>{inr(value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TopSellers({ items }) {
  if (!items?.length) return null;
  const max = Math.max(1, ...items.map((i) => i.sold));
  return (
    <div className="lg-card rounded-3xl p-4" data-testid="m-top-sellers">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>Best sellers</div>
        <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>Last 7 days</div>
      </div>
      <div className="space-y-2.5">
        {items.map((it, idx) => (
          <div key={it.name} className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
              style={{ background: idx === 0 ? "var(--pos-accent)" : "var(--pos-panel-2)", color: idx === 0 ? "#fff" : "var(--pos-muted)" }}>
              {idx + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm truncate" style={{ color: "var(--pos-text)" }}>{it.name}</span>
                <span className="text-xs tabular-nums shrink-0" style={{ color: "var(--pos-muted)" }}>{it.sold} sold</span>
              </div>
              <div className="h-1 mt-1 rounded-full overflow-hidden" style={{ background: "var(--pos-panel-2)" }}>
                <div className="h-full rounded-full" style={{ width: `${(it.sold / max) * 100}%`, background: "var(--pos-accent)", opacity: 0.75 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Which store Home is showing, switchable in place. Multi-store owners and
// area managers check one store after another from their phone, so the
// switch lives on Home instead of behind More. A native <select> gives the
// platform picker (the iOS wheel, the Android dialog). Single-store users
// just see the store's name.
function StorePicker() {
  const { user, switchStore } = useDash();
  const [stores, setStores] = useState([]);
  const [busy, setBusy] = useState(false);
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    teamApi.myStores().then((list) => setStores(list || [])).catch(() => {});
  }, [userId]);

  const current = stores.find((s) => s.id === user.tenant_id);
  if (!current) return null;
  const multi = stores.length > 1;

  const onChange = async (e) => {
    const id = e.target.value;
    if (id === user.tenant_id || busy) return;
    setBusy(true);
    try { await switchStore(id); } catch { setBusy(false); } // reloads on success
  };

  return (
    <label className={`lg-card relative inline-flex items-center gap-1.5 h-8 pl-3 ${multi ? "pr-2 lg-press" : "pr-3"} rounded-full text-xs font-semibold max-w-full`}
      style={{ color: "var(--pos-text)" }} data-testid="m-store-picker">
      <Store className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--pos-accent)" }} />
      <span className="truncate">{busy ? "Switching…" : current.name}</span>
      {multi && <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--pos-muted)" }} />}
      {multi && (
        <select aria-label="Switch store" value={user.tenant_id} onChange={onChange} disabled={busy}
          data-testid="m-store-select" className="absolute inset-0 opacity-0 w-full cursor-pointer">
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
    </label>
  );
}

// Today's refunds + voids as one line under the hero, linking to the full
// list. Its own small request so Home's main summary isn't held up by it.
function RefundsPeek({ refreshTick }) {
  const { api } = useDash();
  const [today, setToday] = useState(null);
  useEffect(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    api.get("/refunds/log", { params: { limit: 100 } })
      .then((r) => {
        const rows = (r.data || []).filter((l) => new Date(l.at) >= start);
        setToday({ count: rows.length, amount: rows.reduce((s, l) => s + (l.amount || 0), 0) });
      })
      .catch(() => {});
  }, [api, refreshTick]);
  if (!today) return null;
  return (
    <Link to="/dashboard/refunds" data-testid="m-refunds-peek" className="lg-card lg-press rounded-2xl px-4 py-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(220,38,38,0.10)" }}>
        <Undo2 className="w-4 h-4" style={{ color: "#dc2626" }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>
          {today.count ? `${inr(today.amount)} refunded or voided` : "No refunds or voids today"}
        </div>
        <div className="text-xs" style={{ color: "var(--pos-muted)" }}>
          {today.count ? `${today.count} ${today.count === 1 ? "order" : "orders"} today · see who and why` : "Refunds, voids and discounts"}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 shrink-0" style={{ color: "var(--pos-muted)" }} />
    </Link>
  );
}

// Today so far against last week's same weekday up to this clock time
// (server: reports.report_summary), so a quiet morning isn't read against a
// whole day. Older servers don't send the field; the line just stays hidden.
function LastWeekPace({ summary }) {
  if (!summary || summary.sameTimeLastWeek == null) return null;
  const now = summary.todaySales || 0;
  const then = summary.sameTimeLastWeek || 0;
  if (!now && !then) return null;
  const pct = then ? Math.round(((now - then) / then) * 100) : null;
  const up = now >= then;
  const color = up ? "#16a34a" : "#dc2626";
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <div className="flex items-center gap-1.5 mt-2 text-xs font-semibold" data-testid="m-last-week" style={{ color }}>
      <Icon className="w-3.5 h-3.5" />
      {pct == null ? (
        <span className="font-normal" style={{ color: "var(--pos-muted)" }}>No sales by now last week</span>
      ) : (
        <>
          <span>{`${up ? "+" : ""}${pct}%`}</span>
          <span className="font-normal" style={{ color: "var(--pos-muted)" }}>vs {inr(then)} by now last week</span>
        </>
      )}
    </div>
  );
}

// Owner-set "good day" number (routes/sales_target.py) with today's progress.
// Anyone who can see sales sees the bar; only settings holders can change it.
function SalesTargetBar({ summary }) {
  const { api, user } = useDash();
  const [target, setTarget] = useState(summary?.dailyTarget ?? null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const canEdit = canManageSettings(user);

  useEffect(() => { setTarget(summary?.dailyTarget ?? null); }, [summary?.dailyTarget]);

  if (!summary || (!target && !canEdit)) return null;

  const save = async (value) => {
    setBusy(true);
    try {
      const r = await api.put("/tenant/sales-target", { target: value });
      setTarget(r.data.target);
      setEditing(false);
      toast.success(r.data.target ? `Daily target set to ${inr(r.data.target)}` : "Daily target removed");
    } catch (e) {
      toast.error(typeof e?.response?.data?.detail === "string" ? e.response.data.detail : "Enter an amount above ₹0");
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <form className="flex items-center gap-2 mt-3" data-testid="m-target-form"
        onSubmit={(e) => { e.preventDefault(); const n = Number(draft); if (n > 0) save(n); else toast.error("Enter an amount above ₹0"); }}>
        <span className="text-sm font-semibold" style={{ color: "var(--pos-muted)" }}>₹</span>
        <input type="number" inputMode="numeric" min="1" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder="Daily target" data-testid="m-target-input" aria-label="Daily sales target in rupees"
          className="flex-1 min-w-0 h-9 rounded-full px-3 text-sm" style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)" }} />
        <button type="submit" disabled={busy} className="lg-press h-9 px-3 rounded-full text-xs font-bold text-white" style={{ background: "var(--pos-accent)" }}>Save</button>
        {target ? (
          <button type="button" disabled={busy} onClick={() => save(null)} className="lg-press h-9 px-3 rounded-full text-xs font-semibold"
            style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>Remove</button>
        ) : (
          <button type="button" onClick={() => setEditing(false)} className="lg-press h-9 px-3 rounded-full text-xs font-semibold"
            style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>Cancel</button>
        )}
      </form>
    );
  }

  const open = () => { if (canEdit) { setDraft(target ? String(target) : ""); setEditing(true); } };

  if (!target) {
    return (
      <button type="button" onClick={open} data-testid="m-target-set"
        className="lg-press mt-3 flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--pos-accent)" }}>
        <Target className="w-3.5 h-3.5" /> Set a daily sales target
      </button>
    );
  }

  const pct = Math.round(((summary.todaySales || 0) / target) * 100);
  const hit = pct >= 100;
  return (
    <button type="button" onClick={open} disabled={!canEdit} data-testid="m-target" className="block w-full text-left mt-3">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-semibold" style={{ color: hit ? "#16a34a" : "var(--pos-text)" }}>
          <Target className="w-3.5 h-3.5" /> {hit ? "Target hit" : `${pct}% of target`}
        </span>
        <span style={{ color: "var(--pos-muted)" }}>{inr(target)}{canEdit ? " · Edit" : ""}</span>
      </div>
      <div className="h-2 rounded-full mt-1.5 overflow-hidden" style={{ background: "var(--pos-panel-2)" }} role="progressbar"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(pct, 100)} aria-label="Progress to daily sales target">
        <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: hit ? "#16a34a" : "var(--pos-accent)" }} />
      </div>
    </button>
  );
}

// "Send today's numbers to my partner" — PDF + WhatsApp text (lib/shareReport).
function ShareReportButton() {
  const { api } = useDash();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);

  const run = async (days) => {
    setBusy(days);
    try {
      const how = await shareReport(api, days);
      setOpen(false);
      if (how === "fallback") toast.success("PDF downloaded. WhatsApp opened with the summary.");
    } catch (e) {
      toast.error("Could not prepare the report");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} data-testid="m-share" aria-expanded={open} aria-label="Share sales report"
        className="lg-press h-8 px-3 rounded-full text-xs font-semibold flex items-center gap-1.5" style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)" }}>
        <Share2 className="w-3.5 h-3.5" /> Share
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-10 lg-glass-strong rounded-2xl p-1.5 w-44 shadow-lg" data-testid="m-share-menu">
          {[[1, "Today"], [7, "Last 7 days"]].map(([d, label]) => (
            <button key={d} type="button" disabled={busy != null} onClick={() => run(d)} data-testid={`m-share-${d}`}
              className="lg-press w-full text-left px-3 h-9 rounded-xl text-sm" style={{ color: "var(--pos-text)" }}>
              {busy === d ? "Preparing…" : label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DashMobileOverview({ refreshTick, user, summary, showReports, lowStockCount, storeCount }) {
  const weekly = summary?.weeklySales || [];
  const yesterday = weekly.length >= 2 ? weekly[weekly.length - 2].sales : null;
  const weekTotal = weekly.reduce((s, d) => s + (d.sales || 0), 0);
  const today = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

  const actions = [
    { to: "/dashboard/stock", label: "Item stock", hint: "Mark items in or out", icon: BookOpen },
    { to: "/dashboard/inventory", label: "Inventory", hint: lowStockCount > 0 ? `${lowStockCount} running low` : "All stocked", icon: Boxes, alert: lowStockCount > 0 },
    { to: "/dashboard/on-shift", label: "On shift", hint: "Who's working now", icon: Users },
    showReports && { to: "/dashboard/reports", label: "Reports", hint: "Sales, items, hours", icon: BarChart3 },
  ].filter(Boolean);

  return (
    <div className="space-y-3" data-testid="dash-mobile-overview">
      <div className="px-1 pt-1">
        <div className="text-xs font-medium" style={{ color: "var(--pos-muted)" }}>{today} · {storeCount} {storeCount === 1 ? "store" : "stores"}</div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--pos-text)" }}>
          {greeting()}, {user.name.split(" ")[0]}
        </h1>
        <div className="mt-2"><StorePicker /></div>
      </div>

      {showReports && (
        <div className="lg-glass-strong lg-sheen rounded-[28px] p-5" data-testid="m-hero">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-[0.18em] font-semibold" style={{ color: "var(--pos-muted)" }}>Today's sales</div>
            <ShareReportButton />
          </div>
          <div className="text-[40px] leading-none font-bold tabular-nums mt-1.5" style={{ color: "var(--pos-text)" }} data-testid="m-today-sales">
            {summary ? inr(summary.todaySales) : "—"}
          </div>
          <LastWeekPace summary={summary} />
          <SalesTargetBar summary={summary} />
          <div className="text-xs mt-2" style={{ color: "var(--pos-muted)" }}>
            {yesterday != null ? <>Yesterday {inr(yesterday)} · 7 days {inr(weekTotal)}</> : "Loading…"}
          </div>
          {weekly.length > 1 && <div className="-mx-1 mt-3"><Sparkline points={weekly} /></div>}
          <div className="grid grid-cols-3 gap-3 mt-3 pt-3" style={{ borderTop: "1px solid var(--lg-edge-soft)" }}>
            <Stat icon={ShoppingBag} label="Orders" value={summary?.ordersToday ?? "—"} />
            <Stat icon={Receipt} label="Avg order" value={summary ? inr(summary.avgOrder) : "—"} />
            <Stat icon={Truck} label="Delivery" value={summary?.deliveriesToday ?? "—"} />
          </div>
        </div>
      )}

      {showReports && <RefundsPeek refreshTick={refreshTick} />}

      {lowStockCount > 0 && (
        <Link to="/dashboard/inventory" data-testid="m-low-stock-alert"
          className="lg-card lg-press rounded-2xl px-4 py-3 flex items-center gap-3" style={{ borderColor: "rgba(245,158,11,0.45)" }}>
          <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(245,158,11,0.16)" }}>
            <AlertTriangle className="w-4 h-4" style={{ color: "#d97706" }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>{lowStockCount} {lowStockCount === 1 ? "item is" : "items are"} running low</div>
            <div className="text-xs" style={{ color: "var(--pos-muted)" }}>Restock before the next rush</div>
          </div>
          <ChevronRight className="w-4 h-4 shrink-0" style={{ color: "var(--pos-muted)" }} />
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3" data-testid="m-quick-actions">
        {actions.map(({ to, label, hint, icon: Icon, alert }) => (
          <Link key={to} to={to} data-testid={`m-action-${label.split(" ")[0].toLowerCase()}`}
            className="lg-card lg-press rounded-3xl p-4 flex flex-col gap-3">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
              style={{ background: alert ? "rgba(245,158,11,0.16)" : "rgba(249,115,22,0.12)" }}>
              <Icon className="w-5 h-5" style={{ color: alert ? "#d97706" : "var(--pos-accent)" }} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold truncate" style={{ color: "var(--pos-text)" }}>{label}</div>
              <div className="text-[11px] truncate" style={{ color: alert ? "#d97706" : "var(--pos-muted)" }}>{hint}</div>
            </div>
          </Link>
        ))}
      </div>

      {showReports && summary && <PaymentMix summary={summary} />}
      {showReports && <TopSellers items={summary?.topItems} />}
    </div>
  );
}
