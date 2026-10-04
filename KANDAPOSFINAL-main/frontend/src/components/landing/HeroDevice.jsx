import React, { useEffect, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform, useScroll, AnimatePresence } from "framer-motion";
import { CheckCircle2, ChefHat, FileText } from "lucide-react";
import { prefersReducedMotion } from "./immersive";

// The hero's product shot: a light tablet on a stand showing a real
// screenshot of the demo POS order screen (public/landing/pos-screen.jpg:
// /demo/pos captured at 1024×768, 2× pixel density, cropped to the menu
// and the open order so item names stay legible at hero size), with the bill
// for that same order printing beside it. Plain HTML and CSS 3D transforms,
// so the screen and receipt stay pin sharp and nothing heavy is loaded.

const SCREEN_IMG = "/landing/pos-screen.jpg";
const EASE = [0.22, 1, 0.36, 1];

// Matches the order on the screenshot.
const BILL = [
  ["Garlic Bread (4pc)", "129.00"], ["Cheesy Garlic Bread", "169.00"], ["BBQ Wings (6pc)", "199.00"],
  ["Coca-Cola 330ml", "60.00"], ["Coke Zero 330ml", "60.00"], ["Chocolate Fudge Cake", "149.00"],
];

const NOTES = [
  { icon: CheckCircle2, color: "#16A34A", title: "UPI received", sub: "₹804.30 · Collection #142", pos: "left-0 top-[-7%] sm:top-[-2%] lg:left-[-4%] lg:top-[-1%]", delay: 0.9, bob: 0 },
  { icon: ChefHat, color: "#F97316", title: "Sent to kitchen", sub: "Grill · 6 items", pos: "right-0 bottom-0 lg:right-[-4%] lg:bottom-[8%]", delay: 1.1, bob: 1.2 },
  { icon: FileText, color: "#2563EB", title: "GST invoice ready", sub: "CGST + SGST ₹38.30", pos: "hidden lg:flex lg:right-[-6%] lg:top-[16%]", delay: 1.3, bob: 2.1 },
];

