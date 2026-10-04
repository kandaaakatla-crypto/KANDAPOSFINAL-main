import React, { useEffect, useRef, useState } from "react";
import { m, useScroll, useTransform, useInView, AnimatePresence, animate } from "framer-motion";
import { CheckCircle2, ChefHat, Send, CreditCard, ShoppingBag, Trash2 } from "lucide-react";
import { prefersReducedMotion } from "./immersive";

// The hero's product shot: the POS order screen rebuilt in HTML so it stays
// sharp at any size, playing out one counter order on a loop. Items are
// tapped from the menu and drop into the order, the total counts up, the
// order goes to the kitchen, it is paid by UPI and the GST bill prints.
// Menu, prices and the order match the demo restaurant (backend/seed.py).

const EASE = [0.22, 1, 0.36, 1];

const MENU = [
  { id: "gb", name: "Garlic Bread (4pc)", cat: "Sides", dot: "#F97316", price: 129 },
  { id: "cgb", name: "Cheesy Garlic Bread", cat: "Sides", dot: "#F97316", price: 169 },
  { id: "bw", name: "BBQ Wings (6pc)", cat: "Chicken", dot: "#D97706", price: 199 },
  { id: "cc", name: "Coca-Cola 330ml", cat: "Drinks", dot: "#3B82F6", price: 60 },
  { id: "cz", name: "Coke Zero 330ml", cat: "Drinks", dot: "#3B82F6", price: 60 },
  { id: "fc", name: "Chocolate Fudge Cake", cat: "Desserts", dot: "#EC4899", price: 149 },
  { id: "mg", name: "Margherita", cat: "Pizzas", dot: "#EF4444", price: 199 },
  { id: "pp", name: "Pepperoni Passion", cat: "Pizzas", dot: "#EF4444", price: 249 },
];
// Tapped in this order; 766.00 + 5% GST = ₹804.30.
const ORDER = ["gb", "cgb", "bw", "cc", "cz", "fc"];
const byId = Object.fromEntries(MENU.map((it) => [it.id, it]));
const CATS = ["Pizzas", "Sides", "Chicken", "Drinks", "Desserts"];

// Timeline (ms) for one loop.
const TAP = 1000;
const T_SEND = ORDER.length * TAP + 700;
const T_SENT = T_SEND + 600;
const T_PAY = T_SENT + 1900;
const T_PAID = T_PAY + 600;
const T_LOOP = T_PAID + 5200;

const inr = (n) => `₹${n.toFixed(2)}`;

/** A number that glides to its new value. */
function Ticker({ value, className = "", style }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const c = animate(from.current, value, { duration: 0.6, ease: EASE, onUpdate: setShown });
    from.current = value;
    return () => c.stop();
  }, [value]);
  return <span className={`tabular-nums ${className}`} style={style}>{inr(shown)}</span>;
}

// The moments something on screen changes; the loop sleeps in between
// instead of re-rendering on a fixed tick.
const BEATS = [...new Set([
  ...ORDER.flatMap((_, i) => [i * TAP, i * TAP + TAP * 0.4]),
  ORDER.length * TAP, T_SEND, T_SENT, T_PAY, T_PAID,
])].sort((x, y) => x - y);

function useOrderLoop(still, active) {
  const [t, setT] = useState(still ? T_PAID : 0);
  const [loop, setLoop] = useState(0);
  // Advance to the next beat; pauses (and resumes where it left off) while
  // the panel is off screen.
  useEffect(() => {
    if (still || !active) return undefined;
    const next = BEATS.find((x) => x > t) ?? T_LOOP;
    const id = setTimeout(() => {
      if (next >= T_LOOP) { setT(0); setLoop((n) => n + 1); } else setT(next);
    }, next - t);
    return () => clearTimeout(id);
  }, [t, still, active]);
  // Each item lands in the order a little after its tile is tapped.
  const count = t < TAP * 0.4 ? 0 : Math.min(ORDER.length, Math.floor((t - TAP * 0.4) / TAP) + 1);
  const tapping = t < ORDER.length * TAP ? ORDER[Math.floor(t / TAP)] : null;
  const stage = t >= T_PAID ? "paid" : t >= T_PAY ? "paying" : t >= T_SENT ? "sent" : t >= T_SEND ? "sending" : "adding";
  return { count, tapping, stage, loop };
}

