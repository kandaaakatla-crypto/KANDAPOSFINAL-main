import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { CheckCircle2, Copy, MessageCircle, Rocket, Headphones, Sparkles } from "lucide-react";

const BUSINESS_TYPES = [
  { value: "restaurant", label: "Restaurant" },
  { value: "cafe", label: "Café / bakery" },
  { value: "cloud_kitchen", label: "Cloud kitchen" },
  { value: "retail", label: "Retail store" },
  { value: "other", label: "Other" },
];

const OUTLETS = [
  { value: "1", label: "1" },
  { value: "2-5", label: "2–5" },
  { value: "6-20", label: "6–20" },
  { value: "20+", label: "20+" },
];

const PERKS = [
  { icon: Rocket, title: "First in line", desc: "Alpha seats open in waves, in waitlist order." },
  { icon: Headphones, title: "Set up with us", desc: "We help move your menu or catalogue over." },
  { icon: Sparkles, title: "Shape the product", desc: "A direct line to the team building it." },
];

// Kept in step with the backend's REFERRAL_BOOST (routes/leads.py).
const REFERRAL_BOOST = 5;

const inputStyle = { background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" };

function readRefParam() {
  try {
    const ref = new URLSearchParams(window.location.search).get("ref") || "";
    const clean = ref.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
    return clean || null;
  } catch {
    return null;
  }
}

function Chips({ label, options, value, onChange }) {
  return (
    <fieldset>
      <legend className="text-xs font-semibold mb-2" style={{ color: "var(--pos-muted)" }}>{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? null : o.value)}
              className="rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors"
              style={on
                ? { background: "var(--pos-accent)", border: "1px solid var(--pos-accent)", color: "#fff" }
                : { background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Alpha waitlist on the marketing homepage. Posts a `type: "updates"` lead
 * to the public /api/leads endpoint, which answers with the visitor's place
 * on the list and a referral code; a `?ref=CODE` on the page URL credits
 * whoever shared the link.
 */
export default function AlphaWaitlist({ submitLead }) {
  const [form, setForm] = useState({ name: "", email: "", city: "", phone: "" });
  const [businessType, setBusinessType] = useState(null);
  const [outlets, setOutlets] = useState(null);
  const [ref, setRef] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => { setRef(readRefParam()); }, []);

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!form.name.trim() || !form.email.trim()) {
      toast.error("Please enter your name and email.");
      return;
    }
    setBusy(true);
    try {
      const res = await submitLead({
        type: "updates",
        name: form.name,
        email: form.email,
        city: form.city || undefined,
        phone: form.phone || undefined,
        business_type: businessType || undefined,
        outlets: outlets || undefined,
        ref: ref || undefined,
      });
      setResult(res || {});
      toast.success(res?.already ? "You're already on the list." : "You're on the alpha waitlist.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const shareUrl = result?.ref_code ? `${window.location.origin}/?ref=${result.ref_code}#waitlist` : null;
  const shareText = shareUrl
    ? `I just joined the Kanda POS alpha, a GST-ready POS for restaurants and retail. Join the waitlist here: ${shareUrl}`
    : "";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy. Select the link and copy it instead.");
    }
  };

  return (
    <section id="waitlist" className="max-w-7xl mx-auto px-6 py-16 md:py-20" style={{ borderTop: "1px solid var(--pos-border)" }}>
      {/* Older links and posts point at #updates. */}
      <span id="updates" aria-hidden="true" />
      <div className="relative rounded-3xl overflow-hidden" style={{ background: "#121014" }}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 55% 60% at 15% 0%, rgba(249,115,22,0.24), transparent 70%)" }} />
        <div className="relative grid lg:grid-cols-[0.95fr_1.05fr] gap-10 lg:gap-14 p-6 sm:p-10 lg:p-14">
          <div className="text-white">
            <div className="flex items-center gap-2.5 mb-3.5">
              <span className="block w-5 h-[2px] shrink-0" style={{ background: "var(--pos-accent)" }} />
              <span className="text-xs font-bold tracking-[0.16em] uppercase" style={{ color: "#C9C2B8" }}>Alpha waitlist</span>
            </div>
            <h2 className="land-h2 text-3xl md:text-4xl mb-4">Run your counter on Kanda POS before anyone else.</h2>
            <p className="leading-relaxed mb-8 max-w-md" style={{ color: "#C9C2B8" }}>
              We are opening Kanda POS to a small group of restaurants and stores first.
              Join the waitlist and we'll reach out as seats open.
            </p>
            <div className="grid gap-5">
              {PERKS.map(({ icon: Icon, title, desc }) => (
                <div key={title} className="flex gap-3.5">
                  <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(249,115,22,0.16)" }}>
                    <Icon className="w-4.5 h-4.5" style={{ color: "#FB923C" }} />
                  </span>
                  <div>
                    <div className="font-bold text-sm">{title}</div>
                    <div className="text-sm" style={{ color: "#A39D95" }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl p-6 sm:p-8" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
            {result ? (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="h-full flex flex-col" data-testid="waitlist-success">
                <div className="flex items-center gap-2 text-sm font-semibold mb-5" style={{ color: "var(--pos-accent)" }}>
                  <CheckCircle2 className="w-4 h-4" /> {result.already ? "You're already on the list" : "You're on the list"}
                </div>
                {result.position ? (
                  <>
                    <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "var(--pos-muted)" }}>Your place</div>
                    <div className="land-h1 text-6xl mb-2" data-testid="waitlist-position">#{result.position}</div>
                    <p className="text-sm mb-6" style={{ color: "var(--pos-muted)" }}>
                      We'll email {form.email.trim()} when your alpha seat is ready.
                      {result.referrals > 0 && ` ${result.referrals} ${result.referrals === 1 ? "business has" : "businesses have"} joined through your link.`}
                    </p>
                  </>
                ) : (
                  <p className="text-sm mb-6" style={{ color: "var(--pos-muted)" }}>We'll email you when your alpha seat is ready.</p>
                )}
                {shareUrl && (
                  <div className="mt-auto rounded-xl p-4" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                    <div className="font-bold text-sm mb-1">Move up the list</div>
                    <div className="text-xs mb-3" style={{ color: "var(--pos-muted)" }}>
                      Know another owner? Every business that joins with your link moves you up {REFERRAL_BOOST} places.
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input readOnly value={shareUrl} onFocus={(e) => e.target.select()} aria-label="Your referral link"
                        className="flex-1 min-w-0 rounded-lg px-3 py-2 text-xs font-mono" style={inputStyle} />
                      <div className="flex gap-2">
                        <button type="button" onClick={copyLink} className="pos-btn flex-1 sm:flex-none flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold"
                          style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
                          <Copy className="w-3.5 h-3.5" /> Copy
                        </button>
                        <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer"
                          className="pos-btn flex-1 sm:flex-none flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white" style={{ background: "#25D366" }}>
                          <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            ) : (
              <form onSubmit={submit} className="grid gap-4" data-testid="waitlist-form">
                <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--pos-accent)" }}>Join the alpha</div>
                {ref && (
                  <div className="text-xs rounded-lg px-3 py-2" style={{ background: "rgba(249,115,22,0.10)", color: "var(--pos-text)" }}>
                    A friend invited you. Joining with their link moves them up the list too.
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <input required placeholder="Your name" autoComplete="name" value={form.name} onChange={update("name")}
                    className="rounded-lg px-4 py-2.5 text-sm min-w-0" style={inputStyle} />
                  <input required type="email" placeholder="you@yourbusiness.com" autoComplete="email" value={form.email} onChange={update("email")}
                    className="rounded-lg px-4 py-2.5 text-sm min-w-0" style={inputStyle} />
                </div>
                <Chips label="What do you run?" options={BUSINESS_TYPES} value={businessType} onChange={setBusinessType} />
                <Chips label="How many outlets?" options={OUTLETS} value={outlets} onChange={setOutlets} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <input placeholder="City" autoComplete="address-level2" value={form.city} onChange={update("city")}
                    className="rounded-lg px-4 py-2.5 text-sm min-w-0" style={inputStyle} />
                  <input type="tel" placeholder="WhatsApp number (optional)" autoComplete="tel" value={form.phone} onChange={update("phone")}
                    className="rounded-lg px-4 py-2.5 text-sm min-w-0" style={inputStyle} />
                </div>
                <motion.button whileTap={{ scale: 0.97 }} type="submit" disabled={busy}
                  className="land-pos-btn rounded-full px-6 py-3 font-bold text-white disabled:opacity-60" style={{ background: "var(--pos-accent)" }}>
                  {busy ? "Joining…" : "Join the waitlist"}
                </motion.button>
                <div className="text-[11px] text-center" style={{ color: "var(--pos-muted)" }}>
                  No spam. Launch news and your alpha invite only.
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
