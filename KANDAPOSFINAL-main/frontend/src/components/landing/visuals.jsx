import React from "react";
import { motion } from "framer-motion";

// Product "screenshots" for the stacking-card scenes, drawn in HTML/SVG so
// they stay sharp, weigh nothing and can animate. Each one plays once when
// it scrolls into view.

const EASE = [0.22, 1, 0.36, 1];
const inView = { initial: "hidden", whileInView: "show", viewport: { once: true, margin: "-80px" } };
const stagger = (s = 0.12) => ({ hidden: {}, show: { transition: { staggerChildren: s } } });
const up = { hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } } };

const glass = { background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.18)", backdropFilter: "blur(8px)" };

export function OrderScreenMock() {
  const items = [["Hyderabadi Biryani", "₹320"], ["Chicken 65", "₹220"], ["Irani Chai ×2", "₹40"], ["Double ka Meetha", "₹120"]];
  return (
    <motion.div {...inView} variants={stagger()} className="w-full max-w-md rounded-2xl p-5 text-white" style={glass}>
      <div className="flex justify-between text-sm font-bold mb-4"><span>Table 4 · Dine in</span><span className="opacity-70">#142</span></div>
      {items.map(([n, p]) => (
        <motion.div key={n} variants={up} className="flex justify-between py-2.5 text-sm" style={{ borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
          <span>{n}</span><span className="font-mono">{p}</span>
        </motion.div>
      ))}
      <motion.div variants={up} className="flex justify-between items-end pt-4">
        <span className="text-xs opacity-70">incl. GST 5%</span>
        <span className="land-display text-4xl">₹735</span>
      </motion.div>
      <motion.div variants={up} className="mt-4 rounded-full py-3 text-center text-sm font-bold" style={{ background: "#fff", color: "#9A3412" }}>Send to kitchen →</motion.div>
    </motion.div>
  );
}

export function KdsMock() {
  const tickets = [
    { id: 141, station: "Grill", items: ["Chicken 65", "Seekh kebab"], t: "04:12", hot: true },
    { id: 142, station: "Biryani", items: ["Hyderabadi Biryani ×2"], t: "02:40" },
    { id: 143, station: "Bar", items: ["Irani Chai ×2", "Lime soda"], t: "00:35" },
  ];
  return (
    <motion.div {...inView} variants={stagger(0.18)} className="w-full max-w-md grid gap-3">
      {tickets.map((k) => (
        <motion.div key={k.id} variants={{ hidden: { opacity: 0, x: 60 }, show: { opacity: 1, x: 0, transition: { duration: 0.6, ease: EASE } } }}
          className="rounded-xl p-4 text-white" style={glass}>
          <div className="flex justify-between text-xs font-bold mb-2">
            <span>#{k.id} · {k.station}</span>
            <span className="font-mono px-2 py-0.5 rounded-full" style={{ background: k.hot ? "#DC2626" : "rgba(255,255,255,0.18)" }}>{k.t}</span>
          </div>
          {k.items.map((i) => <div key={i} className="text-sm">{i}</div>)}
        </motion.div>
      ))}
    </motion.div>
  );
}

export function DispatchMock() {
  const route = "M40 220 C 120 200, 140 120, 220 120 S 320 60, 380 50";
  return (
    <div className="w-full max-w-md rounded-2xl p-4 text-white" style={glass}>
      <svg viewBox="0 0 420 260" className="w-full h-auto" aria-hidden="true">
        {[...Array(7)].map((_, i) => <line key={`h${i}`} x1="0" x2="420" y1={i * 40 + 10} y2={i * 40 + 10} stroke="rgba(255,255,255,0.08)" />)}
        {[...Array(11)].map((_, i) => <line key={`v${i}`} y1="0" y2="260" x1={i * 40 + 10} x2={i * 40 + 10} stroke="rgba(255,255,255,0.08)" />)}
        <motion.path d={route} fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeDasharray="1 0"
          initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 2, ease: "easeInOut" }} />
        <circle cx="40" cy="220" r="9" fill="#fff" />
        <circle cx="380" cy="50" r="9" fill="#F97316" stroke="#fff" strokeWidth="3" />
        <motion.circle r="7" fill="#FDE68A"
          style={{ offsetPath: `path("${route}")` }}
          initial={{ offsetDistance: "0%" }} whileInView={{ offsetDistance: "100%" }} viewport={{ once: true }}
          transition={{ duration: 2, ease: "easeInOut" }} />
      </svg>
      <div className="flex justify-between text-xs mt-2"><span>Ravi · on the way</span><span className="font-bold">ETA 12 min</span></div>
    </div>
  );
}

export function ReportsMock() {
  const bars = [32, 48, 40, 66, 90, 72, 54, 80, 98, 60];
  return (
    <div className="w-full max-w-md rounded-2xl p-5 text-white" style={glass}>
      <div className="flex justify-between items-end mb-4">
        <div><div className="text-xs opacity-70">Today's sales</div><div className="land-display text-4xl">₹48,260</div></div>
        <span className="text-xs font-bold px-2 py-1 rounded-full" style={{ background: "rgba(34,197,94,0.25)" }}>▲ 12% vs last Tue</span>
      </div>
      <motion.div {...inView} variants={stagger(0.06)} className="flex items-end gap-2 h-40">
        {bars.map((h, i) => (
          <motion.div key={i} className="flex-1 rounded-t-md" style={{ background: i === 8 ? "#fff" : "rgba(255,255,255,0.35)", transformOrigin: "bottom" }}
            variants={{ hidden: { scaleY: 0 }, show: { scaleY: 1, transition: { duration: 0.7, ease: EASE } } }}>
            <div style={{ height: `${h * 1.6}px` }} />
          </motion.div>
        ))}
      </motion.div>
      <div className="flex justify-between text-[10px] opacity-60 mt-2"><span>11am</span><span>3pm</span><span>9pm</span></div>
    </div>
  );
}

/** Small looping pulse rings, used as the backdrop of the "day" panels. */
export function PulseRings({ color = "#fff" }) {
  return (
    <div className="relative w-40 h-40">
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="absolute inset-0 rounded-full" style={{ border: `1.5px solid ${color}` }}
          initial={{ scale: 0.3, opacity: 0.6 }} animate={{ scale: 1.4, opacity: 0 }}
          transition={{ duration: 3, repeat: Infinity, delay: i, ease: "easeOut" }} />
      ))}
    </div>
  );
}