function Receipt({ animate }) {
  // Print, hold, tear off, repeat.
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    if (!animate) return undefined;
    const id = setInterval(() => setCycle((c) => c + 1), 7000);
    return () => clearInterval(id);
  }, [animate]);
  return (
    <div className="relative w-[150px] sm:w-[178px]">
      {/* Printer head the paper feeds out of */}
      <div className="relative z-10 h-4 rounded-full mx-[-8px]"
        style={{ background: "linear-gradient(180deg,#FFFFFF,#DDD6CC)", boxShadow: "0 6px 14px -6px rgba(60,35,10,0.45), inset 0 -2px 0 rgba(0,0,0,0.08)" }}>
        <div className="absolute left-3 right-3 top-[7px] h-[2px] rounded-full" style={{ background: "#1A1714" }} />
      </div>
      <div className="relative overflow-hidden -mt-2 pt-2">
        <AnimatePresence mode="wait" initial={animate}>
          <motion.div
            key={cycle}
            initial={animate ? { y: "-100%" } : false}
            animate={{ y: "0%", opacity: 1 }}
            exit={{ y: "-18%", opacity: 0, transition: { duration: 0.45, ease: "easeIn" } }}
            transition={{ duration: 2.4, ease: [0.45, 0, 0.2, 1] }}
            className="land-receipt px-3.5 pt-3 pb-5 font-mono text-[9.5px] sm:text-[10.5px] leading-[1.55]"
            style={{ color: "#1A1714" }}
          >
            <div className="text-center font-bold text-[11px] sm:text-[12px] tracking-wide">DEMO RESTAURANT</div>
            <div className="text-center" style={{ color: "#6B6257" }}>GSTIN 36AAACK1234F1Z8</div>
            <div className="text-center mb-1.5" style={{ color: "#6B6257" }}>Collection #142</div>
            <div className="border-t border-dashed mb-1" style={{ borderColor: "#B9B1A6" }} />
            {BILL.map(([n, p]) => (
              <div key={n} className="flex justify-between gap-2"><span className="truncate">{n}</span><span>{p}</span></div>
            ))}
            <div className="border-t border-dashed my-1" style={{ borderColor: "#B9B1A6" }} />
            <div className="flex justify-between" style={{ color: "#6B6257" }}><span>Subtotal</span><span>766.00</span></div>
            <div className="flex justify-between" style={{ color: "#6B6257" }}><span>CGST 2.5%</span><span>19.15</span></div>
            <div className="flex justify-between" style={{ color: "#6B6257" }}><span>SGST 2.5%</span><span>19.15</span></div>
            <div className="flex justify-between font-bold text-[11px] sm:text-[12.5px] mt-1"><span>TOTAL</span><span>₹804.30</span></div>
            <div className="text-center mt-2" style={{ color: "#6B6257" }}>Paid by UPI · Thank you!</div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function HeroDevice() {
  const [still] = useState(() => prefersReducedMotion());
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 90, damping: 18 });
  const sy = useSpring(py, { stiffness: 90, damping: 18 });
  const { scrollY } = useScroll();

  // Lean toward the pointer; tip back as the hero scrolls away. Phones get a
  // gentler angle so the screen stays readable at small sizes.
  const [narrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 640);
  const baseY = narrow ? -4 : -7;
  const tiltScroll = useTransform(scrollY, [0, 700], [0, 12]);
  const rotateY = useTransform(sx, (v) => baseY + v * 5);
  const rotateX = useTransform([sy, tiltScroll], ([v, s]) => 3 - v * 4 + s);

  useEffect(() => {
    if (still) return undefined;
    const move = (e) => {
      px.set((e.clientX / window.innerWidth) * 2 - 1);
      py.set((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [still, px, py]);

  return (
    <div className="relative w-full h-full flex items-center justify-center" style={{ perspective: 1600 }} aria-hidden="true">
      {/* Warm glow behind the device */}
      <div className="absolute inset-[8%] rounded-full pointer-events-none"
        style={{ background: "radial-gradient(closest-side, rgba(249,115,22,0.22), rgba(249,115,22,0) 70%)", filter: "blur(10px)" }} />
      <motion.div
        className="relative w-[86%] sm:w-[72%] lg:w-[74%] ml-auto mr-[2%]"
        initial={{ opacity: 0, y: 70, rotateX: 30 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ duration: 1.3, ease: EASE, delay: 0.2 }}
        style={{ transformStyle: "preserve-3d" }}
      >
        <motion.div style={{ rotateX: still ? 3 : rotateX, rotateY: still ? baseY : rotateY, transformStyle: "preserve-3d" }}>
          {/* Tablet */}
          <div className="relative rounded-[22px] sm:rounded-[28px] p-[7px] sm:p-[11px]"
            style={{
              background: "linear-gradient(145deg,#FFFFFF 0%,#F1ECE4 45%,#DCD4C8 100%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 0 rgba(0,0,0,0.06), 0 60px 90px -40px rgba(70,38,10,0.55), 0 24px 40px -30px rgba(0,0,0,0.35)",
            }}>
            <div className="relative rounded-[15px] sm:rounded-[18px] overflow-hidden" style={{ background: "#FDFAF4", boxShadow: "0 0 0 1px rgba(0,0,0,0.08)" }}>
              <img src={SCREEN_IMG} alt="" width={1324} height={1424} className="block w-full h-auto" decoding="async" fetchPriority="high" />
            </div>
          </div>
          {/* Stand */}
          <div className="mx-auto w-[16%] h-6 sm:h-10 -mt-px" style={{ background: "linear-gradient(90deg,#CFC6B9,#F4EFE8 45%,#C8BFB2)" }} />
          <div className="mx-auto w-[42%] h-2.5 sm:h-3.5 rounded-[999px]"
            style={{ background: "linear-gradient(180deg,#F7F3ED,#D3CABD)", boxShadow: "0 18px 30px -12px rgba(70,38,10,0.45)" }} />

          {/* Receipt, floating in front of the device */}
          <div className="absolute right-[100%] mr-[-32%] sm:mr-[-8%] bottom-[2%]"
            style={{ transform: "translateZ(80px)", filter: "drop-shadow(0 22px 26px rgba(60,35,10,0.28))" }}>
            <div className="origin-bottom-right scale-[0.56] sm:scale-[0.8] lg:scale-[0.82]"><Receipt animate={!still} /></div>
          </div>
        </motion.div>
      </motion.div>

      {/* Live events around the device */}
      {NOTES.map((n) => (
        <motion.div key={n.title}
          className={`absolute flex items-center gap-2.5 rounded-2xl pl-2.5 pr-4 py-2 sm:py-2.5 ${n.pos}`}
          style={{ background: "rgba(255,255,255,0.86)", border: "1px solid rgba(26,23,20,0.08)", backdropFilter: "blur(10px)", boxShadow: "0 18px 40px -18px rgba(60,35,10,0.35)" }}
          initial={{ opacity: 0, y: 24, scale: 0.9 }}
          animate={still ? { opacity: 1, y: 0, scale: 1 } : { opacity: 1, y: [0, -8, 0], scale: 1 }}
          transition={still ? { duration: 0 } : {
            opacity: { duration: 0.6, delay: n.delay }, scale: { duration: 0.6, delay: n.delay, ease: EASE },
            y: { duration: 4.5, repeat: Infinity, ease: "easeInOut", delay: n.delay + n.bob },
          }}
        >
          <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${n.color}1A` }}>
            <n.icon className="w-4 h-4" style={{ color: n.color }} />
          </span>
          <span className="leading-tight">
            <span className="block text-[12px] font-bold" style={{ color: "#1A1714" }}>{n.title}</span>
            <span className="block text-[11px]" style={{ color: "#6B6257" }}>{n.sub}</span>
          </span>
        </motion.div>
      ))}
    </div>
  );
}
