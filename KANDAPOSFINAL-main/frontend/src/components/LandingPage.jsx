import React, { useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import { toast } from "sonner";
import {
  ShoppingCart, LayoutGrid, ChefHat, Truck, Boxes, Users, BarChart3,
  MessageCircle, Mic, MapPin, Mail, Menu, X, Plus,
  ShoppingBag, CheckCircle2, Instagram, ArrowUpRight, Coffee, Sun, Moon, Bike,
} from "lucide-react";
import useSeo, { useStructuredData } from "../hooks/useSeo";
import AlphaWaitlist from "./landing/AlphaWaitlist";
import { WordReveal, Rise, ScrollWords, Marquee, HoverList, ServiceRows, ScaleCta } from "./landing/motion";
import { useSmoothScroll, CursorFollower, Magnetic, CountUp, StackCards, HorizontalScroll } from "./landing/immersive";
import HeroOrderPanel from "./landing/HeroOrderPanel";
import { OrderScreenMock, KdsMock, DispatchMock, ReportsMock, PulseRings } from "./landing/visuals";


const FEATURES = [
  { icon: ShoppingCart, title: "Order Management", tag: "All", desc: "Delivery, collection and dine in orders on one fast screen, built for busy shifts.", big: true, from: "#EA580C", to: "#2A0D02", note: "Order #142 ready for table 4", noteColor: "#F97316" },
  { icon: ShoppingBag, title: "Retail Checkout", tag: "Retail", desc: "Barcode scanning, product variants and quick checkout for shops.", from: "#7C3AED", to: "#0B0620" },
  { icon: ChefHat, title: "Kitchen Display", tag: "Restaurants", desc: "Tickets routed to the right station in real time, with prep timers.", from: "#1D4ED8", to: "#050A1F", note: "Synced to KDS · Grill", noteColor: "#1D4ED8" },
  { icon: LayoutGrid, title: "Tables & Floor Plan", tag: "Restaurants", desc: "Move tables into your own layout, with live status and reservations.", from: "#0891B2", to: "#03181D" },
  { icon: Truck, title: "Dispatch & Delivery", tag: "Restaurants", desc: "Driver assignment and live order tracking.", from: "#B91C1C", to: "#170403" },
  { icon: Boxes, title: "Inventory & Waste", tag: "All", desc: "Stock levels, low stock alerts and reorder points.", big: true, from: "#B45309", to: "#1C0D02", note: "3 items below reorder point", noteColor: "#F59E0B" },
  { icon: Users, title: "Staff & Workforce", tag: "All", desc: "PIN login, time clock, shift scheduling and tips.", from: "#166534", to: "#03140A", note: "Shift clocked in — Aarav Reddy", noteColor: "#22C55E" },
  { icon: BarChart3, title: "Reports & Analytics", tag: "All", desc: "Daily rollups and heatmaps for your peak hours.", from: "#0E7490", to: "#031015" },
  { icon: MessageCircle, title: "SMS & WhatsApp", tag: "All", desc: "Order updates and broadcast messaging.", from: "#4D7C0F", to: "#0B1503" },
  { icon: Mic, title: "Voice & AI Assistant", tag: "All", desc: "Phone orders and AI help, answered automatically.", from: "#4338CA", to: "#080720" },
];

const LIVE_CHANNELS = [
  { icon: LayoutGrid, title: "Dine in", points: ["Floor plan", "Reservations", "Kitchen tickets"], note: "Tables update live as guests are seated", from: "#EA580C", to: "#3B1206" },
  { icon: Truck, title: "Delivery", points: ["Driver assignment", "Live tracking", "Dispatch board"], note: "Drivers tracked from dispatch to the door", from: "#1D4ED8", to: "#0B1230" },
  { icon: ShoppingBag, title: "Collection", points: ["Pickup queue", "Ready alerts", "SMS updates"], note: "Pickup orders marked ready in real time", from: "#166534", to: "#06210F" },
  { icon: ShoppingCart, title: "Retail", points: ["Barcode scanning", "Variants", "Quick checkout"], note: "Barcode checkout at the counter", from: "#7C2D12", to: "#1E0A03" },
];

const STACK = [
  { title: "Ring it up", body: "Big, fast tiles built for a packed counter. Dine in, takeaway and delivery from one screen, with GST worked out as you tap.", from: "#EA580C", to: "#431407", visual: <OrderScreenMock /> },
  { title: "Fire to the kitchen", body: "Tickets land on the right station the moment you send them, with timers that turn red before a guest has to ask.", from: "#1D4ED8", to: "#0B1230", visual: <KdsMock /> },
  { title: "Out the door", body: "Assign a rider, watch them on the map, and let the customer track it too. Pickup orders flag themselves ready.", from: "#B91C1C", to: "#2A0606", visual: <DispatchMock /> },
  { title: "Close the day", body: "Sales, peak hours and best sellers roll up by themselves. You see tonight's numbers before you lock the shutter.", from: "#0E7490", to: "#03161C", visual: <ReportsMock /> },
];

const DAY = [
  { time: "07:00", icon: Coffee, title: "Chai rush", body: "Fifty Irani chais before nine. Quick keys and saved favourites keep the queue moving.", from: "#B45309", to: "#2A1503" },
  { time: "13:30", icon: Sun, title: "Lunch, every table", body: "The floor plan fills up live. Orders split by station, bills split by guest.", from: "#EA580C", to: "#431407" },
  { time: "17:00", icon: ShoppingBag, title: "Retail restock", body: "Low stock alerts and reorder points tell you what to buy before you run out.", from: "#7C3AED", to: "#1E0B3A" },
  { time: "20:45", icon: Bike, title: "Delivery peak", body: "Online orders, riders and pickup all on one board, so nothing gets lost in the rush.", from: "#B91C1C", to: "#2A0606" },
  { time: "23:30", icon: Moon, title: "Lights out", body: "Cash drawer closed, GST report ready, tomorrow's prep list waiting.", from: "#1D4ED8", to: "#0B1230" },
];

const NAV_LINKS = [
  { href: "#live", label: "Live view" },
  { href: "#features", label: "Features" },
  { href: "#waitlist", label: "Alpha waitlist" },
  { href: "#contact", label: "Contact" },
];

// Thin rule + uppercase label — echoes the logo's own ledger-line mark.
function Kicker({ children }) {
  return (
    <div className="flex items-center gap-2.5 mb-3.5">
      <span className="block w-5 h-[2px] shrink-0" style={{ background: "var(--pos-accent)" }} />
      <span className="text-xs font-bold tracking-[0.16em] uppercase" style={{ color: "var(--pos-muted)" }}>{children}</span>
    </div>
  );
}

// Reveals children once, on scroll-in — used only for the GST receipt's
// line items (the page's one deliberate scroll moment).
function RevealRows({ children }) {
  return (
    <motion.div
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-60px" }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.09 } } }}
    >
      {children}
    </motion.div>
  );
}
const rowVariant = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } } };

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
    description: "Kanda POS is a GST-ready point of sale for Indian restaurants and retail stores: dine-in, collection, delivery and in-store sales, kitchen tickets, barcode checkout, staff, inventory and reporting in one connected system. Launching soon — book a demo or join the alpha waitlist.",
    path: "/",
  });
  useStructuredData("ld-landing", STRUCTURED_DATA);
  useSmoothScroll();

  const [form, setForm] = useState({ name: "", email: "", phone: "", business: "", city: "", message: "" });
  const [submitted, setSubmitted] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);

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
      // FastAPI 422s carry a list of field errors, not a string.
      const msg = typeof detail?.detail === "string" ? detail.detail : null;
      throw new Error(msg || "Something went wrong. Please try again.");
    }
    return res.json().catch(() => ({}));
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

  return (
    <MotionConfig reducedMotion="user">
    <div style={{ background: "var(--pos-bg)", color: "var(--pos-text)", overflowX: "clip" }} className="land-page" data-testid="landing-page">
      <CursorFollower />

      {/* Nav */}
      <header className="sticky top-0 z-20" style={{ background: "rgba(253,250,244,0.85)", backdropFilter: "blur(10px)", borderBottom: "1px solid var(--pos-border)" }}>
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-3.5">
          <img src="/kanda-logo.png" alt="Kanda POS" width={127} height={36} className="h-9 w-auto" />
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium" style={{ color: "var(--pos-muted)" }}>
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} className="hover:opacity-70 transition-opacity" style={{ color: "var(--pos-text)" }}>{l.label}</a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <a href="#contact" className="pos-btn land-pos-btn rounded-full px-5 py-2.5 text-sm font-bold text-white" style={{ background: "var(--pos-accent)" }}>
              Book a demo
            </a>
            <button
              type="button"
              className="md:hidden rounded-full p-2"
              style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}
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
              style={{ borderTop: "1px solid var(--pos-border)" }}
            >
              <div className="flex flex-col px-6 py-2">
                {NAV_LINKS.map((l) => (
                  <a
                    key={l.href}
                    href={l.href}
                    onClick={() => setMobileNavOpen(false)}
                    className="py-3 text-sm font-medium"
                    style={{ color: "var(--pos-text)", borderBottom: "1px solid var(--pos-border)" }}
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
      <section className="relative max-w-7xl mx-auto px-6 pt-12 md:pt-20">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}
          className="relative z-10 flex items-center justify-between text-xs font-semibold mb-8 md:mb-12" style={{ color: "var(--pos-muted)" }}>
          <span className="flex items-center gap-2"><span className="live-dot w-2 h-2 rounded-full" style={{ background: "var(--pos-accent)" }} /> Alpha opening in waves</span>
          <span>Hyderabad, India</span>
        </motion.div>
        <WordReveal as="h1" text="Point of sale, built for India's busiest counters." className="relative z-10 land-display text-[13vw] md:text-[7.4vw] lg:text-[6.2vw] max-w-[14ch] lg:max-w-[16ch]" />
        <div className="relative z-10 grid md:grid-cols-[1fr_auto] gap-8 items-end mt-6 md:mt-12">
          <Rise delay={0.5}>
            <p className="text-lg md:text-xl max-w-xl leading-relaxed" style={{ color: "var(--pos-muted)" }}>
              One system for restaurants and retail: GST ready billing, kitchen sync,
              delivery and stock, all on one screen. We are putting the finishing
              touches on Kanda POS before opening the doors.
            </p>
          </Rise>
          <Rise delay={0.65} className="flex flex-wrap items-center gap-3">
            <Magnetic>
              <a href="#contact" className="group inline-flex items-center gap-3 rounded-full pl-6 pr-1.5 py-1.5 font-bold text-white" style={{ background: "var(--pos-text)" }}>
                Book a demo
                <span className="w-9 h-9 rounded-full flex items-center justify-center transition-transform duration-500 group-hover:rotate-45" style={{ background: "var(--pos-accent)" }}>
                  <ArrowUpRight className="w-4 h-4" />
                </span>
              </a>
            </Magnetic>
            <Magnetic>
              <a href="#waitlist" className="inline-block rounded-full px-6 py-3 font-bold" style={{ border: "1.5px solid var(--pos-text)", color: "var(--pos-text)", background: "var(--pos-bg)" }}>
                Join the alpha waitlist
              </a>
            </Magnetic>
          </Rise>
        </div>
        {/* The order screen, playing out a live counter order. */}
        <div className="relative mt-14 md:mt-20 pb-16 md:pb-24">
          <HeroOrderPanel />
        </div>
      </section>

      {/* Module strip — the hero's moving "carousel" */}
      <Rise delay={0.8} className="mt-14 md:mt-20" y={40}>
        <Marquee speed={55}>
          {FEATURES.map((f) => (
            <div key={f.title} className="relative w-[260px] md:w-[340px] h-[200px] md:h-[250px] rounded-3xl overflow-hidden p-5 flex flex-col justify-end text-white shrink-0"
              style={{ background: `linear-gradient(160deg, ${f.from} 0%, ${f.to} 78%)` }}>
              {f.note && (
                <div className="absolute top-4 left-4 right-4 bg-white rounded-lg px-3 py-2 text-xs font-semibold flex items-center gap-2 shadow-lg" style={{ color: "#161311" }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: f.noteColor }} />
                  {f.note}
                </div>
              )}
              <f.icon className="w-5 h-5 mb-2.5 opacity-90" />
              <div className="font-bold mb-1">{f.title}</div>
              <div className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.82)" }}>{f.desc}</div>
            </div>
          ))}
        </Marquee>
      </Rise>

      {/* Statement */}
      <section className="max-w-6xl mx-auto px-6 py-24 md:py-36">
        <ScrollWords
          className="land-display text-3xl md:text-6xl"
          text="Dine in, delivery, collection and the retail till. Kanda POS keeps every order, ticket and rupee on one live screen, so the rush hour runs itself."
        />
      </section>

      {/* Numbers */}
      <section className="max-w-7xl mx-auto px-6 pb-20 md:pb-28">
        <div className="grid grid-cols-2 md:grid-cols-4" style={{ borderTop: "1px solid var(--pos-border)" }}>
          {[[10, "", "modules in one system"], [4, "", "ways to sell, one live view"], [3, "", "platforms: web, Android, Windows"], [1, "", "screen for the whole counter"]].map(([n, suf, label], i) => (
            <div key={label} className="pt-6 pb-2 pr-4" style={{ borderLeft: i ? "1px solid var(--pos-border)" : "none", paddingLeft: i ? "1.25rem" : 0 }}>
              <CountUp to={n} suffix={suf} className="land-display text-6xl md:text-8xl block" />
              <div className="text-sm mt-2" style={{ color: "var(--pos-muted)" }}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Rush hour, as stacking cards */}
      <section aria-label="How Kanda POS runs a rush hour" className="pb-10">
        <div className="max-w-7xl mx-auto px-6 mb-6 md:mb-10">
          <WordReveal as="h2" text="One order, start to finish." className="land-display text-4xl md:text-7xl" />
        </div>
        <StackCards cards={STACK} />
      </section>

      {/* Modules */}
      <section id="features" className="max-w-7xl mx-auto px-6 pb-20 md:pb-28">
        <div className="flex items-end justify-between gap-6 mb-8 md:mb-12">
          <WordReveal as="h2" text="Everything at the counter" className="land-display text-4xl md:text-7xl" />
          <span className="text-sm shrink-0 pb-2" style={{ color: "var(--pos-muted)" }}>({FEATURES.length} modules)</span>
        </div>
        <HoverList items={FEATURES} />
      </section>

      {/* A day at the counter — pinned horizontal scroll */}
      <HorizontalScroll
        heading={<WordReveal as="h2" text="A day at the counter." className="land-display text-4xl md:text-7xl" />}
        panels={DAY.map((d) => ({ ...d, visual: <PulseRings /> }))}
      />
      <div className="h-16 md:h-24" />

      {/* Live channels */}
      <section id="live" className="px-3 md:px-6">
        <div className="max-w-[90rem] mx-auto rounded-[2rem] md:rounded-[2.5rem] px-6 md:px-16 py-16 md:py-24 text-white" style={{ background: "#121014" }}>
          <div className="grid md:grid-cols-[1fr_1fr] gap-6 items-end mb-10 md:mb-16">
            <WordReveal as="h2" text="Four channels, one live view." className="land-display text-4xl md:text-7xl" />
            <p className="text-base md:text-lg max-w-md md:justify-self-end" style={{ color: "#A39D95" }}>
              From an Irani café counter to a kirana till, every way you sell lands on the same screen in real time.
            </p>
          </div>
          <ServiceRows items={LIVE_CHANNELS} />
        </div>
      </section>

      {/* GST */}
      <section id="gst" className="max-w-7xl mx-auto px-6 py-16 md:py-20" style={{ borderTop: "1px solid var(--pos-border)" }}>
        <div className="grid md:grid-cols-2 gap-14 items-center">
          <div>
            <Kicker>Built for India</Kicker>
            <h2 className="land-h2 text-3xl md:text-4xl mb-4">Every bill, GST ready.</h2>
            <p style={{ color: "var(--pos-muted)" }} className="leading-relaxed mb-7 max-w-md">
              GSTIN, tax breakdowns and store details print on every invoice automatically,
              whether it is a dine in check or a retail receipt. Nothing to configure by
              hand for tax season.
            </p>
            <a href="#contact" className="pos-btn land-pos-btn inline-block rounded-full px-6 py-3 font-bold text-white" style={{ background: "var(--pos-accent)" }}>
              Book a demo
            </a>
          </div>

          <div className="flex justify-center md:justify-end">
            <div className="w-[280px] land-receipt" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
              <div className="land-receipt-edge" aria-hidden="true" />
              <div className="px-5 pt-6 pb-5 font-mono text-[13px]" style={{ color: "var(--pos-text)" }}>
                <div className="text-center mb-4">
                  <div className="font-bold tracking-wide">DEMO RESTAURANT</div>
                  <div className="text-[11px] mt-0.5" style={{ color: "var(--pos-muted)" }}>Hyderabad, Telangana</div>
                </div>
                <RevealRows>
                  <motion.div variants={rowVariant} className="flex justify-between py-1.5" style={{ borderBottom: "1px dashed var(--pos-border)" }}>
                    <span>Hyderabadi Biryani</span><span>₹320</span>
                  </motion.div>
                  <motion.div variants={rowVariant} className="flex justify-between py-1.5" style={{ borderBottom: "1px dashed var(--pos-border)" }}>
                    <span>Irani Chai ×2</span><span>₹40</span>
                  </motion.div>
                  <motion.div variants={rowVariant} className="flex justify-between py-1.5" style={{ borderBottom: "1px dashed var(--pos-border)" }}>
                    <span>Osmania Biscuit ×4</span><span>₹80</span>
                  </motion.div>
                  <motion.div variants={rowVariant} className="flex justify-between py-1.5" style={{ borderBottom: "1px dashed var(--pos-border)" }}>
                    <span>CGST 2.5%</span><span>₹11.00</span>
                  </motion.div>
                  <motion.div variants={rowVariant} className="flex justify-between py-1.5" style={{ borderBottom: "1px dashed var(--pos-border)" }}>
                    <span>SGST 2.5%</span><span>₹11.00</span>
                  </motion.div>
                  <motion.div variants={rowVariant} className="flex justify-between pt-3 font-bold text-[15px]" style={{ color: "var(--pos-accent)" }}>
                    <span>Total</span><span>₹462.00</span>
                  </motion.div>
                </RevealRows>
                <div className="mt-4 pt-3 text-[10px] leading-relaxed text-center" style={{ borderTop: "1px solid var(--pos-border)", color: "var(--pos-muted)" }}>
                  GSTIN 36AKPPK1234F1Z8<br />Thank you, visit again
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>


      <AlphaWaitlist submitLead={submitLead} />

      <ScaleCta
        eyebrow="Small team, built in Hyderabad"
        title="Let's open your counter."
        sub="Tell us about your counter and we'll set up a walkthrough."
        href="#contact"
        cta="Book a demo"
      />

      {/* Contact */}
      <section id="contact" className="max-w-7xl mx-auto px-6 py-16 md:py-20" style={{ borderTop: "1px solid var(--pos-border)" }}>
        <div className="flex flex-col gap-5">
          <div className="w-full rounded-2xl p-6 sm:p-10" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
            <div className="grid md:grid-cols-2 gap-8 md:gap-12">
              <div>
                <h2 className="land-h2 text-2xl md:text-3xl mb-3">Let's get your business on Kanda POS</h2>
                <p style={{ color: "var(--pos-muted)" }} className="leading-relaxed mb-6">
                  Tell us about your restaurant or retail store and we'll set up a walkthrough,
                  or reach us directly using the details below.
                </p>
                <div className="flex flex-col gap-3">
                  <a href="mailto:connect@kandapos.com" className="flex items-center gap-3 text-sm">
                    <Mail className="w-4 h-4 shrink-0" style={{ color: "var(--pos-accent)" }} /> connect@kandapos.com
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
              </div>
              <div className="pt-6 md:pt-0 md:border-l md:pl-12" style={{ borderColor: "var(--pos-border)" }}>
                {submitted ? (
                  <div className="h-full flex flex-col items-center justify-center text-center py-10">
                    <CheckCircle2 className="w-12 h-12 mb-3" style={{ color: "var(--pos-accent)" }} />
                    <div className="font-semibold text-lg mb-1">Request received</div>
                    <div className="text-sm" style={{ color: "var(--pos-muted)" }}>We'll be in touch at {form.email} shortly.</div>
                  </div>
                ) : (
                  <form onSubmit={submitDemo} className="grid gap-4">
                    <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--pos-accent)" }}>Contact us</div>
                    <input required placeholder="Your name" value={form.name} onChange={update("name")}
                      className="rounded-lg px-4 py-2.5 text-sm" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
                    <input required type="email" placeholder="Email address" value={form.email} onChange={update("email")}
                      className="rounded-lg px-4 py-2.5 text-sm" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
                    <input placeholder="Business name" value={form.business} onChange={update("business")}
                      className="rounded-lg px-4 py-2.5 text-sm" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <input placeholder="Phone number" value={form.phone} onChange={update("phone")}
                        className="rounded-lg px-4 py-2.5 text-sm" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
                      <input placeholder="City" value={form.city} onChange={update("city")}
                        className="rounded-lg px-4 py-2.5 text-sm" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
                    </div>
                    <textarea placeholder="What are you looking to solve?" value={form.message} onChange={update("message")} rows={3}
                      className="rounded-lg px-4 py-2.5 text-sm resize-none" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
                    <motion.button whileTap={{ scale: 0.97 }} type="submit" disabled={demoBusy} className="land-pos-btn rounded-full px-6 py-3 font-bold text-white disabled:opacity-60" style={{ background: "var(--pos-accent)" }}>
                      {demoBusy ? "Sending…" : "Contact us"}
                    </motion.button>
                  </form>
                )}
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* Footer */}
      <footer style={{ background: "#121014", color: "#A39D95" }}>
        <div className="max-w-7xl mx-auto px-6 py-12">
          <div className="grid grid-cols-2 md:grid-cols-[1.4fr_1fr_1fr_1fr] gap-8">
            <div className="col-span-2 md:col-span-1">
              {/* Full lockup's wordmark is dark brown, illegible on this dark
                  footer — crop to just the orange mark and set the name as
                  real, theme-colored text instead of an inverted image. */}
              <div className="flex items-center gap-2 mb-3">
                <div className="h-7 w-7 overflow-hidden rounded-md shrink-0">
                  <img src="/kanda-logo.png" alt="Kanda POS" className="h-7 w-auto max-w-none" />
                </div>
                <span className="font-bold text-white text-sm">KANDA POS</span>
              </div>
              <div className="text-sm max-w-[240px]" style={{ color: "#A39D95" }}>Point of sale software for restaurants and retail, built in Hyderabad.</div>
            </div>
            <div>
              <div className="text-white text-xs uppercase tracking-wider font-bold mb-3.5">Product</div>
              <a href="#live" className="block text-sm mb-2 hover:text-white transition-colors">Live view</a>
              <a href="#features" className="block text-sm mb-2 hover:text-white transition-colors">Features</a>
              <a href="#gst" className="block text-sm mb-2 hover:text-white transition-colors">GST</a>
            </div>
            <div>
              <div className="text-white text-xs uppercase tracking-wider font-bold mb-3.5">Company</div>
              <a href="#contact" className="block text-sm mb-2 hover:text-white transition-colors">Contact</a>
              <Link to="/privacy" className="block text-sm mb-2 hover:text-white transition-colors">Privacy</Link>
              <Link to="/terms" className="block text-sm mb-2 hover:text-white transition-colors">Terms</Link>
            </div>
            <div>
              <div className="text-white text-xs uppercase tracking-wider font-bold mb-3.5">Reach us</div>
              <div className="text-sm mb-2">connect@kandapos.com</div>
              <div className="text-sm mb-2">+91 90009 90209</div>
              <div className="text-sm mb-2">Hyderabad, India</div>
            </div>
          </div>
          <div className="mt-10 pt-6 text-sm" style={{ borderTop: "1px solid #2A2730" }}>
            © {new Date().getFullYear()} Kanda Solutions Pvt Ltd. All rights reserved.
          </div>
          <div className="land-display text-[17vw] lg:text-[15rem] leading-[0.8] text-center select-none mt-10 -mb-4 whitespace-nowrap" style={{ color: "#2A2730" }} aria-hidden="true">
            KANDA POS
          </div>
        </div>
      </footer>

      {/* Mobile floating quick-contact button — WhatsApp, email, Instagram.
          No phone/call option, matching the contact section above. */}
      <div className="md:hidden fixed bottom-5 right-5 z-30 flex flex-col items-end gap-3">
        <AnimatePresence>
          {fabOpen && (
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.9 }}
              transition={{ duration: 0.15 }}
              className="flex flex-col items-end gap-2.5"
            >
              <a href="https://wa.me/919000990209" target="_blank" rel="noopener noreferrer"
                onClick={() => setFabOpen(false)}
                className="flex items-center gap-2.5 pl-4 pr-1.5 py-1.5 rounded-full shadow-lg" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
                <span className="text-sm font-semibold" style={{ color: "var(--pos-text)" }}>WhatsApp</span>
                <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "#25D366" }}>
                  <MessageCircle className="w-4.5 h-4.5 text-white" />
                </span>
              </a>
              <a href="mailto:connect@kandapos.com"
                onClick={() => setFabOpen(false)}
                className="flex items-center gap-2.5 pl-4 pr-1.5 py-1.5 rounded-full shadow-lg" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
                <span className="text-sm font-semibold" style={{ color: "var(--pos-text)" }}>Email</span>
                <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--pos-blue)" }}>
                  <Mail className="w-4.5 h-4.5 text-white" />
                </span>
              </a>
              <a href="https://www.instagram.com/kanda.pos" target="_blank" rel="noopener noreferrer"
                onClick={() => setFabOpen(false)}
                className="flex items-center gap-2.5 pl-4 pr-1.5 py-1.5 rounded-full shadow-lg" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
                <span className="text-sm font-semibold" style={{ color: "var(--pos-text)" }}>Instagram</span>
                <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg,#F58529,#DD2A7B,#8134AF)" }}>
                  <Instagram className="w-4.5 h-4.5 text-white" />
                </span>
              </a>
            </motion.div>
          )}
        </AnimatePresence>
        <motion.button
          type="button"
          onClick={() => setFabOpen((v) => !v)}
          whileTap={{ scale: 0.94 }}
          aria-label={fabOpen ? "Close quick contact menu" : "Open quick contact menu"}
          aria-expanded={fabOpen}
          className="w-14 h-14 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "var(--pos-accent)", boxShadow: "0 10px 24px -8px rgba(0,0,0,0.4)" }}
        >
          {fabOpen ? <X className="w-6 h-6 text-white" /> : <Plus className="w-6 h-6 text-white" />}
        </motion.button>
      </div>
    </div>
    </MotionConfig>
  );
}
