import React, { useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  ShoppingCart, LayoutGrid, ChefHat, Truck, Boxes, Users, BarChart3,
  MessageCircle, Mic, MapPin, Mail, Phone, Sparkles, Menu, X,
  ShoppingBag, CheckCircle2, Instagram,
} from "lucide-react";
import useSeo, { useStructuredData } from "../hooks/useSeo";

const FEATURES = [
  { icon: ShoppingCart, title: "Order Management", desc: "Delivery, collection & dine-in orders on one fast, built-for-busy-shifts screen.", big: true },
  { icon: ShoppingBag, title: "Retail Checkout", desc: "Barcode scanning, product variants, and basket-first checkout for shops." },
  { icon: ChefHat, title: "Kitchen Display", desc: "Real-time ticket routing by station, with prep timers." },
  { icon: LayoutGrid, title: "Tables & Floor Plan", desc: "Drag-and-drop layout, live status, reservations." },
  { icon: Truck, title: "Dispatch & Delivery", desc: "Driver assignment and live order tracking." },
  { icon: Boxes, title: "Inventory & Waste", desc: "Stock levels, low-stock alerts, reorder points." },
  { icon: Users, title: "Staff & Workforce", desc: "PIN login, time clock, shift scheduling, tips.", big: true },
  { icon: BarChart3, title: "Reports & Analytics", desc: "Daily rollups, peak-hour heatmaps." },
  { icon: MessageCircle, title: "SMS & WhatsApp", desc: "Order updates and broadcast messaging." },
  { icon: Mic, title: "Voice & AI Assistant", desc: "Phone-in ordering, in-store AI help." },
];

const LIVE_CHANNELS = [
  { icon: LayoutGrid, title: "Dine-in", note: "Tables update live as guests are seated" },
  { icon: Truck, title: "Delivery", note: "Drivers tracked from dispatch to drop-off" },
  { icon: ShoppingBag, title: "Collection", note: "Pickup orders marked ready in real time" },
  { icon: ShoppingCart, title: "Retail", note: "Barcode checkout at the counter" },
];

const NAV_LINKS = [
  { href: "#live", label: "Live view" },
  { href: "#features", label: "Features" },
  { href: "#contact", label: "Contact" },
];

function Reveal({ children, className, delay = 0, ...rest }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

function SectionLabel({ children }) {
  return (
    <div className="inline-flex items-center gap-1.5 text-xs font-bold tracking-[0.3em] uppercase mb-3 px-3 py-1 rounded-full" style={{ color: "var(--pos-accent)", border: "1px solid #243352" }}>
      <Sparkles className="w-3 h-3" /> {children}
    </div>
  );
}

const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "name": "Kanda POS",
      "url": "https://kandapos.com",
      "logo": "https://kandapos.com/kanda-logo.png",
      "email": "connect@kandapos.com",
      "telephone": "+91-90009-90209",
      "areaServed": { "@type": "Country", "name": "India" },
    },
    {
      "@type": "SoftwareApplication",
      "name": "Kanda POS",
      "applicationCategory": "BusinessApplication",
      "operatingSystem": "Web, Android, Windows",
      "description": "GST-ready point of sale software for restaurants and retail stores in India: dine-in, collection, delivery and in-store sales, kitchen tickets, barcode checkout, staff, inventory and reporting in one system. Launching soon.",
      "url": "https://kandapos.com",
      "areaServed": "IN",
    },
  ],
};

