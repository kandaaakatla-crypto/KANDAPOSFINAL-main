import React, { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform, useMotionValue, useSpring, useInView, animate } from "framer-motion";
import Lenis from "lenis";

// Page-level motion for the marketing homepage: smooth scrolling, a cursor
// follower, magnetic buttons, pinned scroll scenes and count-ups. All of it backs off under prefers-reduced-motion.

const EASE = [0.22, 1, 0.36, 1];

export function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function finePointer() {
  try {
    return window.matchMedia("(pointer: fine)").matches;
  } catch {
    return false;
  }
}

/** Inertial smooth scrolling (Lenis) for the lifetime of the page. In-page
 *  #anchor links are routed through Lenis so they glide too. */
export function useSmoothScroll() {
  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    const lenis = new Lenis({ duration: 1.15, smoothWheel: true });
    let raf;
    const loop = (t) => { lenis.raf(t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    const onClick = (e) => {
      const a = e.target.closest?.('a[href^="#"]');
      if (!a) return;
      const target = document.querySelector(a.getAttribute("href"));
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target, { offset: -72 });
    };
    document.addEventListener("click", onClick);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("click", onClick);
      lenis.destroy();
    };
  }, []);
}

/** A soft ring that trails the mouse and swells over links and buttons. */
export function CursorFollower() {
  const [enabled] = useState(() => finePointer() && !prefersReducedMotion());
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const sx = useSpring(x, { stiffness: 500, damping: 40, mass: 0.5 });
  const sy = useSpring(y, { stiffness: 500, damping: 40, mass: 0.5 });
  const [hover, setHover] = useState(false);
  useEffect(() => {
    if (!enabled) return undefined;
    const move = (e) => {
      x.set(e.clientX); y.set(e.clientY);
      setHover(!!e.target.closest?.("a, button, input, textarea, [role=button]"));
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [enabled, x, y]);
  if (!enabled) return null;
  return (
    <motion.div
      className="pointer-events-none fixed left-0 top-0 z-[55] rounded-full"
      style={{ x: sx, y: sy, translateX: "-50%", translateY: "-50%", border: "1.5px solid #F97316", mixBlendMode: "multiply" }}
      animate={{ width: hover ? 56 : 22, height: hover ? 56 : 22, backgroundColor: hover ? "rgba(249,115,22,0.18)" : "rgba(249,115,22,0)" }}
      transition={{ duration: 0.25, ease: EASE }}
      aria-hidden="true"
    />
  );
}

/** Wraps a button or link so it leans toward the cursor while hovered. */
export function Magnetic({ children, strength = 0.35, className = "" }) {
  const ref = useRef(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 250, damping: 18 });
  const sy = useSpring(y, { stiffness: 250, damping: 18 });
  const onMove = (e) => {
    if (e.pointerType !== "mouse") return;
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  };
  const reset = () => { x.set(0); y.set(0); };
  return (
    <motion.div ref={ref} className={`inline-block ${className}`} style={{ x: sx, y: sy }} onPointerMove={onMove} onPointerLeave={reset}>
      {children}
    </motion.div>
  );
}

/** Counts up to `to` the first time it scrolls into view. */
export function CountUp({ to, suffix = "", className = "" }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!inView) return undefined;
    if (prefersReducedMotion()) { setVal(to); return undefined; }
    const c = animate(0, to, { duration: 1.6, ease: EASE, onUpdate: (v) => setVal(Math.round(v)) });
    return () => c.stop();
  }, [inView, to]);
  return <span ref={ref} className={className}>{val}{suffix}</span>;
}

