import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { loyaltyApi } from "../../api/client";
import { Gift, Coins, Users, TrendingUp, TrendingDown, Save, RefreshCw, Award, Cake, Send } from "lucide-react";

/**
 * Restaurant Dashboard → Loyalty program.
 *
 * Owner/manager view for the points program. Two panels:
 *   1. Overview — enrollment, outstanding points liability, tier mix, recent activity.
 *   2. Settings — earn rate, redemption value, tier thresholds, welcome bonus.
 * Every rate here is per-tenant; the POS checkout and daily earn/redeem logic
 * read these same values live, so a save here changes behavior immediately.
 */
export default function DashLoyalty() {
  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState("");

  const [txns, setTxns] = useState([]);

  const [cfg, setCfg] = useState(null);
  const [cfgLoading, setCfgLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [requestingBirthdays, setRequestingBirthdays] = useState(false);

  const loadOverview = async () => {
    setOverviewLoading(true);
    setOverviewError("");
    try {
      const [o, t] = await Promise.all([loyaltyApi.overview(), loyaltyApi.txns(20)]);
      setOverview(o);
      setTxns(t);
    } catch (e) {
      setOverviewError(e?.response?.data?.detail || e?.message || "Failed to load loyalty overview");
    } finally {
      setOverviewLoading(false);
    }
  };

  const loadConfig = async () => {
    setCfgLoading(true);
    try {
      setCfg(await loyaltyApi.getConfig());
    } catch (e) {
      toast.error("Failed to load loyalty settings");
    } finally {
      setCfgLoading(false);
    }
  };

  useEffect(() => { loadOverview(); loadConfig(); }, []);

  const save = async () => {
    if (!cfg) return;
    if (Number(cfg.gold_threshold) < Number(cfg.silver_threshold)) {
      toast.error("Gold threshold must be at or above the Silver threshold");
      return;
    }
    if (Number(cfg.silver_multiplier) < 1 || Number(cfg.gold_multiplier) < 1) {
      toast.error("Earn multipliers must be at least 1");
      return;
    }
    setSaving(true);
    try {
      const saved = await loyaltyApi.saveConfig({
        earn_rate: Number(cfg.earn_rate) || 100,
        redeem_value: Number(cfg.redeem_value) || 1,
        silver_threshold: Number(cfg.silver_threshold) || 0,
        gold_threshold: Number(cfg.gold_threshold) || 0,
        welcome_bonus_points: Math.max(0, Math.round(Number(cfg.welcome_bonus_points) || 0)),
        silver_multiplier: Math.max(1, Number(cfg.silver_multiplier) || 1),
        gold_multiplier: Math.max(1, Number(cfg.gold_multiplier) || 1),
        birthday_bonus_points: Math.max(0, Math.round(Number(cfg.birthday_bonus_points) || 0)),
      });
      setCfg(saved);
      toast.success("Loyalty settings saved");
      loadOverview();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const sendBirthdayRequest = async () => {
    setRequestingBirthdays(true);
    try {
      const r = await loyaltyApi.requestBirthdays();
      if (r.requested === 0) toast.info("No customers are missing a birthday");
      else toast.success(`Texted ${r.sent} customer${r.sent === 1 ? "" : "s"}${r.failed ? ` (${r.failed} failed)` : ""}`);
      loadOverview();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not send requests");
    } finally {
      setRequestingBirthdays(false);
    }
  };

  return (
    <div className="p-6 space-y-6" data-testid="dash-loyalty">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: "var(--pos-text)" }}>
            <Gift className="w-6 h-6" style={{ color: "#d97706" }} />
            Loyalty program
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>
            Points earned and redeemed at checkout — every rate below is yours to set.
          </p>
        </div>
        <button data-testid="loyalty-refresh" onClick={loadOverview} disabled={overviewLoading}
          className="pos-btn px-3 py-2 rounded-lg text-xs flex items-center gap-1.5"
          style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
          <RefreshCw className={`w-3.5 h-3.5 ${overviewLoading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Overview */}
        <div className="lg:col-span-2 rounded-xl overflow-hidden" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--pos-border)" }}>
            <div className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>Overview</div>
          </div>
          <div className="p-5">
            {overviewLoading && <div className="text-sm" style={{ color: "var(--pos-muted)" }}>Loading…</div>}
            {overviewError && !overviewLoading && (
              <div className="text-sm p-3 rounded space-y-2" style={{ background: "rgba(220,38,38,0.15)", color: "#dc2626" }}>
                <div>{overviewError}</div>
                <button onClick={loadOverview} className="text-xs font-bold underline">Retry</button>
              </div>
            )}
            {overview && !overviewLoading && (
              <div className="space-y-5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <MetricCard icon={Users} label="Enrolled customers" value={overview.enrolled_customers} />
                  <MetricCard icon={Coins} label="Outstanding points" value={overview.outstanding_points} sub={`≈ ₹${overview.outstanding_value.toFixed(0)} liability`} />
                  <MetricCard icon={TrendingUp} label="Earned (30d)" value={`+${overview.earned_last_30d}`} accent="#16a34a" />
                  <MetricCard icon={TrendingDown} label="Redeemed (30d)" value={`-${overview.redeemed_last_30d}`} accent="#dc2626" />
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--pos-muted)" }}>Tier mix</div>
                  <div className="flex gap-2 flex-wrap">
                    <TierChip label="Bronze" count={overview.tiers.bronze} color="#92400e" />
                    <TierChip label="Silver" count={overview.tiers.silver} color="#64748b" />
                    <TierChip label="Gold" count={overview.tiers.gold} color="#ca8a04" />
                  </div>
                </div>

                {overview.birthdays_missing > 0 && (
                  <div className="rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap"
                    style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} data-testid="loyalty-birthdays-missing">
                    <div className="flex items-center gap-2 text-xs" style={{ color: "var(--pos-muted)" }}>
                      <Cake className="w-4 h-4 shrink-0" style={{ color: "#e11d48" }} />
                      {overview.birthdays_missing} customer{overview.birthdays_missing === 1 ? "" : "s"} haven't shared their birthday
                    </div>
                    <button data-testid="loyalty-send-birthday-request" onClick={sendBirthdayRequest} disabled={requestingBirthdays}
                      className="pos-btn h-8 px-3 rounded-md text-xs font-bold text-white flex items-center gap-1.5"
                      style={{ background: "var(--pos-accent)" }}>
                      <Send className="w-3 h-3" /> {requestingBirthdays ? "Sending…" : "Text a request"}
                    </button>
                  </div>
                )}

                <div>
                  <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--pos-muted)" }}>Recent activity</div>
                  <div className="space-y-1" data-testid="loyalty-recent-activity">
                    {txns.length === 0 && <div className="text-xs" style={{ color: "var(--pos-muted)" }}>No loyalty activity yet.</div>}
                    {txns.map((t) => (
                      <div key={t.id} className="flex items-center justify-between text-xs px-2 py-1.5 rounded"
                        style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                        <div className="min-w-0">
                          <span style={{ color: "var(--pos-text)" }}>{t.customer_name}</span>
                          <span className="ml-2 capitalize" style={{ color: "var(--pos-muted)" }}>{t.kind}</span>
                          {t.note && <span className="ml-1" style={{ color: "var(--pos-muted)" }}>· {t.note}</span>}
                        </div>
                        <span className="tabular-nums shrink-0 ml-2" style={{ color: t.points >= 0 ? "#16a34a" : "#dc2626" }}>
                          {t.points >= 0 ? "+" : ""}{t.points}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Settings */}
        <div className="rounded-xl overflow-hidden h-fit" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--pos-border)" }}>
            <div className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>Program rules</div>
          </div>
          <div className="p-5 space-y-4">
            {cfgLoading || !cfg ? (
              <div className="text-sm" style={{ color: "var(--pos-muted)" }}>Loading…</div>
            ) : (
              <>
                <NumField testid="loyalty-earn-rate" label="Earn rate" suffix="₹ spent per 1 point"
                  value={cfg.earn_rate} min={1} step={1}
                  onChange={(v) => setCfg({ ...cfg, earn_rate: v })} />

                <NumField testid="loyalty-redeem-value" label="Redeem value" suffix="₹ off per point"
                  value={cfg.redeem_value} min={0.1} step={0.1}
                  onChange={(v) => setCfg({ ...cfg, redeem_value: v })} />

                <NumField testid="loyalty-silver-threshold" label="Silver tier at" suffix="₹ lifetime spend"
                  value={cfg.silver_threshold} min={0} step={100}
                  onChange={(v) => setCfg({ ...cfg, silver_threshold: v })} />

                <NumField testid="loyalty-gold-threshold" label="Gold tier at" suffix="₹ lifetime spend"
                  value={cfg.gold_threshold} min={0} step={100}
                  onChange={(v) => setCfg({ ...cfg, gold_threshold: v })} />

                <NumField testid="loyalty-silver-multiplier" label="Silver earn multiplier" suffix="× points"
                  value={cfg.silver_multiplier} min={1} step={0.1}
                  onChange={(v) => setCfg({ ...cfg, silver_multiplier: v })} />

                <NumField testid="loyalty-gold-multiplier" label="Gold earn multiplier" suffix="× points"
                  value={cfg.gold_multiplier} min={1} step={0.1}
                  onChange={(v) => setCfg({ ...cfg, gold_multiplier: v })} />

                <NumField testid="loyalty-welcome-bonus" label="Welcome bonus" suffix="points on signup"
                  value={cfg.welcome_bonus_points} min={0} step={10}
                  onChange={(v) => setCfg({ ...cfg, welcome_bonus_points: v })} />

                <NumField testid="loyalty-birthday-bonus" label="Birthday bonus" suffix="points, once a year"
                  value={cfg.birthday_bonus_points} min={0} step={10}
                  onChange={(v) => setCfg({ ...cfg, birthday_bonus_points: v })} />

                <div className="rounded-lg p-3 text-[11px] leading-relaxed flex items-start gap-2"
                  style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>
                  <Award className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#d97706" }} />
                  <span>
                    A ₹{Number(cfg.earn_rate) * 5 || 500} order earns <b style={{ color: "var(--pos-text)" }}>5 points</b> at Bronze,{" "}
                    <b style={{ color: "var(--pos-text)" }}>{Math.floor(5 * Math.max(1, Number(cfg.silver_multiplier) || 1))} at Silver</b>, or{" "}
                    <b style={{ color: "var(--pos-text)" }}>{Math.floor(5 * Math.max(1, Number(cfg.gold_multiplier) || 1))} at Gold</b> — worth{" "}
                    <b style={{ color: "var(--pos-text)" }}>₹{(5 * (Number(cfg.redeem_value) || 1)).toFixed(0)}</b>+ off a future order.
                    New customers start with <b style={{ color: "var(--pos-text)" }}>{cfg.welcome_bonus_points || 0} pts</b>, and everyone
                    gets <b style={{ color: "var(--pos-text)" }}>{cfg.birthday_bonus_points || 0} pts</b> on their birthday.
                  </span>
                </div>

                <button data-testid="loyalty-save" onClick={save} disabled={saving}
                  className="pos-btn w-full mt-1 px-3 py-2 rounded-lg text-xs text-white flex items-center justify-center gap-1.5"
                  style={{ background: "var(--pos-accent)" }}>
                  <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save settings"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, sub, accent }) {
  return (
    <div className="rounded-lg p-3" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className="text-xl font-bold mt-1" style={{ color: accent || "var(--pos-text)" }}>{value}</div>
      {sub && <div className="text-[10px] mt-1" style={{ color: "var(--pos-muted)" }}>{sub}</div>}
    </div>
  );
}

function TierChip({ label, count, color }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-semibold"
      style={{ background: `${color}22`, color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} /> {label} · {count}
    </span>
  );
}

function NumField({ label, suffix, value, min, step, onChange, testid }) {
  const below = min !== undefined && value !== "" && Number(value) < min;
  return (
    <div>
      <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>{label}</label>
      <div className="flex items-center gap-2 mt-1.5">
        <input data-testid={testid} type="number" min={min} step={step} value={value}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          className="w-24 rounded px-2 py-1.5 text-sm outline-none"
          aria-invalid={below || undefined}
          style={{ background: "var(--pos-panel-2)", border: `1px solid ${below ? "#dc2626" : "var(--pos-border)"}`, color: "var(--pos-text)" }} />
        <span className="text-[11px]" style={{ color: below ? "#dc2626" : "var(--pos-muted)" }}>{below ? `Minimum ${min}` : suffix}</span>
      </div>
    </div>
  );
}