function Receipt({ lines, subtotal, gst, total }) {
  return (
    <div className="relative w-[178px]">
      <div className="relative z-10 h-4 rounded-full mx-[-8px]"
        style={{ background: "linear-gradient(180deg,#FFFFFF,#DDD6CC)", boxShadow: "0 6px 14px -6px rgba(60,35,10,0.45), inset 0 -2px 0 rgba(0,0,0,0.08)" }}>
        <div className="absolute left-3 right-3 top-[7px] h-[2px] rounded-full" style={{ background: "#1A1714" }} />
      </div>
      <div className="relative overflow-hidden -mt-2 pt-2">
        <m.div
          initial={{ y: "-100%" }}
          animate={{ y: "0%" }}
          transition={{ duration: 2.2, ease: [0.45, 0, 0.2, 1] }}
          className="land-receipt px-3.5 pt-3 pb-5 font-mono text-[10.5px] leading-[1.55]"
          style={{ color: "#1A1714" }}
        >
          <div className="text-center font-bold text-[12px] tracking-wide">DEMO RESTAURANT</div>
          <div className="text-center" style={{ color: "#6B6257" }}>GSTIN 36AAACK1234F1Z8</div>
          <div className="text-center mb-1.5" style={{ color: "#6B6257" }}>Collection #142</div>
          <div className="border-t border-dashed mb-1" style={{ borderColor: "#B9B1A6" }} />
          {lines.map((it) => (
            <div key={it.id} className="flex justify-between gap-2"><span className="truncate">{it.name}</span><span>{it.price.toFixed(2)}</span></div>
          ))}
          <div className="border-t border-dashed my-1" style={{ borderColor: "#B9B1A6" }} />
          <div className="flex justify-between" style={{ color: "#6B6257" }}><span>Subtotal</span><span>{subtotal.toFixed(2)}</span></div>
          <div className="flex justify-between" style={{ color: "#6B6257" }}><span>CGST 2.5%</span><span>{(gst / 2).toFixed(2)}</span></div>
          <div className="flex justify-between" style={{ color: "#6B6257" }}><span>SGST 2.5%</span><span>{(gst / 2).toFixed(2)}</span></div>
          <div className="flex justify-between font-bold text-[12.5px] mt-1"><span>TOTAL</span><span>{inr(total)}</span></div>
          <div className="text-center mt-2" style={{ color: "#6B6257" }}>Paid by UPI · Thank you!</div>
        </m.div>
      </div>
    </div>
  );
}

