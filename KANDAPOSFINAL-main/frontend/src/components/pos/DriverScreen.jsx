import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Bike, Phone, MapPin, Navigation, CheckCircle2, IndianRupee, Loader2, LogOut, RefreshCw, CalendarDays,
  Home, ListOrdered, Wallet, User, Store, Clock, ChevronLeft, Package, Power, BellRing, LocateFixed, KeyRound, Send,
} from "lucide-react";
import { usePos } from "../../store/PosContext";
import { driverApi, ordersApi } from "../../api/client";
import { MyRotaTab, startOfWeek } from "./WorkforceScreen";
import { startLocationSharing, openLocationSettings, ensureNotificationPermission, notify, registerPush } from "../../lib/driverDevice";

/** The Kanda Driver app (also /:slug/driver in the POS for Driver staff).
 *  Modelled on what aggregator rider apps put in front of a delivery
 *  partner: an online/offline switch, today's deliveries / cash in hand /
 *  tips at a glance, new-order alerts, one card per delivery with pickup
 *  and drop details, a step-by-step flow (accept -> picked up -> delivered)
 *  that won't let an unpaid order be closed without collecting cash, and a
 *  day's earnings list. Everything comes from GET /driver/feed, which only
 *  returns this driver's orders and unclaimed deliveries. */

const POLL_MS = 8000;
const rupees = (n) => `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`;
const mapsHref = (q) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
const addressOf = (c = {}) => [c.address, c.postcode].filter(Boolean).join(", ");
const isPaid = (o) => o.payment === "cash" || o.payment === "card";

function minsSince(iso, now) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, Math.round((now - t) / 60000));
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

