import React, { useRef, useState } from "react";
import { motion, useScroll, useTransform, useMotionValue, useSpring, AnimatePresence } from "framer-motion";
import { ArrowUpRight, Plus } from "lucide-react";

// Motion building blocks for the marketing homepage: editorial, agency-style
// reveals (masked word rise, scroll-lit copy, marquee, hover-follow preview).
// Everything sits inside LandingPage's <MotionConfig reducedMotion="user">,
// and the CSS marquee has its own reduced-motion stop in App.css.

const EASE = [0.22, 1, 0.36, 1];

/** Headline whose words rise out of a mask, one after another. The
 *  in-view trigger sits on the heading itself: the words start clipped by
 *  their mask, so an observer on them would never see them intersect. */
export function WordReveal({ text, className = "", delay = 0, as = "h1" }) {
  const Tag = motion[as];
  const words = text.split(" ");
  return (
    <Tag
      className={className}
      aria-label={text}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-40px" }}
      transition={{ staggerChildren: 0.06, delayChildren: delay }}
    >
      {words.map((w, i) => (
        <span key={i} className="inline-block overflow-hidden align-bottom pb-[0.08em] -mb-[0.08em]" aria-hidden="true">
          <motion.span
            className="inline-block"
            variants={{ hidden: { y: "110%" }, show: { y: "0%", transition: { duration: 0.9, ease: EASE } } }}
          >
            {w}
          </motion.span>
          {i < words.length - 1 && "\u00A0"}
        </span>
      ))}
    </Tag>
  );
}