function Toast({ icon: Icon, color, title, sub, className = "" }) {
  return (
    <m.div
      initial={{ opacity: 0, y: 14, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.96 }}
      transition={{ duration: 0.45, ease: EASE }}
      className={`flex items-center gap-2.5 rounded-2xl pl-2.5 pr-4 py-2.5 ${className}`}
      style={{ background: "rgba(255,255,255,0.95)", border: "1px solid rgba(26,23,20,0.08)", boxShadow: "0 18px 40px -18px rgba(60,35,10,0.4)" }}
    >
      <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}1A` }}>
        <Icon className="w-4 h-4" style={{ color }} />
      </span>
      <span className="leading-tight">
        <span className="block text-[12px] font-bold" style={{ color: "#1A1714" }}>{title}</span>
        <span className="block text-[11px]" style={{ color: "#6B6257" }}>{sub}</span>
      </span>
    </m.div>
  );
}

export default function HeroOrderPanel() {
  const [still] = useState(() => prefersReducedMotion());
  const ref = useRef(null);
  const inView = useInView(ref, { margin: "100px" });
  const { count, tapping, stage, loop } = useOrderLoop(still, inView);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "start 0.2"] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [20, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.92, 1]);

  const lines = ORDER.slice(0, count).map((id) => byId[id]);
  const subtotal = lines.reduce((s, it) => s + it.price, 0);
  const gst = Math.round(subtotal * 5) / 100;
  const total = subtotal + gst;
  const sent = stage !== "adding" && stage !== "sending";
  const paid = stage === "paid";

  return (
    <div ref={ref} className="relative max-w-5xl mx-auto" style={{ perspective: 1800 }} aria-hidden="true">
      <div className="absolute -inset-x-[8%] top-[6%] bottom-[-8%] pointer-events-none"
        style={{ background: "radial-gradient(closest-side, rgba(249,115,22,0.18), rgba(249,115,22,0) 72%)" }} />
      <m.div initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.1, ease: EASE, delay: 0.35 }}>
        <m.div
          className="relative rounded-[18px] overflow-hidden text-left"
          style={{
            rotateX: still ? 0 : rotateX, scale: still ? 1 : scale, transformOrigin: "50% 0%",
            background: "#FDFAF4", border: "1px solid rgba(26,23,20,0.10)",
            boxShadow: "0 40px 70px -40px rgba(70,38,10,0.40), 0 18px 30px -24px rgba(0,0,0,0.25)",
          }}
        >
          {/* App bar */}
          <div className="flex items-center gap-3 px-4 md:px-5 h-12 md:h-14" style={{ background: "#FFFFFF", borderBottom: "1px solid #EFE7DA" }}>
            <img src="/kanda-logo.png" alt="" className="h-6 md:h-7 w-auto" />
            <span className="hidden sm:block w-px h-6" style={{ background: "#EFE7DA" }} />
            <span className="hidden sm:block leading-tight">
              <span className="block text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#A39D95" }}>Store</span>
              <span className="block text-[13px] font-bold" style={{ color: "#1A1714" }}>Demo Restaurant</span>
            </span>
            <span className="ml-auto flex items-center gap-2">
              <span className="hidden md:block text-xs" style={{ color: "#8A8178" }}>Sun, 4 Oct · 13:30</span>
              <span className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white" style={{ background: "#2563EB" }}>AR</span>
            </span>
          </div>

          <div className="grid md:grid-cols-[1.35fr_1fr]">
            {/* Menu */}
            <div className="p-3 md:p-5" style={{ borderRight: "1px solid #EFE7DA" }}>
              <div className="flex gap-1.5 md:gap-2 mb-3 md:mb-4 overflow-hidden">
                {CATS.map((c) => {
                  const on = tapping ? byId[tapping].cat === c : c === "Sides";
                  return (
                    <span key={c} className="shrink-0 rounded-full px-2.5 md:px-3 py-1 md:py-1.5 text-[11px] md:text-xs font-semibold transition-colors duration-300"
                      style={on ? { background: "#F97316", color: "#fff" } : { background: "#F4EDE2", color: "#6B6257" }}>{c}</span>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-2.5">
                {MENU.map((it, i) => {
                  const hot = tapping === it.id;
                  return (
                    <m.div key={it.id}
                      animate={hot ? { scale: [1, 0.94, 1.02, 1] } : { scale: 1 }}
                      transition={{ duration: 0.5, ease: "easeOut" }}
                      className={`relative rounded-xl p-2.5 md:p-3 flex flex-col justify-between min-h-[78px] md:min-h-[96px] ${i >= 6 ? "hidden lg:flex" : i >= 4 ? "hidden md:flex" : ""}`}
                      style={{ background: "#FFFFFF", border: `1.5px solid ${hot ? "#F97316" : "#EFE7DA"}`, boxShadow: hot ? "0 0 0 4px rgba(249,115,22,0.15)" : "none", transition: "border-color .25s, box-shadow .25s" }}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span className="text-[12px] md:text-[13px] font-bold leading-snug" style={{ color: "#1A1714" }}>{it.name}</span>
                        <span className="w-2 h-2 rounded-full shrink-0 mt-1" style={{ background: it.dot }} />
                      </div>
                      <span className="text-[12px] md:text-[13px] font-bold" style={{ color: "#EA580C" }}>{inr(it.price)}</span>
                    </m.div>
                  );
                })}
              </div>
            </div>

            {/* Order */}
            <div className="flex flex-col" style={{ background: "#FFFFFF" }}>
              <div className="flex items-center justify-between px-4 md:px-5 h-11 md:h-12" style={{ borderBottom: "1px solid #EFE7DA" }}>
                <span className="flex items-center gap-2 text-[13px] md:text-sm font-bold" style={{ color: "#1A1714" }}>
                  <ShoppingBag className="w-4 h-4" style={{ color: "#F97316" }} /> Collection #142
                </span>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "#F4EDE2", color: "#6B6257" }}>
                  {count} {count === 1 ? "item" : "items"}
                </span>
              </div>
              <div className="px-3 md:px-4 py-2 md:py-3 flex-1 min-h-[168px] md:min-h-[236px]">
                <AnimatePresence initial={false}>
                  {lines.map((it) => (
                    <m.div key={`${loop}-${it.id}`}
                      initial={{ opacity: 0, x: 24, height: 0 }} animate={{ opacity: 1, x: 0, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.45, ease: EASE }} className="overflow-hidden"
                    >
                      <div className="flex items-center justify-between gap-2 py-1.5 md:py-2" style={{ borderBottom: "1px dashed #EFE7DA" }}>
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="text-[11px] font-bold w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: "#F4EDE2", color: "#1A1714" }}>1</span>
                          <span className="text-[12px] md:text-[13px] font-semibold truncate" style={{ color: "#1A1714" }}>{it.name}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="text-[12px] md:text-[13px] font-bold tabular-nums" style={{ color: "#1A1714" }}>{inr(it.price)}</span>
                          <Trash2 className="hidden md:block w-3.5 h-3.5" style={{ color: "#E8A49A" }} />
                        </span>
                      </div>
                    </m.div>
                  ))}
                </AnimatePresence>
              </div>
              <div className="px-4 md:px-5 pt-2 pb-3 text-[12px] md:text-[13px]" style={{ borderTop: "1px solid #EFE7DA", color: "#6B6257" }}>
                <div className="flex justify-between"><span>Subtotal</span><Ticker value={subtotal} /></div>
                <div className="flex justify-between"><span>GST (CGST + SGST 5%)</span><Ticker value={gst} /></div>
                <div className="flex justify-between items-end mt-1.5">
                  <span className="text-sm font-bold" style={{ color: "#1A1714" }}>TOTAL</span>
                  <Ticker value={total} className="text-xl md:text-2xl font-bold" style={{ color: "#EA580C" }} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 px-3 md:px-4 pb-3 md:pb-4">
                <m.div animate={stage === "sending" ? { scale: [1, 0.93, 1] } : { scale: 1 }} transition={{ duration: 0.45 }}
                  className="flex items-center justify-center gap-1.5 rounded-xl py-2.5 md:py-3 text-[12px] md:text-[13px] font-bold text-white"
                  style={{ background: sent ? "#16A34A" : "#2563EB", transition: "background .3s" }}>
                  {sent ? <CheckCircle2 className="w-4 h-4" /> : <Send className="w-4 h-4" />} {sent ? "Sent" : "Send to Kitchen"}
                </m.div>
                <m.div animate={stage === "paying" ? { scale: [1, 0.93, 1] } : { scale: 1 }} transition={{ duration: 0.45 }}
                  className="flex items-center justify-center gap-1.5 rounded-xl py-2.5 md:py-3 text-[12px] md:text-[13px] font-bold text-white"
                  style={{ background: paid ? "#16A34A" : "#F97316", transition: "background .3s" }}>
                  {paid ? <CheckCircle2 className="w-4 h-4" /> : <CreditCard className="w-4 h-4" />} {paid ? "Paid" : `Pay ${inr(total)}`}
                </m.div>
              </div>
            </div>
          </div>
        </m.div>
      </m.div>

      {/* Moments from the order, popping up beside the screen */}
      {/* Phones show only the latest moment, above the screen; larger screens
          stack them in the empty space under the menu. */}
      <div className="absolute z-10 right-2 -top-7 md:right-auto md:top-auto md:left-[30%] md:bottom-[7%] flex flex-col items-end md:items-start gap-2">
        <AnimatePresence>
          {sent && <Toast key={`k${loop}`} icon={ChefHat} color="#F97316" title="Sent to kitchen" sub="KOT #142 · Grill" className={paid ? "hidden md:flex" : ""} />}
          {paid && <Toast key={`p${loop}`} icon={CheckCircle2} color="#16A34A" title="UPI received" sub="₹804.30 · Collection #142" />}
        </AnimatePresence>
      </div>
      <div className="hidden md:block absolute left-[-3%] lg:left-[-11%] xl:left-[-16%] bottom-[-12%] z-10" style={{ filter: "drop-shadow(0 22px 26px rgba(60,35,10,0.28))" }}>
        <AnimatePresence>
          {paid && (
            <m.div key={`r${loop}`} exit={{ opacity: 0, y: -14 }} transition={{ duration: 0.4 }} className="origin-bottom-left scale-[0.85] lg:scale-100">
              <Receipt lines={lines} subtotal={subtotal} gst={gst} total={total} />
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