function fmtDuration(mins) {
  if (mins == null) return "—";
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${mins % 60}m` : `${mins}m`;
}

const STATUS = {
  new: { label: "Order placed", tone: "var(--pos-muted)" },
  "in-kitchen": { label: "Being prepared", tone: "#d97706" },
  ready: { label: "Ready for pickup", tone: "#16a34a" },
  "out-for-delivery": { label: "Out for delivery", tone: "var(--pos-blue)" },
  completed: { label: "Delivered", tone: "#16a34a" },
};

// Short alert for a new delivery: vibrate (Android WebView honours this)
// plus two beeps through WebAudio, since there's no notification plugin.
function alertNewOrder() {
  try { navigator.vibrate?.([300, 150, 300]); } catch { /* unsupported */ }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.35].forEach((at) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.3);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch { /* audio blocked until first tap — vibration still fires */ }
}

const panel = { background: "var(--pos-panel)", border: "1px solid var(--pos-border)" };
const subtle = { background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" };

function StatusChip({ status }) {
  const s = STATUS[status] || { label: status, tone: "var(--pos-muted)" };
  return (
    <span className="text-[10px] uppercase tracking-wide font-bold px-2 py-1 rounded-full whitespace-nowrap"
      style={{ color: s.tone, border: `1px solid ${s.tone}` }}>{s.label}</span>
  );
}

function PayChip({ order }) {
  if (isPaid(order)) {
    return <span className="text-xs font-bold" style={{ color: "#16a34a" }}>Paid · {order.payment}</span>;
  }
  return (
    <span className="text-xs font-bold inline-flex items-center gap-1" style={{ color: "#dc2626" }}>
      <IndianRupee className="w-3 h-3" />Collect {rupees(order.total)} cash
    </span>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-xl p-3" style={panel}>
      <div className="text-[11px] uppercase tracking-wider font-bold" style={{ color: "var(--pos-muted)" }}>{label}</div>
      <div className="text-xl font-extrabold tabular-nums mt-0.5" style={{ color: "var(--pos-text)" }}>{value}</div>
      {sub && <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>{sub}</div>}
    </div>
  );
}

function Empty({ children }) {
  return (
    <div className="text-sm py-8 text-center rounded-xl" style={{ ...panel, color: "var(--pos-muted)" }}>{children}</div>
  );
}

function OrderCard({ order, now, mine, busy, onOpen, onClaim }) {
  const c = order.customer || {};
  const items = order.items || [];
  const qty = items.reduce((n, it) => n + (it.qty || 0), 0);
  const waited = minsSince(order.placedAt, now);
  return (
    <div data-testid={`driver-order-${order.id}`} className="rounded-xl p-4 mb-3" style={panel}>
      <button type="button" onClick={() => onOpen(order)} className="w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-lg font-extrabold tabular-nums" style={{ color: "var(--pos-text)" }}>#{order.number}</div>
            <div className="text-[11px] flex items-center gap-1" style={{ color: "var(--pos-muted)" }}>
              <Clock className="w-3 h-3" />{waited != null ? `${waited} min since order` : ""} · {qty} item{qty === 1 ? "" : "s"} · {order.source || "in-store"}
            </div>
          </div>
          <StatusChip status={order.status} />
        </div>
        <div className="mt-2 text-sm font-semibold" style={{ color: "var(--pos-text)" }}>{c.name}</div>
        {addressOf(c) && (
          <div className="text-sm mt-0.5 flex items-start gap-1.5" style={{ color: "var(--pos-muted)" }}>
            <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /><span className="line-clamp-2">{addressOf(c)}</span>
          </div>
        )}
        <div className="mt-2 flex items-center justify-between">
          <PayChip order={order} />
          {(order.deliveryFee > 0 || order.tip > 0) && (
            <span className="text-[11px]" style={{ color: "var(--pos-muted)" }}>
              Fee {rupees(order.deliveryFee)}{order.tip > 0 ? ` · Tip ${rupees(order.tip)}` : ""}
            </span>
          )}
        </div>
      </button>
      {!mine && (
        <button data-testid={`driver-claim-${order.id}`} disabled={busy} onClick={() => onClaim(order)}
          className="pos-btn mt-3 w-full h-11 rounded-lg text-sm font-bold text-white disabled:opacity-60"
          style={{ background: "var(--pos-accent)" }}>
          Accept delivery
        </button>
      )}
    </div>
  );
}

function Steps({ order }) {
  const steps = [
    { key: "accepted", label: "Accepted", done: true },
    { key: "picked", label: "Picked up", done: ["out-for-delivery", "completed"].includes(order.status) },
    { key: "delivered", label: "Delivered", done: order.status === "completed" },
  ];
  return (
    <div className="flex items-center gap-1 mb-4">
      {steps.map((s, i) => (
        <React.Fragment key={s.key}>
          <div className="flex flex-col items-center min-w-[64px]">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold"
              style={{ background: s.done ? "var(--pos-accent)" : "var(--pos-panel-2)", color: s.done ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
              {s.done ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
            </div>
            <div className="text-[10px] mt-1 font-semibold" style={{ color: s.done ? "var(--pos-text)" : "var(--pos-muted)" }}>{s.label}</div>
          </div>
          {i < steps.length - 1 && <div className="flex-1 h-0.5 -mt-4" style={{ background: steps[i + 1].done ? "var(--pos-accent)" : "var(--pos-border)" }} />}
        </React.Fragment>
      ))}
    </div>
  );
}

function ContactRow({ icon: Icon, title, lines, nav, tel }) {
  return (
    <div className="rounded-xl p-3 mb-3" style={panel}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-bold" style={{ color: "var(--pos-muted)" }}>
        <Icon className="w-3.5 h-3.5" />{title}
      </div>
      {lines.filter(Boolean).map((l, i) => (
        <div key={i} className={i === 0 ? "text-base font-bold mt-1" : "text-sm"} style={{ color: i === 0 ? "var(--pos-text)" : "var(--pos-muted)" }}>{l}</div>
      ))}
      <div className="flex gap-2 mt-3">
        {nav && (
          <a href={mapsHref(nav)} target="_blank" rel="noreferrer" className="pos-btn flex-1 h-10 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5 text-white" style={{ background: "var(--pos-blue)" }}>
            <Navigation className="w-4 h-4" />Navigate
          </a>
        )}
        {tel && (
          <a href={`tel:${tel}`} className="pos-btn flex-1 h-10 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5" style={subtle}>
            <Phone className="w-4 h-4" />Call
          </a>
        )}
      </div>
    </div>
  );
}

function TrackingNote({ order, busy, onResend }) {
  const n = order.trackingNotified;
  if (order.status !== "out-for-delivery" || !n) return null;
  return (
    <div className="rounded-xl p-3 mb-3 text-sm" style={panel}>
      <div className="flex items-start gap-2" style={{ color: "var(--pos-text)" }}>
        <Send className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: n.ok ? "#16a34a" : "#d97706" }} />
        <div className="flex-1">
          {n.ok
            ? <>Customer was sent the live tracking link{order.otpRequired ? " and a delivery OTP" : ""} on {n.channel === "sms" ? "SMS" : "WhatsApp"}.</>
            : <>Couldn't message the customer, so no OTP is needed for this one.</>}
          {order.otpRequired && <div className="text-xs mt-1" style={{ color: "var(--pos-muted)" }}>Ask for the 4-digit OTP when you hand over the order.</div>}
        </div>
      </div>
      <button data-testid="driver-resend-tracking" disabled={busy} onClick={() => onResend(order)}
        className="pos-btn mt-2 w-full h-9 rounded-lg text-xs font-bold" style={subtle}>
        Resend link to customer
      </button>
    </div>
  );
}

function OrderDetail({ order, store, mine, busy, onBack, onClaim, onPickedUp, onDelivered, onResend }) {
  const c = order.customer || {};
  const items = order.items || [];
  const [confirmCash, setConfirmCash] = useState(false);
  const [otp, setOtp] = useState("");
  const itemsTotal = items.reduce((n, it) => n + (it.price || 0) * (it.qty || 0), 0);
  // GST, service charge and discounts, so the lines add up to the total.
  const rest = (order.total || 0) - itemsTotal - (order.deliveryFee || 0) - (order.tip || 0);

  let action = null;
  if (!mine) {
    action = { label: "Accept delivery", onClick: () => onClaim(order), color: "var(--pos-accent)" };
  } else if (order.status === "new" || order.status === "in-kitchen") {
    action = { label: "Waiting for the kitchen…", disabled: true, color: "var(--pos-muted)" };
  } else if (order.status === "ready") {
    action = { label: "Picked up · start delivery", onClick: () => onPickedUp(order), color: "var(--pos-blue)" };
  } else if (order.status === "out-for-delivery") {
    // Always confirm the hand-over: it's where the cash and the OTP are taken.
    action = isPaid(order) && !order.otpRequired
      ? { label: "Mark delivered", onClick: () => onDelivered(order, false), color: "#16a34a" }
      : { label: isPaid(order) ? "Enter OTP & deliver" : `Collect ${rupees(order.total)} cash & deliver`, onClick: () => { setOtp(""); setConfirmCash(true); }, color: "#16a34a" };
  }

  return (
    <div data-testid="driver-order-detail" className="fixed inset-0 z-30 flex flex-col" style={{ background: "var(--pos-bg)" }}>
      <header className="px-3 py-3 flex items-center gap-2" style={{ background: "var(--pos-panel)", borderBottom: "1px solid var(--pos-border)", paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <button onClick={onBack} className="pos-btn h-9 w-9 rounded-md flex items-center justify-center" style={subtle} aria-label="Back">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="text-base font-extrabold" style={{ color: "var(--pos-text)" }}>Order #{order.number}</div>
          <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>Placed {fmtTime(order.placedAt)} · {order.source || "in-store"}</div>
        </div>
        <StatusChip status={order.status} />
      </header>

      <main className="flex-1 overflow-y-auto p-3 max-w-md mx-auto w-full">
        {mine && <Steps order={order} />}
        {mine && <TrackingNote order={order} busy={busy} onResend={onResend} />}

        <div className="rounded-xl p-4 mb-3 text-center" style={{ ...panel, borderColor: isPaid(order) ? "var(--pos-border)" : "#dc2626" }}>
          {isPaid(order) ? (
            <div className="text-sm font-bold" style={{ color: "#16a34a" }}>Already paid ({order.payment}) · don't collect cash</div>
          ) : (
            <>
              <div className="text-[11px] uppercase tracking-wider font-bold" style={{ color: "#dc2626" }}>Cash on delivery</div>
              <div className="text-3xl font-extrabold tabular-nums" style={{ color: "var(--pos-text)" }}>{rupees(order.total)}</div>
            </>
          )}
        </div>

        <ContactRow icon={Store} title="Pickup" lines={[store?.name, store?.address]} nav={store?.address} tel={store?.phone} />
        <ContactRow icon={MapPin} title="Drop" lines={[c.name, addressOf(c)]} nav={addressOf(c)} tel={mine ? c.phone : null} />

        <div className="rounded-xl p-3 mb-3" style={panel}>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-bold mb-2" style={{ color: "var(--pos-muted)" }}>
            <Package className="w-3.5 h-3.5" />Items · check before you leave
          </div>
          <ul className="space-y-1.5">
            {items.map((it, i) => (
              <li key={i} className="text-sm" style={{ color: "var(--pos-text)" }}>
                <span className="font-bold tabular-nums">{it.qty}×</span> {it.name}{it.size ? ` (${it.size})` : ""}
                {it.mods?.length > 0 && <div className="text-xs pl-6" style={{ color: "var(--pos-muted)" }}>{it.mods.join(", ")}</div>}
              </li>
            ))}
          </ul>
          <div className="mt-3 pt-2 text-sm space-y-0.5" style={{ borderTop: "1px solid var(--pos-border)", color: "var(--pos-muted)" }}>
            <div className="flex justify-between"><span>Items</span><span className="tabular-nums">{rupees(itemsTotal)}</span></div>
            {order.deliveryFee > 0 && <div className="flex justify-between"><span>Delivery fee</span><span className="tabular-nums">{rupees(order.deliveryFee)}</span></div>}
            {order.tip > 0 && <div className="flex justify-between"><span>Tip</span><span className="tabular-nums">{rupees(order.tip)}</span></div>}
            {Math.abs(rest) >= 1 && <div className="flex justify-between"><span>{rest > 0 ? "Taxes & charges" : "Discounts"}</span><span className="tabular-nums">{rest > 0 ? "" : "−"}{rupees(Math.abs(rest))}</span></div>}
            <div className="flex justify-between font-bold" style={{ color: "var(--pos-text)" }}><span>Order total</span><span className="tabular-nums">{rupees(order.total)}</span></div>
          </div>
        </div>
      </main>

      {action && (
        <footer className="p-3" style={{ background: "var(--pos-panel)", borderTop: "1px solid var(--pos-border)", paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <button data-testid="driver-primary-action" disabled={busy || action.disabled} onClick={action.onClick}
            className="pos-btn w-full h-12 rounded-lg text-base font-bold text-white max-w-md mx-auto block disabled:opacity-60"
            style={{ background: action.color }}>
            {busy ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : action.label}
          </button>
        </footer>
      )}

      {confirmCash && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-3" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="w-full max-w-sm rounded-2xl p-5" style={panel}>
            <div className="text-lg font-extrabold" style={{ color: "var(--pos-text)" }}>
              {isPaid(order) ? `Hand over order #${order.number}` : `Collected ${rupees(order.total)} cash?`}
            </div>
            <p className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>
              {isPaid(order) ? "Prepaid. Don't collect cash." : "This marks the order paid in cash. It's added to your cash in hand."}
            </p>
            {order.otpRequired && (
              <label className="block mt-4">
                <span className="text-[11px] uppercase tracking-wider font-bold flex items-center gap-1" style={{ color: "var(--pos-muted)" }}>
                  <KeyRound className="w-3.5 h-3.5" />Customer's delivery OTP
                </span>
                <input data-testid="driver-otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  className="mt-1 w-full h-14 rounded-lg text-center text-3xl font-extrabold tracking-[0.5em] tabular-nums outline-none"
                  style={{ ...subtle, letterSpacing: "0.5em" }} placeholder="••••" />
              </label>
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirmCash(false)} className="pos-btn flex-1 h-11 rounded-lg text-sm font-bold" style={subtle}>Not yet</button>
              <button data-testid="driver-confirm-cash" disabled={busy || (order.otpRequired && otp.length !== 4)}
                onClick={async () => { if (await onDelivered(order, !isPaid(order), otp)) setConfirmCash(false); }}
                className="pos-btn flex-1 h-11 rounded-lg text-sm font-bold text-white disabled:opacity-60" style={{ background: "#16a34a" }}>
                {isPaid(order) ? "Delivered" : "Yes, collected"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DriverScreen() {
  const { staffUser, logout } = usePos();
  const navigate = useNavigate();
  const { slug } = useParams();
  const [feed, setFeed] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("home");
  const [ordersView, setOrdersView] = useState("available");
  const [openId, setOpenId] = useState(null);
  const [now, setNow] = useState(Date.now());
  const seenAvailable = useRef(null);
  const weekStart = useMemo(() => startOfWeek(new Date()), []);
  const weekEnd = useMemo(() => { const d = new Date(weekStart); d.setUTCDate(d.getUTCDate() + 7); return d; }, [weekStart]);

  useEffect(() => {
    if (staffUser && staffUser.role !== "Driver") navigate(`/${slug}/pos`, { replace: true });
  }, [staffUser, navigate, slug]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await driverApi.feed();
      setFeed(data);
      setNow(Date.now());
      const ids = new Set(data.available.map((o) => o.id));
      if (seenAvailable.current && data.duty.online) {
        const fresh = data.available.filter((o) => !seenAvailable.current.has(o.id));
        if (fresh.length) {
          alertNewOrder();
          notify(`New delivery #${fresh[0].number}`, fresh[0].customer?.address || "Open Kanda Driver to accept it");
          toast(`New delivery #${fresh[0].number}${fresh.length > 1 ? ` +${fresh.length - 1} more` : ""}`, { icon: <BellRing className="w-4 h-4" /> });
        }
      }
      seenAvailable.current = ids;
    } catch { /* keep the last feed on screen; next poll retries */ }
    finally { setLoading(false); }
  }, []);

  const online = !!feed?.duty?.online;
  const [gps, setGps] = useState("off"); // off | on | denied | unavailable

  // One-time: notification permission (Android 13+ also needs it for the
  // location-sharing notification) and, on builds with Firebase, push.
  useEffect(() => {
    ensureNotificationPermission();
    registerPush((token) => driverApi.pushToken(token).catch(() => {}));
  }, []);

  // Share GPS for as long as the driver is online — that's what moves the
  // rider on customers' tracking pages.
  useEffect(() => {
    if (!online) { setGps("off"); return undefined; }
    let stop = () => {};
    let cancelled = false;
    startLocationSharing(
      (fix) => { setGps("on"); driverApi.location(fix).catch(() => {}); },
      (err) => setGps(err),
    ).then((s) => { if (cancelled) s(); else stop = s; });
    return () => { cancelled = true; stop(); };
  }, [online]);

  const onlineRef = useRef(false);
  onlineRef.current = online;
  useEffect(() => {
    load();
    // Keep polling in the background while online so new-delivery alerts
    // still fire with the phone in a pocket.
    const id = setInterval(() => { if (!document.hidden || onlineRef.current) load(); }, POLL_MS);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  const run = async (fn, ok) => {
    setBusy(true);
    let done = false;
    try { await fn(); done = true; if (ok) toast.success(ok); }
    catch (e) { toast.error(e?.response?.data?.detail || "Something went wrong. Try again."); }
    finally { await load(); setBusy(false); }
    return done;
  };

  const claim = (o) => run(() => ordersApi.claim(o.id), `Accepted #${o.number}`).then((ok) => ok && setOrdersView("mine"));
  const pickedUp = (o) => run(() => ordersApi.setStatus(o.id, "out-for-delivery"), `Picked up #${o.number}`);
  const delivered = (o, cash, otp) => run(async () => {
    if (cash && o.payment === "unpaid") await ordersApi.setPayment(o.id, "cash");
    await driverApi.complete(o.id, otp);
  }, `Delivered #${o.number}`).then((ok) => { if (ok) setOpenId(null); return ok; });
  const resend = (o) => run(async () => {
    const r = await driverApi.resendTracking(o.id);
    if (!r.ok) throw Object.assign(new Error(), { response: { data: { detail: r.error || "Couldn't send" } } });
  }, "Sent the tracking link again");
  const toggleDuty = () => run(() => driverApi.setDuty(!feed?.duty?.online), feed?.duty?.online ? "You're offline" : "You're online");

  if (!staffUser) return null;
  if (!feed) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--pos-bg)", color: "var(--pos-muted)" }}>
        {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <button onClick={load} className="pos-btn px-4 h-10 rounded-lg" style={subtle}>Retry</button>}
      </div>
    );
  }

  const { available, active, completed, stats, store, duty } = feed;
  const onlineMins = online ? minsSince(duty.since, now) : null;
  const all = [...active, ...available, ...completed];
  const open = openId && all.find((o) => o.id === openId);
  const isMine = (o) => active.some((a) => a.id === o.id) || completed.some((a) => a.id === o.id);

  if (open) {
    return <OrderDetail order={open} store={store} mine={isMine(open)} busy={busy} onBack={() => setOpenId(null)}
      onClaim={claim} onPickedUp={pickedUp} onDelivered={delivered} onResend={resend} />;
  }

  const cards = (list, mine) => list.map((o) => (
    <OrderCard key={o.id} order={o} now={now} mine={mine} busy={busy} onOpen={(x) => setOpenId(x.id)} onClaim={claim} />
  ));

  return (
    <div data-testid="driver-screen" className="min-h-screen flex flex-col" style={{ background: "var(--pos-bg)" }}>
      <header className="px-4 py-3 flex items-center justify-between sticky top-0 z-10"
        style={{ background: "var(--pos-panel)", borderBottom: "1px solid var(--pos-border)", paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0" style={{ background: "var(--pos-accent)" }}>
            {staffUser.initials || <Bike className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold truncate" style={{ color: "var(--pos-text)" }}>{staffUser.name}</div>
            <div className="text-[11px] truncate" style={{ color: "var(--pos-muted)" }}>{store?.name}</div>
          </div>
        </div>
        <button data-testid="driver-duty-toggle" disabled={busy} onClick={toggleDuty}
          className="pos-btn h-9 px-3 rounded-full text-xs font-bold flex items-center gap-1.5 text-white"
          style={{ background: online ? "#16a34a" : "var(--pos-muted)" }}>
          <Power className="w-3.5 h-3.5" />{online ? "Online" : "Offline"}
        </button>
      </header>

      <main className="flex-1 p-3 pb-24 max-w-md mx-auto w-full">
        {tab === "home" && (
          <>
            {!online && (
              <div className="rounded-xl p-3 mb-3 text-sm" style={{ ...panel, color: "var(--pos-text)" }}>
                You're offline. Go online to get alerts for new deliveries and share your location with customers.
              </div>
            )}
            {online && gps !== "on" && (
              <div data-testid="driver-gps-banner" className="rounded-xl p-3 mb-3 text-sm flex items-center gap-2" style={{ ...panel, color: "var(--pos-text)", borderColor: gps === "off" ? "var(--pos-border)" : "#d97706" }}>
                <LocateFixed className="w-4 h-4 flex-shrink-0" style={{ color: "#d97706" }} />
                <span className="flex-1">
                  {gps === "denied" ? "Location is off for Kanda Driver. Customers can't see you on the map." :
                    gps === "unavailable" ? "Can't get your location. Turn on GPS." : "Finding your location…"}
                </span>
                {gps === "denied" && <button onClick={openLocationSettings} className="pos-btn h-8 px-3 rounded-md text-xs font-bold" style={subtle}>Settings</button>}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <Stat label="Delivered today" value={stats.delivered} sub={stats.avgDeliveryMins != null ? `Avg ${stats.avgDeliveryMins} min to door` : null} />
              <Stat label="Cash in hand" value={rupees(stats.cashInHand)} sub="Hand over at the store" />
              <Stat label="Fees + tips" value={rupees(stats.deliveryFees + stats.tips)} sub={`Tips ${rupees(stats.tips)}`} />
              <Stat label="Online for" value={online ? fmtDuration(onlineMins) : "—"} sub={online ? `Since ${fmtTime(duty.since)}` : "Offline"} />
            </div>

            <h2 className="text-[11px] uppercase tracking-wider font-bold mb-2" style={{ color: "var(--pos-muted)" }}>
              Current deliveries · {active.length}
            </h2>
            {active.length ? cards(active, true) : <Empty>No active deliveries.</Empty>}

            <button onClick={() => { setTab("orders"); setOrdersView("available"); }}
              className="pos-btn mt-3 w-full rounded-xl p-4 flex items-center justify-between" style={panel}>
              <span className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>Deliveries waiting for a driver</span>
              <span className="text-lg font-extrabold tabular-nums" style={{ color: "var(--pos-accent)" }}>{available.length}</span>
            </button>
          </>
        )}

        {tab === "orders" && (
          <>
            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg mb-3" style={subtle}>
              {[["available", `Available · ${available.length}`], ["mine", `Mine · ${active.length}`]].map(([k, label]) => (
                <button key={k} onClick={() => setOrdersView(k)} className="h-9 rounded-md text-sm font-bold"
                  style={ordersView === k ? { background: "var(--pos-panel)", color: "var(--pos-text)" } : { color: "var(--pos-muted)" }}>{label}</button>
              ))}
            </div>
            {ordersView === "available"
              ? (available.length ? cards(available, false) : <Empty>Nothing waiting right now.</Empty>)
              : (active.length ? cards(active, true) : <Empty>No active deliveries.</Empty>)}
          </>
        )}

        {tab === "earnings" && (
          <>
            <div className="rounded-xl p-4 mb-3" style={panel}>
              <div className="text-[11px] uppercase tracking-wider font-bold" style={{ color: "var(--pos-muted)" }}>Today</div>
              <div className="text-3xl font-extrabold tabular-nums" style={{ color: "var(--pos-text)" }}>{rupees(stats.deliveryFees + stats.tips)}</div>
              <div className="text-xs" style={{ color: "var(--pos-muted)" }}>Delivery fees {rupees(stats.deliveryFees)} · Tips {rupees(stats.tips)} · {stats.delivered} deliveries</div>
              <div className="mt-3 pt-3 flex justify-between text-sm" style={{ borderTop: "1px solid var(--pos-border)" }}>
                <span style={{ color: "var(--pos-muted)" }}>Cash to hand over</span>
                <span className="font-extrabold tabular-nums" style={{ color: "#dc2626" }}>{rupees(stats.cashInHand)}</span>
              </div>
            </div>
            <h2 className="text-[11px] uppercase tracking-wider font-bold mb-2" style={{ color: "var(--pos-muted)" }}>Delivered today · {completed.length}</h2>
            {completed.length ? completed.map((o) => (
              <button key={o.id} onClick={() => setOpenId(o.id)} className="w-full text-left rounded-xl p-3 mb-2 flex items-center justify-between" style={panel}>
                <div>
                  <div className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>#{o.number} · {o.customer?.name}</div>
                  <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>
                    {fmtTime(o.statusTimes?.completed)} · {o.payment === "cash" ? `Cash ${rupees(o.total)}` : "Prepaid"}
                  </div>
                </div>
                <div className="text-sm font-bold tabular-nums" style={{ color: "var(--pos-text)" }}>{rupees((o.deliveryFee || 0) + (o.tip || 0))}</div>
              </button>
            )) : <Empty>No deliveries completed today yet.</Empty>}
          </>
        )}

        {tab === "account" && (
          <>
            <div className="rounded-xl p-4 mb-3" style={panel}>
              <div className="text-base font-bold" style={{ color: "var(--pos-text)" }}>{staffUser.name}</div>
              <div className="text-sm" style={{ color: "var(--pos-muted)" }}>Driver · {store?.name}</div>
              {store?.phone && (
                <a href={`tel:${store.phone}`} className="pos-btn mt-3 h-10 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5" style={subtle}>
                  <Phone className="w-4 h-4" />Call the store
                </a>
              )}
            </div>
            <div className="rounded-xl p-3 mb-3" style={panel}>
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-bold mb-2" style={{ color: "var(--pos-muted)" }}>
                <CalendarDays className="w-3.5 h-3.5" />My rota
              </div>
              <MyRotaTab weekStart={weekStart} weekEnd={weekEnd} />
            </div>
            <button data-testid="driver-logout" onClick={() => { logout(); window.location.assign(`/pos/${slug}/login`); }}
              className="pos-btn w-full h-11 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5" style={subtle}>
              <LogOut className="w-4 h-4" />Sign out
            </button>
          </>
        )}
      </main>

      <nav className="fixed bottom-0 inset-x-0 z-10 grid grid-cols-4" style={{ background: "var(--pos-panel)", borderTop: "1px solid var(--pos-border)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        {[
          ["home", "Home", Home, null],
          ["orders", "Orders", ListOrdered, available.length || null],
          ["earnings", "Earnings", Wallet, null],
          ["account", "Account", User, null],
        ].map(([k, label, Icon, badge]) => (
          <button key={k} data-testid={`driver-tab-${k}`} onClick={() => setTab(k)} className="relative h-14 flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold"
            style={{ color: tab === k ? "var(--pos-accent)" : "var(--pos-muted)" }}>
            <Icon className="w-5 h-5" />{label}
            {badge && <span className="absolute top-1.5 left-1/2 ml-2 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] text-white flex items-center justify-center" style={{ background: "var(--pos-accent)" }}>{badge}</span>}
          </button>
        ))}
      </nav>

      <button data-testid="driver-refresh" onClick={load} aria-label="Refresh"
        className="fixed right-3 bottom-20 z-10 h-10 w-10 rounded-full flex items-center justify-center shadow" style={subtle}>
        <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}
