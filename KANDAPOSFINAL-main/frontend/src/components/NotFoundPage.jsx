import React from "react";
import { useNavigate } from "react-router-dom";
import { Store } from "lucide-react";
import useSeo from "../hooks/useSeo";

export default function NotFoundPage() {
  const navigate = useNavigate();
  useSeo({ title: "Page not found", noindex: true });

  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-6" style={{ background: "var(--pos-bg)", color: "var(--pos-text)" }}>
      <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-6" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
        <Store className="w-6 h-6" style={{ color: "var(--pos-accent)" }} />
      </div>
      <h1 className="text-2xl font-bold mb-2">Page not found</h1>
      <p className="text-sm max-w-sm mb-8" style={{ color: "var(--pos-muted)" }}>
        The page you're looking for doesn't exist or may have moved.
      </p>
      <button onClick={() => navigate("/")} className="pos-btn rounded-lg px-5 py-2.5 text-sm font-semibold text-white" style={{ background: "var(--pos-accent)" }}>
        Back to kandapos.com
      </button>
    </div>
  );
}
