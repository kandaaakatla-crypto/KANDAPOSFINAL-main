import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Store, ShoppingCart, LayoutGrid, ChefHat,
  Truck, Boxes, Users, BarChart3, MessageCircle, Mic, MapPin, Mail, Phone,
  ArrowRight, CheckCircle2, Sparkles, ShoppingBag, Menu, X, Wallet, Star,
} from "lucide-react";

const CYCLE_WORDS = ["order", "ticket", "sale", "table", "delivery", "refund"];

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

const STATS = [
  { value: "4", label: "Order & sale channels: dine-in, collection, delivery, retail" },
  { value: "10", label: "Core modules, one login" },
  { value: "24/7", label: "Live sync across every till & station" },
  { value: "1", label: "Owner portal for every location" },
];

const TICKET_MOCKS = [
  {
    tag: "Dine-In",
    orderId: "Order #1042",
    lines: [
      ["2× Pepperoni Passion (M)", "₹798"],
      ["1× Veggie Supreme (M)", "₹379"],
      ["3× Garlic Bread (4pc)", "₹387"],
    ],
    total: "₹1,564",
  },
  {
    tag: "Retail Sale",
    orderId: "Sale #R-0231",
    lines: [
      ["1× Wireless Earbuds", "₹1,999"],
      ["1× 20000mAh Power Bank", "₹1,499"],
      ["2× USB-C Cable 1m", "₹598"],
    ],
    total: "₹4,096",
  },
];

const NAV_LINKS = [
  { href: "#about", label: "About" },
  { href: "#features", label: "Features" },
  { href: "#demo", label: "Contact & Demo" },
];

const MARQUEE_ITEMS = [
  { label: "Dine-in", icon: LayoutGrid },
  { label: "Delivery", icon: Truck },
  { label: "Collection", icon: ShoppingBag },
  { label: "Retail Checkout", icon: ShoppingCart },
  { label: "Kitchen Display", icon: ChefHat },
  { label: "Inventory", icon: Boxes },
  { label: "Payroll", icon: Wallet },
  { label: "Loyalty", icon: Star },
  { label: "Reports", icon: BarChart3 },
  { label: "Multi-location", icon: MapPin },
];

const PORTALS = [
  { label: "Demo Restaurant POS", desc: "Staff terminal: orders, tables, kitchen, dispatch", icon: Store, to: "/login" },
  { label: "Demo Retail POS: Urban Mart", desc: "Staff terminal: basket checkout, barcode scan, variants", icon: ShoppingBag, to: "/login?tenant=urbanmart" },
];