function StackCard({ card, i, total, progress }) {
  // Each card shrinks and dims a little as the ones after it slide over.
  const start = i / total;
  const scale = useTransform(progress, [start, 1], [1, 1 - (total - i) * 0.04]);
  const dim = useTransform(progress, [start, 1], [0, (total - 1 - i) * 0.12]);
  return (
    <div className="sticky h-[78vh] md:h-[82vh] flex items-start justify-center" style={{ top: `calc(11vh + ${i * 18}px)` }}>
      <motion.div
        style={{ scale, background: `linear-gradient(150deg, ${card.from} 0%, ${card.to} 85%)`, transformOrigin: "top center" }}
        className="relative w-full max-w-6xl h-[70vh] md:h-[66vh] rounded-[2rem] overflow-hidden text-white grid grid-rows-[auto_1fr] md:grid-rows-1 md:grid-cols-[0.9fr_1.1fr] gap-4 md:gap-6 p-6 md:p-12 shadow-2xl"
      >
        <motion.div className="absolute inset-0 bg-black pointer-events-none" style={{ opacity: dim }} />
        <div className="relative flex flex-col justify-between">
          <div className="text-xs font-mono opacity-70">({String(i + 1).padStart(2, "0")}/{String(total).padStart(2, "0")})</div>
          <div>
            <div className="land-display text-4xl md:text-6xl mb-4">{card.title}</div>
            <p className="text-base md:text-lg max-w-md" style={{ color: "rgba(255,255,255,0.82)" }}>{card.body}</p>
          </div>
        </div>
        <div className="relative flex items-start md:items-center justify-center order-first md:order-none max-h-[34vh] md:max-h-none origin-top scale-[0.78] md:scale-100">{card.visual}</div>
      </motion.div>
    </div>
  );
}

/** Full-bleed cards that pin and stack on top of each other as you scroll. */
export function StackCards({ cards }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  return (
    <div ref={ref} className="relative px-4 md:px-6">
      {cards.map((c, i) => <StackCard key={c.title} card={c} i={i} total={cards.length} progress={scrollYProgress} />)}
    </div>
  );
}

/** A tall section whose inner strip slides sideways while it stays pinned:
 *  vertical scroll drives a horizontal journey through `panels`. */
export function HorizontalScroll({ panels, heading }) {
  const ref = useRef(null);
  const track = useRef(null);
  const [dist, setDist] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const x = useTransform(scrollYProgress, [0, 1], [0, -dist]);
  const bar = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);
  useEffect(() => {
    const measure = () => {
      const el = track.current;
      if (el) setDist(Math.max(0, el.scrollWidth - window.innerWidth));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [panels.length]);
  return (
    <section ref={ref} className="relative" style={{ height: `${panels.length * 85 + 60}vh` }}>
      <div className="sticky top-0 h-screen overflow-hidden flex flex-col justify-center" style={{ background: "#121014" }}>
        <div className="px-6 md:px-16 mb-8 md:mb-12 flex items-end justify-between gap-6 text-white">
          {heading}
          <div className="hidden md:block w-48 h-[2px] rounded-full overflow-hidden mb-3" style={{ background: "rgba(255,255,255,0.15)" }}>
            <motion.div className="h-full" style={{ width: bar, background: "#F97316" }} />
          </div>
        </div>
        <motion.div ref={track} style={{ x }} className="flex gap-5 md:gap-8 px-6 md:px-16 w-max">
          {panels.map((p) => (
            <div key={p.time} className="relative w-[82vw] md:w-[38vw] h-[58vh] md:h-[56vh] rounded-[1.75rem] overflow-hidden p-7 md:p-10 flex flex-col justify-between text-white shrink-0"
              style={{ background: `linear-gradient(160deg, ${p.from} 0%, ${p.to} 85%)` }}>
              <div className="flex items-center justify-between">
                <span className="land-display text-6xl md:text-8xl tabular-nums">{p.time}</span>
                <p.icon className="w-8 h-8 opacity-90" />
              </div>
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none opacity-90">{p.visual}</div>
              <div>
                <div className="land-display text-3xl md:text-4xl mb-2">{p.title}</div>
                <p className="text-sm md:text-base max-w-sm" style={{ color: "rgba(255,255,255,0.82)" }}>{p.body}</p>
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
