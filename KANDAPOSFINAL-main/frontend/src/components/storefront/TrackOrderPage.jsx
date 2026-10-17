import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { Bike, CheckCircle2, ChefHat, KeyRound, Loader2, MapPin, Phone, Store, PackageCheck } from "lucide-react";
import useSeo from "../../hooks/useSeo";

/** /track/:token — the customer's live delivery tracking page, linked from
 *  the WhatsApp/SMS they get when the order leaves the store. Public: the
 *  unguessable token is the only key. Shows where the order is, the
 *  driver's live position while it's on the way, and the delivery OTP to
 *  read out at the door. */

const POLL_MS = 10000;
const rupees = (n) => `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`;

const STEPS = [
  { key: "placed", label: "Order placed", icon: CheckCircle2 },
  { key: "preparing", label: "Being prepared", icon: ChefHat },
  { key: "on-the-way", label: "On the way", icon: Bike },
  { key: "delivered", label: "Delivered", icon: PackageCheck },
];

function stepIndex(status) {
  if (status === "completed") return 3;
  if (status === "out-for-delivery") return 2;
  if (status === "in-kitchen" || status === "ready") return 1;
  return 0;
}

const HEADLINE = {
  new: "We've got your order",
  "in-kitchen": "Your food is being prepared",
  ready: "Packed and waiting for your driver",
  "out-for-delivery": "Your order is on the way",
  completed: "Delivered. Enjoy!",
  cancelled: "This order was cancelled",
};

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

const card = { background: "var(--pos-panel)", border: "1px solid var(--pos-border)" };