const GET_STARTED_ID = "get-started";

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
    <div className="inline-flex items-center gap-1.5 text-xs font-bold tracking-[0.3em] uppercase mb-3 px-3 py-1 rounded-full" style={{ color: "var(--pos-accent)", border: "1px solid var(--pos-border)" }}>
      <Sparkles className="w-3 h-3" /> {children}
    </div>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", phone: "", business: "", message: "" });
  const [submitted, setSubmitted] = useState(false);
  const [wordIdx, setWordIdx] = useState(0);
  const [ticketIdx, setTicketIdx] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setWordIdx((i) => (i + 1) % CYCLE_WORDS.length), 1800);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTicketIdx((i) => (i + 1) % TICKET_MOCKS.length), 3600);
    return () => clearInterval(t);
  }, []);

  const ticket = TICKET_MOCKS[ticketIdx];

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submitDemo = (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      toast.error("Please fill in your name and email.");
      return;
    }
    setSubmitted(true);
    toast.success("Thanks! Our team will reach out to schedule your demo.");
  };

  return (
    <div style={{ background: "var(--pos-bg)", color: "var(--pos-text)" }} className="overflow-x-hidden" data-testid="landing-page">
      {/* Nav */}
      <header className="sticky top-0 z-20" style={{ background: "rgba(11,18,32,0.75)", backdropFilter: "blur(10px)", borderBottom: "1px solid var(--pos-border)" }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <motion.img whileHover={{ scale: 1.03 }} src="/kanda-logo.png" alt="Kanda POS" className="h-8 w-auto" />
          <nav className="hidden md:flex items-center gap-8 text-sm" style={{ color: "var(--pos-muted)" }}>
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} className="hover:text-white transition-colors">{l.label}</a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <a href={`#${GET_STARTED_ID}`} className="pos-btn rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
              Login
            </a>
            <button
              type="button"
              className="md:hidden rounded-lg p-2"
              style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}
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
                    className="py-3 text-sm hover:text-white transition-colors"
                    style={{ color: "var(--pos-muted)", borderBottom: "1px solid var(--pos-border)" }}
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
        <div className="land-blob-b absolute top-10 -right-40 w-[30rem] h-[30rem] rounded-full" style={{ background: "radial-gradient(circle, #2563eb 0%, transparent 70%)", filter: "blur(80px)", opacity: 0.3 }} />

        <div className="relative max-w-6xl mx-auto px-6 pt-24 pb-20 text-center">
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <SectionLabel>Point of sale, built for restaurants &amp; retail</SectionLabel>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1 }}
            className="text-5xl md:text-7xl font-bold leading-[1.05] mb-6"
          >
            Every{" "}
            <motion.span
              key={wordIdx}
              className="relative inline-block land-gradient-text"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
            >
              {CYCLE_WORDS[wordIdx]}
            </motion.span>
            .<br />One screen.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.2 }}
            className="text-lg max-w-2xl mx-auto mb-10" style={{ color: "var(--pos-muted)" }}
          >
            Kanda POS runs dine-in, collection, delivery and in-store retail sales, handling
            kitchen tickets, barcode checkout, staff, inventory and reporting for busy
            restaurants and retail stores, all from one system.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-wrap items-center justify-center gap-4"
          >
            <a href="#demo" className="pos-btn rounded-xl px-6 py-3 font-semibold text-white flex items-center gap-2" style={{ background: "var(--pos-accent)" }}>
              Talk to us <ArrowRight className="w-4 h-4" />
            </a>
            <a href={`#${GET_STARTED_ID}`} className="pos-btn rounded-xl px-6 py-3 font-semibold text-white" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
              Explore the demo
            </a>
          </motion.div>
        </div>

        {/* Marquee */}
        <div className="relative py-4" style={{ borderTop: "1px solid var(--pos-border)", borderBottom: "1px solid var(--pos-border)", background: "var(--pos-panel)" }}>
          <div className="land-marquee-track">
            {[...Array(2)].map((_, rep) => (
              <div key={rep} className="flex items-center gap-10 pr-10 shrink-0">
                {MARQUEE_ITEMS.map(({ label, icon: Icon }) => (
                  <span key={label} className="flex items-center gap-2 text-sm font-semibold whitespace-nowrap" style={{ color: "var(--pos-muted)" }}>
                    <Icon className="w-3.5 h-3.5" style={{ color: "var(--pos-accent)" }} /> {label}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {STATS.map((s, i) => (
            <Reveal key={s.label} delay={i * 0.08} className="text-center">
              <div className="text-4xl md:text-5xl font-bold land-gradient-text mb-1">{s.value}</div>
              <div className="text-xs" style={{ color: "var(--pos-muted)" }}>{s.label}</div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* About */}
      <section id="about" className="max-w-6xl mx-auto px-6 py-20" style={{ borderTop: "1px solid var(--pos-border)" }}>
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <Reveal>
            <SectionLabel>About Kanda POS</SectionLabel>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">One system, every part of the business</h2>
            <p style={{ color: "var(--pos-muted)" }} className="leading-relaxed mb-4">
              Kanda POS was built for busy, high-volume restaurants and retail stores that
              can't afford a terminal that freezes, a kitchen ticket that gets lost, or a
              till that can't keep up. It brings the front of house or shop floor, the
              kitchen or stockroom, delivery drivers, and the back office onto a single
              connected platform.
            </p>
            <p style={{ color: "var(--pos-muted)" }} className="leading-relaxed">
              Multi-location and multi-tenant from day one, a restaurant group or retail
              chain can run every store from one owner portal, while each location's staff
              only ever see their own till.
            </p>
          </Reveal>

          {/* Stylized ticket mockup — alternates between a restaurant order and a retail sale */}
          <Reveal delay={0.15}>
            <div className="mx-auto max-w-sm">
              <AnimatePresence mode="wait">
                <motion.div
                  key={ticket.tag}
                  whileHover={{ rotate: 0 }}
                  initial={{ opacity: 0, y: 10, rotate: -3 }}
                  animate={{ opacity: 1, y: 0, rotate: -3 }}
                  exit={{ opacity: 0, y: -10, rotate: -3 }}
                  transition={{ duration: 0.3 }}
                  className="rounded-2xl p-6"
                  style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)", boxShadow: "0 20px 60px -20px rgba(249,115,22,0.25)" }}
                >
                  <div className="flex items-center justify-between mb-4 pb-4" style={{ borderBottom: "1px dashed var(--pos-border)" }}>
                    <span className="font-bold text-sm">{ticket.orderId}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: "rgba(249,115,22,0.15)", color: "var(--pos-accent)" }}>{ticket.tag}</span>
                  </div>
                  {ticket.lines.map(([item, price], i) => (
                    <motion.div
                      key={item}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.1 + i * 0.1 }}
                      className="flex items-center justify-between text-sm py-1.5"
                    >
                      <span>{item}</span>
                      <span style={{ color: "var(--pos-muted)" }}>{price}</span>
                    </motion.div>
                  ))}
                  <div className="flex items-center justify-between mt-4 pt-4 font-bold" style={{ borderTop: "1px dashed var(--pos-border)" }}>
                    <span>Total</span>
                    <span style={{ color: "var(--pos-accent)" }}>{ticket.total}</span>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Features — bento grid */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-20" style={{ borderTop: "1px solid var(--pos-border)" }}>
        <Reveal className="text-center mb-14">
          <SectionLabel>Features</SectionLabel>
          <h2 className="text-3xl md:text-4xl font-bold">Everything a restaurant or retail store needs to run</h2>
        </Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 auto-rows-fr">
          {FEATURES.map(({ icon: Icon, title, desc, big }, i) => (
            <Reveal key={title} delay={(i % 3) * 0.06} className={big ? "sm:col-span-2" : ""}>
              <div className="land-card h-full rounded-2xl p-6" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4" style={{ background: "linear-gradient(135deg, var(--pos-accent), #ea580c)" }}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <div className="font-semibold text-lg mb-1.5">{title}</div>
                <div className="text-sm" style={{ color: "var(--pos-muted)" }}>{desc}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Demo request + Contact — split panel */}
      <section id="demo" className="max-w-6xl mx-auto px-6 py-20" style={{ borderTop: "1px solid var(--pos-border)" }}>
        <div className="grid md:grid-cols-2 rounded-3xl overflow-hidden" style={{ border: "1px solid var(--pos-border)" }}>
          {/* Left — contact info, accent panel */}
          <Reveal className="p-10 flex flex-col justify-between" style={{ background: "linear-gradient(160deg, var(--pos-accent) 0%, #c2410c 100%)" }}>
            <div>
              <div className="text-xs font-bold tracking-[0.3em] uppercase mb-4 text-white/80">Contact &amp; Demo</div>
              <h2 className="text-3xl font-bold mb-4 text-white">Let's get your business on Kanda POS</h2>
              <p className="text-white/85 leading-relaxed">
                Tell us about your restaurant or retail store and we'll set up a walkthrough,
                or reach us directly using the details below.
              </p>
            </div>
            <div className="flex flex-col gap-4 mt-10">
              <a href="mailto:connect@kandapos.com" className="flex items-center gap-3 text-white">
                <Mail className="w-5 h-5 shrink-0" /> connect@kandapos.com
              </a>
              <a href="tel:+919000990209" className="flex items-center gap-3 text-white">
                <Phone className="w-5 h-5 shrink-0" /> +91 90009 90209
              </a>
              <div className="flex items-center gap-3 text-white">
                <MapPin className="w-5 h-5 shrink-0" /> Hyderabad, India
              </div>
            </div>
          </Reveal>

          {/* Right — form */}
          <Reveal delay={0.1} className="p-10" style={{ background: "var(--pos-panel)" }}>
            {submitted ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <CheckCircle2 className="w-12 h-12 mb-3" style={{ color: "var(--pos-accent)" }} />
                <div className="font-semibold text-lg mb-1">Request received</div>
                <div className="text-sm" style={{ color: "var(--pos-muted)" }}>We'll be in touch at {form.email} shortly.</div>
              </div>
            ) : (
              <form onSubmit={submitDemo} className="grid gap-4">
                <input required placeholder="Your name" value={form.name} onChange={update("name")}
                  className="rounded-lg px-4 py-2.5 text-sm" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
                <input required type="email" placeholder="Email address" value={form.email} onChange={update("email")}
                  className="rounded-lg px-4 py-2.5 text-sm" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
                <div className="grid grid-cols-2 gap-4">
                  <input placeholder="Phone number" value={form.phone} onChange={update("phone")}
                    className="rounded-lg px-4 py-2.5 text-sm" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
                  <input placeholder="Business name" value={form.business} onChange={update("business")}
                    className="rounded-lg px-4 py-2.5 text-sm" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
                </div>
                <textarea placeholder="What are you looking to solve?" value={form.message} onChange={update("message")} rows={3}
                  className="rounded-lg px-4 py-2.5 text-sm resize-none" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
                <motion.button whileTap={{ scale: 0.97 }} type="submit" className="rounded-lg px-6 py-3 font-semibold text-white" style={{ background: "var(--pos-accent)" }}>
                  Request Demo
                </motion.button>
              </form>
            )}
          </Reveal>
        </div>
      </section>

      {/* Get started / portals */}
      <section id={GET_STARTED_ID} className="max-w-4xl mx-auto px-6 py-20" style={{ borderTop: "1px solid var(--pos-border)" }}>
        <Reveal className="text-center mb-10">
          <SectionLabel>Get Started</SectionLabel>
          <h2 className="text-3xl md:text-4xl font-bold">Try the live demo</h2>
        </Reveal>
        <div className="flex flex-col gap-3">
          {PORTALS.map(({ label, desc, icon: Icon, to }, i) => (
            <Reveal key={to} delay={i * 0.08}>
              <motion.button
                whileHover={{ x: 4 }}
                onClick={() => navigate(to)}
                className="w-full flex items-center gap-4 rounded-xl px-5 py-4 text-left transition-colors land-card"
                style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}
              >
                <div className="w-11 h-11 shrink-0 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-panel-2)" }}>
                  <Icon className="w-5 h-5" style={{ color: "var(--pos-accent)" }} />
                </div>
                <div>
                  <div className="text-base font-semibold text-white">{label}</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--pos-muted)" }}>{desc}</div>
                </div>
                <ArrowRight className="w-4 h-4 ml-auto shrink-0" style={{ color: "var(--pos-muted)" }} />
              </motion.button>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="relative overflow-hidden" style={{ borderTop: "1px solid var(--pos-border)" }}>
        <div className="absolute inset-x-0 -bottom-10 text-center select-none pointer-events-none font-bold text-[7rem] md:text-[10rem] leading-none opacity-[0.04] whitespace-nowrap">
          KANDA POS
        </div>
        <div className="relative max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm" style={{ color: "var(--pos-muted)" }}>
          <div className="flex items-center gap-2">
            <Store className="w-4 h-4" style={{ color: "var(--pos-accent)" }} />
            <span>© {new Date().getFullYear()} Kanda POS. All rights reserved.</span>
          </div>
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