export default function LandingPage() {
  useSeo({
    title: "Point of sale for restaurants & retail — coming soon",
    description: "Kanda POS is a GST-ready point of sale for Indian restaurants and retail stores: dine-in, collection, delivery and in-store sales, kitchen tickets, barcode checkout, staff, inventory and reporting in one connected system. Launching soon — book a demo or sign up for updates.",
    path: "/",
  });
  useStructuredData("ld-landing", STRUCTURED_DATA);

  const [form, setForm] = useState({ name: "", email: "", phone: "", business: "", message: "" });
  const [submitted, setSubmitted] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [updatesName, setUpdatesName] = useState("");
  const [updatesEmail, setUpdatesEmail] = useState("");
  const [updatesSubmitted, setUpdatesSubmitted] = useState(false);
  const [updatesBusy, setUpdatesBusy] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Public, unauthenticated lead-capture endpoint — no tenant/auth context
  // on the marketing homepage, so this bypasses the shared `api` client
  // (which resolves a tenant slug and attaches a staff token) in favor of a
  // plain fetch straight to the backend.
  const submitLead = async (payload) => {
    const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(detail?.detail || "Something went wrong. Please try again.");
    }
  };

  const submitDemo = async (e) => {
    e.preventDefault();
    if (demoBusy) return;
    if (!form.name.trim() || !form.email.trim()) {
      toast.error("Please fill in your name and email.");
      return;
    }
    setDemoBusy(true);
    try {
      await submitLead({ type: "demo", ...form });
      setSubmitted(true);
      toast.success("Thanks! Our team will reach out to schedule your demo.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDemoBusy(false);
    }
  };

  const submitUpdates = async (e) => {
    e.preventDefault();
    if (updatesBusy) return;
    if (!updatesName.trim() || !updatesEmail.trim()) {
      toast.error("Please enter your name and email.");
      return;
    }
    setUpdatesBusy(true);
    try {
      await submitLead({ type: "updates", name: updatesName, email: updatesEmail });
      setUpdatesSubmitted(true);
      toast.success("You're on the list — we'll email you at launch.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUpdatesBusy(false);
    }
  };

  return (
    <div style={{ background: "#050506", color: "#e8edf7", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }} className="overflow-x-hidden" data-testid="landing-page">
      {/* Nav */}
      <header className="sticky top-0 z-20" style={{ background: "rgba(5,5,6,0.75)", backdropFilter: "blur(10px)", borderBottom: "1px solid #243352" }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            {/* The logo file's wordmark is dark brown, illegible on this dark
                header — crop to just the orange mark and set the name as
                real, theme-colored text instead of baked-in pixels. */}
            <div className="h-8 w-8 overflow-hidden shrink-0">
              <img src="/kanda-logo.png" alt="Kanda POS" className="h-8 w-auto max-w-none" />
            </div>
            <span className="font-bold text-lg tracking-tight" style={{ color: "#e8edf7" }}>Kanda POS</span>
          </div>
          <nav className="hidden md:flex items-center gap-8 text-sm" style={{ color: "#8b9bb8" }}>
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} className="hover:text-white transition-colors">{l.label}</a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <a href="#contact" className="pos-btn rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: "var(--pos-accent)" }}>
              Book a demo
            </a>
            <button
              type="button"
              className="md:hidden rounded-lg p-2"
              style={{ background: "#111a2c", border: "1px solid #243352", color: "#e8edf7" }}
              onClick={() => setMobileNavOpen((v) => !v)}
              aria-label="Toggle navigation menu"
              aria-expanded={mobileNavOpen}
            >
              {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
        <AnimatePresence>
          {mobileNavOpen && (
            <motion.nav
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="md:hidden overflow-hidden"
              style={{ borderTop: "1px solid #243352" }}
            >
              <div className="flex flex-col px-6 py-2">
                {NAV_LINKS.map((l) => (
                  <a
                    key={l.href}
                    href={l.href}
                    onClick={() => setMobileNavOpen(false)}
                    className="py-3 text-sm hover:text-white transition-colors"
                    style={{ color: "#8b9bb8", borderBottom: "1px solid #243352" }}
                  >
                    {l.label}
                  </a>
                ))}
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="land-blob-a absolute -top-32 -left-32 w-[28rem] h-[28rem] rounded-full" style={{ background: "radial-gradient(circle, #f97316 0%, transparent 70%)", filter: "blur(70px)", opacity: 0.35 }} />
        <div className="land-blob-b absolute top-10 -right-40 w-[30rem] h-[30rem] rounded-full" style={{ background: "radial-gradient(circle, #fbbf24 0%, transparent 70%)", filter: "blur(80px)", opacity: 0.28 }} />
        <div className="absolute inset-0 land-grid-fade" />

        <div className="relative max-w-6xl mx-auto px-6 pt-24 pb-24 text-center">
          <motion.div
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 text-sm font-bold mb-8 px-5 py-2.5 rounded-full"
            style={{ background: "rgba(249,115,22,0.12)", border: "1px solid rgba(249,115,22,0.4)", color: "var(--pos-accent)" }}
          >
            <span className="live-dot w-2 h-2 rounded-full" style={{ background: "var(--pos-accent)" }} />
            Coming soon to India
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1 }}
            className="text-5xl md:text-7xl font-bold leading-[1.06] mb-6"
          >
            Point of sale,<br />
            <span className="land-gradient-text">built for India.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.2 }}
            className="text-lg max-w-2xl mx-auto mb-10" style={{ color: "#8b9bb8" }}
          >
            One connected system for restaurants and retail: GST-ready billing, kitchen sync
            and reporting in one place. We're putting the finishing touches on Kanda POS
            before opening the doors.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-wrap items-center justify-center gap-4"
          >
            <a href="#contact" className="pos-btn rounded-xl px-6 py-3 font-semibold text-white" style={{ background: "var(--pos-accent)" }}>
              Book a demo
            </a>
            <a href="#updates" className="pos-btn rounded-xl px-6 py-3 font-semibold text-white" style={{ background: "#111a2c", border: "1px solid #243352" }}>
              Sign up for updates
            </a>
          </motion.div>
        </div>
      </section>

      {/* Live view */}
      <section id="live" className="max-w-6xl mx-auto px-6 py-20" style={{ borderTop: "1px solid #243352" }}>
        <Reveal className="text-center mb-14">
          <SectionLabel>Everywhere at once</SectionLabel>
          <h2 className="text-3xl md:text-4xl font-bold">Four channels. One live view.</h2>
        </Reveal>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          {LIVE_CHANNELS.map(({ icon: Icon, title, note }, i) => (
            <Reveal key={title} delay={i * 0.06}>
              <div className="land-card h-full rounded-2xl p-6" style={{ background: "#111a2c", border: "1px solid #243352" }}>
                <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4" style={{ background: "rgba(249,115,22,0.14)" }}>
                  <Icon className="w-5 h-5" style={{ color: "var(--pos-accent)" }} />
                </div>
                <div className="font-semibold mb-1">{title}</div>
                <div className="text-xs" style={{ color: "#8b9bb8" }}>{note}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* GST */}
      <section id="gst" className="max-w-6xl mx-auto px-6 py-20" style={{ borderTop: "1px solid #243352" }}>
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <Reveal>
            <SectionLabel>Built for India</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Every bill, GST-ready.</h2>
            <p style={{ color: "#8b9bb8" }} className="leading-relaxed mb-6">
              GSTIN, tax breakdowns and store details print on every invoice automatically,
              whether it's a dine-in check or a retail receipt. Nothing to configure by hand
              for tax season.
            </p>
            <a href="#contact" className="pos-btn inline-block rounded-xl px-6 py-3 font-semibold text-white" style={{ background: "var(--pos-accent)" }}>
              Book a demo
            </a>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="rounded-2xl p-6 text-sm" style={{ background: "#111a2c", border: "1px solid #243352" }}>
              <div className="flex justify-between py-2" style={{ borderBottom: "1px solid #243352" }}><span>Butter Chicken (Full)</span><span className="font-mono">₹420</span></div>
              <div className="flex justify-between py-2" style={{ borderBottom: "1px solid #243352" }}><span>Tandoori Roti ×4</span><span className="font-mono">₹160</span></div>
              <div className="flex justify-between py-2" style={{ borderBottom: "1px solid #243352" }}><span>CGST 2.5%</span><span className="font-mono">₹14.50</span></div>
              <div className="flex justify-between py-2" style={{ borderBottom: "1px solid #243352" }}><span>SGST 2.5%</span><span className="font-mono">₹14.50</span></div>
              <div className="flex justify-between pt-3 font-bold" style={{ color: "var(--pos-accent)" }}><span>Total</span><span className="font-mono">₹609</span></div>
              <div className="mt-3 text-xs font-mono" style={{ color: "#8b9bb8" }}>GSTIN 36ABCDE1234F1Z5 · Demo Restaurant, Hyderabad</div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-20" style={{ borderTop: "1px solid #243352" }}>
        <Reveal className="text-center mb-14">
          <SectionLabel>Everything else, included</SectionLabel>
          <h2 className="text-3xl md:text-4xl font-bold">Everything a restaurant or retail store needs to run</h2>
        </Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 auto-rows-fr">
          {FEATURES.map(({ icon: Icon, title, desc, big }, i) => (
            <Reveal key={title} delay={(i % 3) * 0.06} className={big ? "sm:col-span-2" : ""}>
              <div className="land-card h-full rounded-2xl p-6" style={{ background: "#111a2c", border: "1px solid #243352" }}>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4" style={{ background: "linear-gradient(135deg, var(--pos-accent), #ea580c)" }}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <div className="font-semibold text-lg mb-1.5">{title}</div>
                <div className="text-sm" style={{ color: "#8b9bb8" }}>{desc}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Contact + updates */}
      <section id="contact" className="max-w-6xl mx-auto px-6 py-20" style={{ borderTop: "1px solid #243352" }}>
        <div className="flex flex-col gap-5">
          {/* Contact form: business info + book a demo, all in one place */}
          <Reveal className="max-w-2xl mx-auto w-full rounded-2xl p-6 sm:p-10" style={{ background: "#111a2c", border: "1px solid #243352" }}>
            <h2 className="text-2xl md:text-3xl font-bold mb-3">Let's get your business on Kanda POS</h2>
            <p style={{ color: "#8b9bb8" }} className="leading-relaxed mb-6">
              Tell us about your restaurant or retail store and we'll set up a walkthrough,
              or reach us directly using the details below.
            </p>
            <div className="flex flex-col gap-3 mb-6 pb-6" style={{ borderBottom: "1px solid #243352" }}>
              <a href="mailto:connect@kandapos.com" className="flex items-center gap-3 text-sm">
                <Mail className="w-4 h-4 shrink-0" style={{ color: "var(--pos-accent)" }} /> connect@kandapos.com
              </a>
              <a href="tel:+919000990209" className="flex items-center gap-3 text-sm">
                <Phone className="w-4 h-4 shrink-0" style={{ color: "var(--pos-accent)" }} /> +91 90009 90209
              </a>
              <a href="https://wa.me/919000990209" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-sm">
                <MessageCircle className="w-4 h-4 shrink-0" style={{ color: "var(--pos-accent)" }} /> WhatsApp: +91 90009 90209
              </a>
              <a href="https://www.instagram.com/kanda.pos" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-sm">
                <Instagram className="w-4 h-4 shrink-0" style={{ color: "var(--pos-accent)" }} /> @kanda.pos
              </a>
              <div className="flex items-center gap-3 text-sm">
                <MapPin className="w-4 h-4 shrink-0" style={{ color: "var(--pos-accent)" }} /> Hyderabad, India
              </div>
            </div>
            {submitted ? (
              <div className="flex flex-col items-center justify-center text-center py-10">
                <CheckCircle2 className="w-12 h-12 mb-3" style={{ color: "var(--pos-accent)" }} />
                <div className="font-semibold text-lg mb-1">Request received</div>
                <div className="text-sm" style={{ color: "#8b9bb8" }}>We'll be in touch at {form.email} shortly.</div>
              </div>
            ) : (
              <form onSubmit={submitDemo} className="grid gap-4">
                <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--pos-accent)" }}>Contact us</div>
                <input required placeholder="Your name" value={form.name} onChange={update("name")}
                  className="rounded-lg px-4 py-2.5 text-sm" style={{ background: "#16213a", border: "1px solid #243352", color: "#e8edf7" }} />
                <input required type="email" placeholder="Email address" value={form.email} onChange={update("email")}
                  className="rounded-lg px-4 py-2.5 text-sm" style={{ background: "#16213a", border: "1px solid #243352", color: "#e8edf7" }} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <input placeholder="Phone number" value={form.phone} onChange={update("phone")}
                    className="rounded-lg px-4 py-2.5 text-sm" style={{ background: "#16213a", border: "1px solid #243352", color: "#e8edf7" }} />
                  <input placeholder="Business name" value={form.business} onChange={update("business")}
                    className="rounded-lg px-4 py-2.5 text-sm" style={{ background: "#16213a", border: "1px solid #243352", color: "#e8edf7" }} />
                </div>
                <textarea placeholder="What are you looking to solve?" value={form.message} onChange={update("message")} rows={3}
                  className="rounded-lg px-4 py-2.5 text-sm resize-none" style={{ background: "#16213a", border: "1px solid #243352", color: "#e8edf7" }} />
                <motion.button whileTap={{ scale: 0.97 }} type="submit" disabled={demoBusy} className="rounded-lg px-6 py-3 font-semibold text-white disabled:opacity-60" style={{ background: "var(--pos-accent)" }}>
                  {demoBusy ? "Sending…" : "Contact us"}
                </motion.button>
              </form>
            )}
          </Reveal>

          {/* Sign up for updates — a separate, slim strip below the contact form, not a competing card */}
          <Reveal id="updates" delay={0.1} className="rounded-2xl p-6 sm:p-8" style={{ background: "#111a2c", border: "1px solid #243352" }}>
            <div className="flex flex-col md:flex-row md:items-center gap-5 md:gap-10">
              <div className="md:flex-1">
                <h2 className="text-lg font-bold mb-1">Get product updates</h2>
                <p style={{ color: "#8b9bb8" }} className="text-sm leading-relaxed">
                  New features and launch news — straight to your inbox, no spam.
                </p>
              </div>
              {updatesSubmitted ? (
                <div className="flex items-center gap-2 text-sm shrink-0" style={{ color: "var(--pos-accent)" }}>
                  <CheckCircle2 className="w-4 h-4" /> You're on the list — we'll email you at launch.
                </div>
              ) : (
                <form onSubmit={submitUpdates} className="flex flex-col gap-3 md:w-80 md:shrink-0">
                  <input
                    required placeholder="Your name"
                    value={updatesName} onChange={(e) => setUpdatesName(e.target.value)}
                    className="rounded-lg px-4 py-2.5 text-sm min-w-0"
                    style={{ background: "#16213a", border: "1px solid #243352", color: "#e8edf7" }}
                  />
                  <input
                    type="email" required placeholder="you@yourbusiness.com"
                    value={updatesEmail} onChange={(e) => setUpdatesEmail(e.target.value)}
                    className="rounded-lg px-4 py-2.5 text-sm min-w-0"
                    style={{ background: "#16213a", border: "1px solid #243352", color: "#e8edf7" }}
                  />
                  <button type="submit" disabled={updatesBusy} className="pos-btn rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60" style={{ background: "var(--pos-accent)" }}>
                    {updatesBusy ? "Signing up…" : "Sign up for updates"}
                  </button>
                </form>
              )}
            </div>
          </Reveal>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative overflow-hidden" style={{ borderTop: "1px solid #243352" }}>
        <div className="relative max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm" style={{ color: "#8b9bb8" }}>
          <span>© {new Date().getFullYear()} Kanda POS. All rights reserved.</span>
          <div className="flex items-center gap-6">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} className="hover:text-white transition-colors">{l.label}</a>
            ))}
            <Link to="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link to="/terms" className="hover:text-white transition-colors">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
