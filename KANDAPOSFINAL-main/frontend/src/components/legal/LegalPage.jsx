import React from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Store, ChevronRight } from "lucide-react";
import useSeo from "../../hooks/useSeo";

/** Shared chrome for the Privacy Policy and Terms & Conditions pages —
 *  same dark theme and header pattern as LandingPage, so these read as
 *  part of the site rather than a bolted-on legal template. */
export default function LegalPage({ title, updated, path, description, children }) {
  const navigate = useNavigate();
  useSeo({ title, description, path });

  return (
    <div style={{ background: "var(--pos-bg)", color: "var(--pos-text)", minHeight: "100vh" }}>
      <header className="sticky top-0 z-20" style={{ background: "rgba(11,18,32,0.85)", backdropFilter: "blur(10px)", borderBottom: "1px solid var(--pos-border)" }}>
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
          <button onClick={() => navigate("/")} className="flex items-center gap-2 text-sm font-medium pos-btn" style={{ color: "var(--pos-muted)" }}>
            <ArrowLeft className="w-4 h-4" /> Back to kandapos.com
          </button>
          <div className="flex items-center gap-2">
            <Store className="w-4 h-4" style={{ color: "var(--pos-accent)" }} />
            <span className="font-bold text-sm text-white">KANDA POS</span>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-14">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs mb-8" style={{ color: "var(--pos-muted)" }}>
          <Link to="/" className="hover:text-white transition-colors">Home</Link>
          <ChevronRight className="w-3 h-3" />
          <span style={{ color: "var(--pos-text)" }}>{title}</span>
        </nav>
        <h1 className="text-3xl font-bold text-white mb-2">{title}</h1>
        <p className="text-sm mb-12" style={{ color: "var(--pos-muted)" }}>Last updated {updated}</p>
        <div className="space-y-10">{children}</div>
      </main>

      <footer className="text-center text-xs py-8" style={{ color: "var(--pos-muted)", borderTop: "1px solid var(--pos-border)" }}>
        © {new Date().getFullYear()} Kanda POS. All rights reserved.
      </footer>
    </div>
  );
}

export function Section({ heading, children }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-white mb-3">{heading}</h2>
      <div className="text-sm leading-relaxed space-y-3" style={{ color: "var(--pos-muted)" }}>{children}</div>
    </section>
  );
}