export default function TrackOrderPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useSeo({ title: data ? `Order #${data.number}` : "Track your order", noindex: true });

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${process.env.REACT_APP_BACKEND_URL}/api/track/${encodeURIComponent(token)}`);
      setData(r.data);
      setError(null);
    } catch (e) {
      if (e?.response?.status === 404) setError(e.response.data?.detail || "Tracking link not found");
      // Network blips: keep showing the last state.
    }
  }, [token]);

  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  if (error && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center" style={{ background: "var(--pos-bg)", color: "var(--pos-muted)" }}>
        <div><div className="text-lg font-bold" style={{ color: "var(--pos-text)" }}>{error}</div>
          <p className="text-sm mt-1">Check the link in your message, or call the store.</p></div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--pos-bg)", color: "var(--pos-muted)" }}>
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const idx = stepIndex(data.status);
  const loc = data.location;
  const mapSrc = loc ? `https://maps.google.com/maps?q=${loc.lat},${loc.lng}&z=16&output=embed` : null;

  return (
    <div data-testid="track-page" className="min-h-screen" style={{ background: "var(--pos-bg)" }}>
      <div className="max-w-md mx-auto p-4">
        <div className="text-xs uppercase tracking-wider font-bold" style={{ color: "var(--pos-muted)" }}>{data.store.name} · Order #{data.number}</div>
        <h1 className="text-2xl font-extrabold mt-1" style={{ color: "var(--pos-text)" }}>{HEADLINE[data.status] || "Tracking your order"}</h1>
        {data.driver && data.status === "out-for-delivery" && (
          <p className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>{data.driver.name} is bringing it to you.</p>
        )}

        {data.status !== "cancelled" && (
          <div className="rounded-2xl p-4 mt-4" style={card}>
            <div className="flex items-start justify-between">
              {STEPS.map((s, i) => {
                const Icon = s.icon;
                const done = i <= idx;
                return (
                  <div key={s.key} className="flex flex-col items-center text-center flex-1">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center"
                      style={{ background: done ? "var(--pos-accent)" : "var(--pos-panel-2)", color: done ? "#fff" : "var(--pos-muted)" }}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="text-[11px] font-semibold mt-1 leading-tight" style={{ color: done ? "var(--pos-text)" : "var(--pos-muted)" }}>{s.label}</div>
                    <div className="text-[10px]" style={{ color: "var(--pos-muted)" }}>
                      {i === 0 ? fmtTime(data.placedAt) : i === 2 ? fmtTime(data.statusTimes?.["out-for-delivery"]) : i === 3 ? fmtTime(data.statusTimes?.completed) : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {data.otp && (
          <div data-testid="track-otp" className="rounded-2xl p-4 mt-3 text-center" style={{ ...card, borderColor: "var(--pos-accent)" }}>
            <div className="text-[11px] uppercase tracking-wider font-bold flex items-center justify-center gap-1" style={{ color: "var(--pos-muted)" }}>
              <KeyRound className="w-3.5 h-3.5" />Delivery OTP
            </div>
            <div className="text-4xl font-extrabold tabular-nums tracking-[0.3em] mt-1" style={{ color: "var(--pos-text)" }}>{data.otp}</div>
            <div className="text-xs mt-1" style={{ color: "var(--pos-muted)" }}>Share it with the driver only when you have your order.</div>
          </div>
        )}

        {data.status === "out-for-delivery" && (
          <div className="rounded-2xl overflow-hidden mt-3" style={card}>
            {mapSrc ? (
              <>
                <iframe data-testid="track-map" title="Driver location" src={mapSrc} className="w-full h-64 block" style={{ border: 0 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
                <div className="px-3 py-2 text-xs flex items-center gap-1" style={{ color: "var(--pos-muted)" }}>
                  <Bike className="w-3.5 h-3.5" />Live location · updated {fmtTime(loc.at)}
                </div>
              </>
            ) : (
              <div className="p-4 text-sm" style={{ color: "var(--pos-muted)" }}>The driver's live location will show here once their phone shares it.</div>
            )}
          </div>
        )}

        {data.payment === "unpaid" && data.status !== "completed" && data.status !== "cancelled" && (
          <div className="rounded-2xl p-4 mt-3 flex items-center justify-between" style={card}>
            <span className="text-sm" style={{ color: "var(--pos-text)" }}>Pay on delivery</span>
            <span className="text-xl font-extrabold tabular-nums" style={{ color: "var(--pos-text)" }}>{rupees(data.total)}</span>
          </div>
        )}

        <div className="rounded-2xl p-4 mt-3 space-y-3" style={card}>
          <div className="flex items-start gap-2">
            <Store className="w-4 h-4 mt-0.5" style={{ color: "var(--pos-muted)" }} />
            <div className="flex-1 text-sm">
              <div className="font-bold" style={{ color: "var(--pos-text)" }}>{data.store.name}</div>
              <div style={{ color: "var(--pos-muted)" }}>{data.store.address}</div>
            </div>
            {data.store.phone && (
              <a href={`tel:${data.store.phone}`} className="h-9 px-3 rounded-lg text-xs font-bold flex items-center gap-1"
                style={{ background: "var(--pos-panel-2)", color: "var(--pos-text)", border: "1px solid var(--pos-border)" }}>
                <Phone className="w-3.5 h-3.5" />Call
              </a>
            )}
          </div>
          {data.customer.address && (
            <div className="flex items-start gap-2 text-sm">
              <MapPin className="w-4 h-4 mt-0.5" style={{ color: "var(--pos-muted)" }} />
              <div style={{ color: "var(--pos-muted)" }}>Delivering to {data.customer.address}</div>
            </div>
          )}
        </div>

        <div className="rounded-2xl p-4 mt-3" style={card}>
          <div className="text-[11px] uppercase tracking-wider font-bold mb-2" style={{ color: "var(--pos-muted)" }}>Your order</div>
          <ul className="space-y-1 text-sm" style={{ color: "var(--pos-text)" }}>
            {data.items.map((it, i) => <li key={i}><span className="font-bold tabular-nums">{it.qty}×</span> {it.name}</li>)}
          </ul>
          <div className="mt-2 pt-2 flex justify-between text-sm font-bold" style={{ borderTop: "1px solid var(--pos-border)", color: "var(--pos-text)" }}>
            <span>Total</span><span className="tabular-nums">{rupees(data.total)}</span>
          </div>
        </div>
        <p className="text-center text-[11px] mt-4" style={{ color: "var(--pos-muted)" }}>Powered by Kanda POS</p>
      </div>
    </div>
  );
}
