import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { RoundedBox, Float, ContactShadows } from "@react-three/drei";
import * as THREE from "three";

// The hero's 3D scene: a stylised Kanda POS terminal printing a GST bill,
// with ₹ coins drifting around it. The terminal's screen shows a real
// screenshot of the demo POS order screen (public/landing/pos-screen.jpg);
// everything else is primitives and canvas-drawn textures, with no model
// files. Lazy-loaded by LandingPage so three.js stays out of the main bundle.

// Captured from /demo/pos (demo tenant, PIN 1234) at 1300×960; the screen
// plane below keeps that same aspect ratio.
const SCREEN_IMG = "/landing/pos-screen.jpg";

const ORANGE = "#F97316";
const ITEMS = [
  ["Hyderabadi Biryani", 320], ["Chicken 65", 220], ["Irani Chai ×2", 40],
  ["Osmania Biscuit ×4", 80], ["Double ka Meetha", 120], ["Lime Soda", 60],
];

/** A 2D canvas we redraw ourselves, wrapped as a three.js texture. */
function useCanvasTexture(w, h, draw, deps) {
  const { canvas, texture } = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { canvas: c, texture: t };
  }, [w, h]);
  useEffect(() => {
    draw(canvas.getContext("2d"), w, h);
    texture.needsUpdate = true;
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function drawReceipt(ctx, w, h) {
  ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#1A1714"; ctx.textAlign = "center"; ctx.font = "700 30px monospace";
  ctx.fillText("KANDA POS", w / 2, 60);
  ctx.font = "400 20px monospace"; ctx.fillStyle = "#6B6257";
  ctx.fillText("GSTIN 36AKPPK1234F1Z8", w / 2, 92);
  ctx.textAlign = "left"; ctx.fillStyle = "#1A1714"; ctx.font = "400 22px monospace";
  ITEMS.forEach(([n, p], i) => {
    const y = 150 + i * 40;
    ctx.fillText(n.slice(0, 16), 24, y);
    ctx.textAlign = "right"; ctx.fillText(`₹${p}`, w - 24, y); ctx.textAlign = "left";
  });
  ctx.setLineDash([6, 6]); ctx.strokeStyle = "#999"; ctx.beginPath(); ctx.moveTo(20, 400); ctx.lineTo(w - 20, 400); ctx.stroke();
  ctx.font = "700 28px monospace"; ctx.fillText("TOTAL", 24, 444);
  ctx.textAlign = "right"; ctx.fillText("₹882.00", w - 24, 444); ctx.textAlign = "center";
  ctx.font = "400 18px monospace"; ctx.fillStyle = "#6B6257"; ctx.fillText("Thank you, visit again", w / 2, 490);
}

function drawCoin(ctx, w, h) {
  const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
  g.addColorStop(0, "#FDBA74"); g.addColorStop(1, "#EA580C");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 18, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "#FFF7ED"; ctx.font = "700 130px Outfit, 'Noto Sans', Arial, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("₹", w / 2, h / 2 + 6);
}

function Terminal({ animate }) {
  const group = useRef();
  const receipt = useRef();
  const [count, setCount] = useState(animate ? 1 : ITEMS.length);
  const screenTex = useLoader(THREE.TextureLoader, SCREEN_IMG);
  useMemo(() => {
    screenTex.colorSpace = THREE.SRGBColorSpace;
    screenTex.anisotropy = 8;
  }, [screenTex]);
  const receiptTex = useCanvasTexture(320, 520, drawReceipt, []);

  // Tick through a bill every ~0.9s: the receipt feeds out at the end of
  // each cycle, then tears off and the next one starts.
  useEffect(() => {
    if (!animate) return undefined;
    const id = setInterval(() => setCount((c) => (c >= ITEMS.length + 3 ? 1 : c + 1)), 900);
    return () => clearInterval(id);
  }, [animate]);

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    // Lean toward the pointer, and turn away as the hero scrolls off.
    const scroll = Math.min(window.scrollY / 700, 1);
    const tx = state.pointer.y * -0.18 + 0.12 + scroll * 0.35;
    const ty = state.pointer.x * 0.3 - 0.28 + scroll * 0.9;
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, tx, 4, dt);
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, ty, 4, dt);
    // Receipt feeds out once the bill is complete.
    const printing = count > ITEMS.length;
    const target = printing ? Math.min((count - ITEMS.length) / 3, 1) : 0.02;
    const r = receipt.current;
    if (r) {
      r.scale.y = THREE.MathUtils.damp(r.scale.y, target, 3, dt);
      r.position.y = 0.55 + r.scale.y * 0.9;
    }
  });

  return (
    <group ref={group} position={[0, -0.6, 0]}>
      {/* Base */}
      <RoundedBox args={[3, 0.32, 1.9]} radius={0.12} smoothness={4} position={[0, 0, 0]}>
        <meshStandardMaterial color="#1A1714" roughness={0.45} metalness={0.2} />
      </RoundedBox>
      {/* Printer block with paper slot */}
      <RoundedBox args={[0.78, 0.42, 0.7]} radius={0.08} smoothness={4} position={[1.12, 0.34, 0.5]}>
        <meshStandardMaterial color="#26221E" roughness={0.5} />
      </RoundedBox>
      <mesh position={[1.12, 0.56, 0.5]}>
        <boxGeometry args={[0.58, 0.02, 0.06]} />
        <meshStandardMaterial color="#0B0A09" />
      </mesh>
      {/* Receipt paper, anchored at the slot and scaled up as it prints */}
      <group position={[1.12, 0, 0.5]}>
        <mesh ref={receipt} position={[0, 0.55, 0]} scale={[1, 0.02, 1]}>
          <planeGeometry args={[0.52, 1.8]} />
          <meshStandardMaterial map={receiptTex} side={THREE.DoubleSide} roughness={0.9} />
        </mesh>
      </group>
      {/* Screen stand + screen */}
      <mesh position={[-0.3, 0.6, -0.42]} rotation={[-0.2, 0, 0]}>
        <cylinderGeometry args={[0.08, 0.12, 0.9, 24]} />
        <meshStandardMaterial color="#26221E" metalness={0.4} roughness={0.4} />
      </mesh>
      <group position={[-0.3, 1.5, -0.35]} rotation={[-0.22, 0, 0]}>
        <RoundedBox args={[2.5, 1.9, 0.1]} radius={0.06} smoothness={4}>
          <meshStandardMaterial color="#121014" roughness={0.3} metalness={0.3} />
        </RoundedBox>
        <mesh position={[0, 0, 0.056]}>
          <planeGeometry args={[2.38, 1.756]} />
          <meshBasicMaterial map={screenTex} toneMapped={false} />
        </mesh>
      </group>
      {/* Orange status light */}
      <mesh position={[-1.25, 0.17, 0.96]}>
        <sphereGeometry args={[0.04, 16, 16]} />
        <meshBasicMaterial color={ORANGE} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Coins({ animate }) {
  const tex = useCanvasTexture(256, 256, drawCoin, []);
  const spots = [[-2.1, 1.6, -0.4, 0.28], [2.2, 1.1, 0.2, 0.22], [-1.7, -0.3, 1.1, 0.2], [1.9, 2.3, -1, 0.17], [2.5, -0.2, 0.9, 0.15]];
  return spots.map(([x, y, z, s], i) => (
    <Float key={i} speed={animate ? 1.6 + i * 0.3 : 0} rotationIntensity={animate ? 1.6 : 0} floatIntensity={animate ? 1.4 : 0}>
      <mesh position={[x, y, z]} rotation={[Math.PI / 2.3, 0.4 * i, 0.2]} scale={s}>
        <cylinderGeometry args={[1, 1, 0.16, 48]} />
        <meshStandardMaterial attach="material-0" color="#C2410C" metalness={0.7} roughness={0.3} />
        <meshStandardMaterial attach="material-1" map={tex} metalness={0.4} roughness={0.35} />
        <meshStandardMaterial attach="material-2" map={tex} metalness={0.4} roughness={0.35} />
      </mesh>
    </Float>
  ));
}

export default function Hero3D() {
  const wrap = useRef(null);
  const [visible, setVisible] = useState(true);
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // Stop rendering frames while the hero is scrolled out of view.
  useEffect(() => {
    const el = wrap.current;
    if (!el || !("IntersectionObserver" in window)) return undefined;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "100px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={wrap} className="w-full h-full">
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [0, 1.5, 6.4], fov: 38 }}
        frameloop={visible ? "always" : "never"}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        aria-hidden="true"
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, 5, 4]} intensity={1.6} />
        <pointLight position={[-3, 2, 2]} intensity={18} color={ORANGE} />
        <Float speed={reduced ? 0 : 1.2} rotationIntensity={reduced ? 0 : 0.15} floatIntensity={reduced ? 0 : 0.5}>
          <Suspense fallback={null}>
            <Terminal animate={!reduced} />
          </Suspense>
        </Float>
        <Coins animate={!reduced} />
        <ContactShadows position={[0, -1.1, 0]} opacity={0.35} scale={9} blur={2.6} far={3} />
      </Canvas>
    </div>
  );
}
