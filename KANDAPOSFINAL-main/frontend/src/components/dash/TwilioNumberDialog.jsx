import React, { useEffect, useState } from "react";
import { voiceApi } from "../../api/client";
import { toast } from "sonner";
import { ShoppingCart, Search, Loader2, CheckCircle2, PhoneCall, MessageSquare, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

const COUNTRIES = [
  { code: "US", label: "🇺🇸 United States  ·  $1.15/mo  ·  instant" },
  { code: "GB", label: "🇬🇧 United Kingdom  ·  $1.00/mo  ·  KYC bundle" },
  { code: "CA", label: "🇨🇦 Canada  ·  $1.00/mo  ·  instant" },
  { code: "AU", label: "🇦🇺 Australia  ·  $6.00/mo  ·  KYC bundle" },
  { code: "IN", label: "🇮🇳 India  ·  regulatory bundle required" },
  { code: "SG", label: "🇸🇬 Singapore  ·  KYC bundle" },
  { code: "AE", label: "🇦🇪 UAE  ·  KYC bundle" },
];

/**
 * Twilio number search + one-click purchase mini-flow.
 * Opened from the Voice Agent dashboard when the tenant wants a fresh number.
 */
export default function TwilioNumberDialog({ open, onClose, onPurchased }) {
  const [country, setCountry] = useState("US");
  const [areaCode, setAreaCode] = useState("");
  const [contains, setContains] = useState("");
  const [smsToo, setSmsToo] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [buyingNum, setBuyingNum] = useState("");

  const doSearch = async () => {
    setSearching(true);
    setResults([]);
    try {
      const r = await voiceApi.searchNumbers({
        country, area_code: areaCode || undefined,
        contains: contains || undefined,
        voice: true, sms: smsToo, limit: 20,
      });
      setResults(r.results || []);
      if ((r.results || []).length === 0) toast.info("No numbers match — try loosening filters");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Search failed");
    } finally { setSearching(false); }
  };

  const buy = async (num) => {
    if (!window.confirm(`Buy ${num.phone_number}?\n\nThis will charge your Twilio account (typically $1–$6/month + per-minute usage) and set this number as your restaurant's voice agent number.`)) return;
    setBuyingNum(num.phone_number);
    try {
      const r = await voiceApi.purchaseNumber({ phone_number: num.phone_number, set_as_tenant_default: true });
      toast.success(`✅ ${r.phone_number} purchased and set as your agent number.`);
      if (onPurchased) onPurchased(r.phone_number);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Purchase failed");
    } finally { setBuyingNum(""); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <ShoppingCart className="w-4 h-4" style={{ color: "#86efac" }} />
            Buy a Twilio phone number
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs" style={{ color: "var(--pos-muted)" }}>
          Purchases go through your Twilio account (SID <code className="text-white">AC…</code> in .env).
          You will be billed by Twilio directly for the monthly rental + per-minute usage.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-white block mb-1">Country</label>
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger data-testid="buy-country" className="text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-white block mb-1">
              {country === "US" || country === "CA" ? "Area code (3 digits)" : "Prefix / area"}
            </label>
            <Input data-testid="buy-area-code" value={areaCode}
              onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder={country === "US" ? "415" : ""}
              className="text-white"
              style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-white block mb-1">
              Contains (optional — letters map to keypad, e.g. &quot;PIZZA&quot;)
            </label>
            <Input data-testid="buy-contains" value={contains}
              onChange={(e) => setContains(e.target.value.toUpperCase().replace(/[^A-Z0-9*]/g, "").slice(0, 12))}
              placeholder="PIZZA or 555"
              className="text-white"
              style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
          </div>
          <label className="text-xs flex items-center gap-2 text-white sm:col-span-2">
            <input type="checkbox" data-testid="buy-sms" checked={smsToo}
              onChange={(e) => setSmsToo(e.target.checked)} className="accent-emerald-400" />
            Must also support SMS (for order confirmations)
          </label>
        </div>

        <div className="flex justify-end">
          <button data-testid="buy-search-btn" onClick={doSearch} disabled={searching}
            className="pos-btn h-10 px-5 rounded-md text-xs font-bold text-white flex items-center gap-2"
            style={{ background: "var(--pos-accent)", opacity: searching ? 0.5 : 1 }}>
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {searching ? "Searching Twilio..." : "Search"}
          </button>
        </div>

        <div className="max-h-[45vh] overflow-y-auto rounded-lg" style={{ border: "1px solid var(--pos-border)" }}>
          <table className="w-full text-sm">
            <thead className="sticky top-0" style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>
              <tr>
                <th className="text-left py-2 px-3 uppercase text-[10px] tracking-wider">Number</th>
                <th className="text-left py-2 px-3 uppercase text-[10px] tracking-wider">Location</th>
                <th className="text-center py-2 px-3 uppercase text-[10px] tracking-wider">Capabilities</th>
                <th className="text-right py-2 px-3 uppercase text-[10px] tracking-wider">Buy</th>
              </tr>
            </thead>
            <tbody className="text-white">
              {results.length === 0 && !searching && (
                <tr><td colSpan={4} className="text-center py-8" style={{ color: "var(--pos-muted)" }}>
                  Set your filters and hit Search.
                </td></tr>
              )}
              {results.map((n) => (
                <tr key={n.phone_number} data-testid={`buy-row-${n.phone_number}`}
                  style={{ borderTop: "1px solid var(--pos-border)" }}>
                  <td className="py-2 px-3 font-bold tabular-nums">{n.phone_number}</td>
                  <td className="py-2 px-3 text-xs" style={{ color: "var(--pos-muted)" }}>
                    {[n.locality, n.region, n.iso_country].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex items-center justify-center gap-2">
                      {n.voice && <Cap icon={PhoneCall} label="Voice" color="#86efac" />}
                      {n.sms && <Cap icon={MessageSquare} label="SMS" color="#7dd3fc" />}
                      {n.mms && <Cap icon={Zap} label="MMS" color="#fbbf24" />}
                    </div>
                  </td>
                  <td className="py-2 px-3 text-right">
                    <button data-testid={`buy-btn-${n.phone_number}`}
                      onClick={() => buy(n)} disabled={buyingNum === n.phone_number}
                      className="pos-btn h-8 px-3 rounded-md text-xs font-bold text-white"
                      style={{ background: "#0ea5e9", opacity: buyingNum === n.phone_number ? 0.5 : 1 }}>
                      {buyingNum === n.phone_number
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" />
                        : "Buy"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[11px]" style={{ color: "var(--pos-muted)" }}>
          <strong style={{ color: "#fbbf24" }}>India numbers:</strong> Twilio requires a KYC &quot;Regulatory Bundle&quot;
          before selling numbers in India. Complete it at
          {" "}<a href="https://console.twilio.com/us1/develop/phone-numbers/regulatory-compliance/bundles"
             target="_blank" rel="noreferrer" className="underline" style={{ color: "#7dd3fc" }}>console.twilio.com → Regulatory Compliance</a>,
          {" "}then retry. US/CA numbers activate instantly.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function Cap({ icon: Icon, label, color }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full"
      style={{ background: "var(--pos-panel-2)", color }}>
      <Icon className="w-3 h-3" /> {label}
    </span>
  );
}