/** Fades and lifts its children once they scroll into view. */
export function Rise({ children, delay = 0, className = "", y = 24 }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.8, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

function ScrollWord({ word, progress, range }) {
  const opacity = useTransform(progress, range, [0.16, 1]);
  return <motion.span style={{ opacity }}>{word} </motion.span>;
}

/** Large statement whose words light up as the reader scrolls through it. */
export function ScrollWords({ text, className = "" }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.85", "end 0.45"] });
  const words = text.split(" ");
  return (
    <p ref={ref} className={className} aria-label={text}>
      <span aria-hidden="true">
        {words.map((w, i) => (
          <ScrollWord key={i} word={w} progress={scrollYProgress} range={[i / words.length, (i + 1) / words.length]} />
        ))}
      </span>
    </p>
  );
}

/** Endless horizontal strip. Content is rendered twice for a seamless loop. */
export function Marquee({ children, speed = 40, className = "" }) {
  return (
    <div className={`land-marquee overflow-hidden ${className}`}>
      <div className="land-marquee-track" style={{ animationDuration: `${speed}s` }}>
        <div className="land-marquee-group">{children}</div>
        <div className="land-marquee-group" aria-hidden="true">{children}</div>
      </div>
    </div>
  );
}

/**
 * Index-style list (title · category · tag). On fine pointers a preview card
 * follows the cursor and swaps to the hovered row's gradient + icon.
 */
export function HoverList({ items }) {
  const [active, setActive] = useState(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 300, damping: 30, mass: 0.6 });
  const sy = useSpring(y, { stiffness: 300, damping: 30, mass: 0.6 });
  const ref = useRef(null);

  const onMove = (e) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    x.set(e.clientX - r.left);
    y.set(e.clientY - r.top);
  };

  const cur = active != null ? items[active] : null;

  return (
    <div ref={ref} className="relative" onPointerMove={onMove} onPointerLeave={() => setActive(null)}>
      <div style={{ borderTop: "1px solid var(--pos-border)" }}>
        {items.map((it, i) => (
          <div
            key={it.title}
            onPointerEnter={(e) => { if (e.pointerType === "mouse") setActive(i); }}
            className="land-row group grid grid-cols-[1fr_auto] md:grid-cols-[1.4fr_1fr_auto] items-center gap-4 py-5 md:py-7"
            style={{ borderBottom: "1px solid var(--pos-border)" }}
          >
            <div className="flex items-center gap-4 min-w-0">
              <span className="text-xs font-mono tabular-nums shrink-0" style={{ color: "var(--pos-muted)" }}>{String(i + 1).padStart(2, "0")}</span>
              <span className="land-display text-2xl md:text-4xl truncate transition-transform duration-500 group-hover:translate-x-2">{it.title}</span>
            </div>
            <span className="hidden md:block text-sm" style={{ color: "var(--pos-muted)" }}>{it.desc}</span>
            <span className="text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap" style={{ border: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>{it.tag}</span>
          </div>
        ))}
      </div>
      <AnimatePresence>
        {cur && (
          <motion.div
            key="preview"
            className="pointer-events-none absolute left-0 top-0 z-10 hidden md:block"
            style={{ x: sx, y: sy }}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.25, ease: EASE }}
          >
            <div
              className="-translate-x-1/2 -translate-y-1/2 w-64 h-44 rounded-2xl p-5 flex flex-col justify-end text-white shadow-2xl transition-[background] duration-300"
              style={{ background: `linear-gradient(160deg, ${cur.from} 0%, ${cur.to} 80%)` }}
            >
              <cur.icon className="w-6 h-6 mb-2" />
              <div className="font-bold">{cur.title}</div>
              {cur.note && <div className="text-xs mt-1 opacity-85">{cur.note}</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Numbered rows that open to show their description (hover or tap). */
export function ServiceRows({ items }) {
  const [open, setOpen] = useState(0);
  return (
    <div style={{ borderTop: "1px solid rgba(255,255,255,0.14)" }}>
      {items.map((it, i) => {
        const isOpen = open === i;
        return (
          <div key={it.title} style={{ borderBottom: "1px solid rgba(255,255,255,0.14)" }}>
            <button
              type="button"
              className="w-full text-left grid grid-cols-[auto_1fr_auto] items-center gap-5 py-6 md:py-8"
              onMouseEnter={() => setOpen(i)}
              onClick={() => setOpen(isOpen ? -1 : i)}
              aria-expanded={isOpen}
            >
              <span className="text-xs font-mono tabular-nums" style={{ color: "#A39D95" }}>({String(i + 1).padStart(2, "0")})</span>
              <span className="land-display text-2xl md:text-5xl transition-colors duration-300" style={{ color: isOpen ? "#fff" : "rgba(255,255,255,0.45)" }}>{it.title}</span>
              <motion.span animate={{ rotate: isOpen ? 45 : 0 }} transition={{ duration: 0.35, ease: EASE }}>
                <Plus className="w-6 h-6" style={{ color: isOpen ? "#FB923C" : "rgba(255,255,255,0.45)" }} />
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.45, ease: EASE }}
                  className="overflow-hidden"
                >
                  <div className="grid md:grid-cols-[auto_1fr_1fr] gap-5 pb-8 md:pl-14">
                    <span className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: `linear-gradient(155deg, ${it.from}, ${it.to})` }}>
                      <it.icon className="w-5 h-5 text-white" />
                    </span>
                    <p className="text-base md:text-lg leading-relaxed max-w-md" style={{ color: "#C9C2B8" }}>{it.note}</p>
                    <ul className="flex flex-wrap gap-2 content-start">
                      {it.points.map((p) => (
                        <li key={p} className="text-xs font-semibold px-3 py-1.5 rounded-full" style={{ border: "1px solid rgba(255,255,255,0.18)", color: "#E7E1D8" }}>{p}</li>
                      ))}
                    </ul>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

/** Closing call to action whose headline grows as it scrolls into view. */
export function ScaleCta({ eyebrow, title, sub, href, cta }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] });
  const scale = useTransform(scrollYProgress, [0, 1], [0.82, 1]);
  const opacity = useTransform(scrollYProgress, [0, 0.6], [0.2, 1]);
  return (
    <section ref={ref} className="max-w-7xl mx-auto px-6 py-24 md:py-36 text-center overflow-hidden">
      <div className="text-xs font-bold tracking-[0.16em] uppercase mb-6" style={{ color: "var(--pos-muted)" }}>{eyebrow}</div>
      <motion.h2 style={{ scale, opacity }} className="land-display text-[13vw] md:text-[8.5vw] leading-[0.92] mb-8">
        {title}
      </motion.h2>
      <p className="text-lg mb-10" style={{ color: "var(--pos-muted)" }}>{sub}</p>
      <a href={href} className="land-magnet group inline-flex items-center gap-3 rounded-full pl-7 pr-2 py-2 font-bold text-white" style={{ background: "var(--pos-text)" }}>
        {cta}
        <span className="w-10 h-10 rounded-full flex items-center justify-center transition-transform duration-500 group-hover:rotate-45" style={{ background: "var(--pos-accent)" }}>
          <ArrowUpRight className="w-5 h-5" />
        </span>
      </a>
    </section>
  );
}
