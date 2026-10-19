import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { usePos } from "../../store/PosContext";
import { Bike, ShoppingBag, UtensilsCrossed, ChevronRight, Clock, Receipt, Undo2, Ban, CreditCard } from "lucide-react";
import { toast } from "sonner";
import ReceiptModal from "./ReceiptModal";
import RefundVoidModal from "./RefundVoidModal";
import { timeAgo } from "../../utils/timeAgo";
import { orderNo } from "../../utils/orderNumber";

const STATUS_FLOW = ["new", "in-kitchen", "ready", "out-for-delivery", "completed"];
const STATUS_META = {
  "new": { label: "New", color: "#3b82f6", bg: "#14233f" },
  "in-kitchen": { label: "In Kitchen", color: "#f59e0b", bg: "#33260e" },
  "ready": { label: "Ready", color: "#22c55e", bg: "#13271a" },
  "out-for-delivery": { label: "Out for Delivery", color: "#3b82f6", bg: "#14233f" },
  "completed": { label: "Completed", color: "var(--pos-muted)", bg: "#1a2235" },
};
const VOIDED_META = { label: "Voided", color: "#f87171", bg: "#2b1212" };
const REFUNDED_META = { label: "Refunded", color: "#fbbf24", bg: "#33260e" };

// A voided or fully refunded order is no longer in its kitchen/payment state,
// so the headline badge says so instead of the stale "Completed"/"New".
function statusMeta(order) {
  if (order.voided) return VOIDED_META;
  if (order.refunded_amount > 0 && order.refunded_amount >= order.total) return REFUNDED_META;
  return STATUS_META[order.status];
}

const TYPE_ICON = { delivery: Bike, collection: ShoppingBag, "dine-in": UtensilsCrossed };

function nextStatus(order) {
  if (order.voided) return null;
  if (order.status === "completed") return null;
  if (order.status === "ready") return order.type === "delivery" ? "out-for-delivery" : "completed";
  const idx = STATUS_FLOW.indexOf(order.status);
  return STATUS_FLOW[idx + 1];
}

export default function OrdersScreen() {
  const { orders, updateOrderStatus, staffUser, reloadOrders } = usePos();
  const navigate = useNavigate();
  const { slug } = useParams();
  const [filter, setFilter] = useState("active");
  const [receiptOrderId, setReceiptOrderId] = useState(null);
  const [refundOrder, setRefundOrder] = useState(null);

  const filtered = orders.filter((o) => {
    if (filter === "active") return o.status !== "completed";
    if (filter === "all") return true;
    return o.status === filter;
  });

  // Closing an unpaid order would hide the Bill button and block voiding, so
  // the last step for an unpaid non-delivery order is collecting payment, not
  // "Mark Completed" (delivery stays exempt: the driver collects cash).
  const needsPayment = (order) => nextStatus(order) === "completed" && order.payment === "unpaid" && order.type !== "delivery";

  const advance = (order) => {
    const ns = nextStatus(order);
    if (!ns) return;
    if (needsPayment(order)) { navigate(`/${slug}/pos?order=${order.id}`); return; }
    updateOrderStatus(order.id, ns);
    toast.success(`Order ${orderNo(order)} → ${STATUS_META[ns].label}`);
  };

  const FILTERS = [
    { id: "active", label: "Active" },
    { id: "new", label: "New" },
    { id: "in-kitchen", label: "In Kitchen" },
    { id: "ready", label: "Ready" },
    { id: "out-for-delivery", label: "Delivering" },
    { id: "completed", label: "Completed" },
    { id: "all", label: "All" },
  ];

  return (
    <div className="h-full flex flex-col p-4 gap-3" data-testid="orders-screen">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold" style={{ color: "var(--pos-text)" }}>Order Tickets</h2>
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map((f) => (
            <button key={f.id} data-testid={`filter-${f.id}`} onClick={() => setFilter(f.id)}
              className="pos-btn px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: filter === f.id ? "var(--pos-accent)" : "var(--pos-panel)", color: filter === f.id ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pos-scroll">
        {filtered.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-sm" style={{ color: "var(--pos-muted)" }}>No orders in this view.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map((o) => {
              const meta = statusMeta(o);
              const TypeIcon = TYPE_ICON[o.type];
              const ns = nextStatus(o);
              return (
                <div key={o.id} className="rounded-xl p-4 fade-in flex flex-col" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }} data-testid={`order-card-${o.number}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold" style={{ color: "var(--pos-text)" }}>{orderNo(o)}</span>
                        <TypeIcon className="w-4 h-4" style={{ color: "var(--pos-muted)" }} />
                        <span className="text-xs capitalize" style={{ color: "var(--pos-muted)" }}>{o.type}{o.table ? ` · Table ${o.table}` : ""}</span>
                      </div>
                      <div className="text-sm mt-0.5" style={{ color: "var(--pos-text)" }}>{o.customer?.name}</div>
                      {o.customer?.address && <div className="text-xs" style={{ color: "var(--pos-muted)" }}>{o.customer.address}{o.customer.postcode ? `, ${o.customer.postcode}` : ""}</div>}
                    </div>
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide shrink-0" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
                  </div>

                  <div className="rounded-lg p-2.5 mb-2 space-y-1" style={{ background: "var(--pos-panel-2)" }}>
                    {o.items.map((it, i) => (
                      <div key={`${o.id}-item-${i}`} className="text-xs">
                        <div className="flex justify-between" style={{ color: "var(--pos-text)" }}><span>{it.qty}× {it.name}</span><span className="tabular-nums" style={{ color: "var(--pos-muted)" }}>₹{(it.price * it.qty).toFixed(2)}</span></div>
                        {it.mods?.length > 0 && <div style={{ color: "var(--pos-muted)" }} className="pl-4">{it.mods.join(" · ")}</div>}
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between mt-auto">
                    <div className="text-xs flex items-center gap-1" style={{ color: "var(--pos-muted)" }}>
                      <Clock className="w-3.5 h-3.5" /> {timeAgo(o.placedAt)} · <span className="uppercase font-semibold" style={{ color: o.payment === "unpaid" ? "#f87171" : "#7ee2a8" }}>{o.payment}</span>
                    </div>
                    <div className="font-bold tabular-nums" style={{ color: "var(--pos-text)" }}>₹{o.total.toFixed(2)}</div>
                  </div>

                  {ns && (
                    <button data-testid={`advance-${o.number}`} onClick={() => advance(o)}
                      className="pos-btn mt-3 h-10 rounded-lg text-sm font-bold text-white flex items-center justify-center gap-1"
                      style={{ background: STATUS_META[ns].color }}>
                      {needsPayment(o) ? "Collect payment" : `Mark ${STATUS_META[ns].label}`} <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                  <button data-testid={`receipt-${o.number}`} onClick={() => setReceiptOrderId(o.id)}
                    className="pos-btn mt-2 h-9 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5"
                    style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                    <Receipt className="w-3.5 h-3.5" /> Receipt / KOT
                  </button>
                  {o.payment === "unpaid" && !o.voided && (
                    <button data-testid={`bill-${o.number}`} onClick={() => navigate(`/${slug}/pos?order=${o.id}`)}
                      className="pos-btn mt-2 h-9 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-1.5"
                      style={{ background: "var(--pos-accent)" }}>
                      <CreditCard className="w-3.5 h-3.5" /> Bill this order
                    </button>
                  )}
                  {staffUser?.role === "Manager" && !o.voided && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <button data-testid={`refund-${o.number}`} onClick={() => setRefundOrder({ ...o, kind: "refund" })}
                        disabled={o.payment === "unpaid" || (o.refunded_amount || 0) >= o.total}
                        className="pos-btn h-8 rounded-md text-xs font-bold flex items-center justify-center gap-1 disabled:opacity-40"
                        style={{ background: "var(--pos-panel-2)", color: "#fcd34d", border: "1px solid #6b4f0c" }}>
                        <Undo2 className="w-3 h-3" /> Refund
                      </button>
                      <button data-testid={`void-${o.number}`} onClick={() => setRefundOrder({ ...o, kind: "void" })}
                        disabled={["served", "completed"].includes(o.status) && o.payment !== "unpaid"}
                        className="pos-btn h-8 rounded-md text-xs font-bold flex items-center justify-center gap-1 disabled:opacity-40"
                        style={{ background: "var(--pos-panel-2)", color: "#fca5a5", border: "1px solid #6b1f1f" }}>
                        <Ban className="w-3 h-3" /> Void
                      </button>
                    </div>
                  )}
                  {(o.refunded_amount > 0 || o.voided) && (
                    <div className="mt-2 text-[10px] px-2 py-1 rounded text-center" data-testid={`refund-badge-${o.number}`}
                      style={{ background: o.voided ? "#321519" : "#251a0e", color: o.voided ? "#fca5a5" : "#fcd34d" }}>
                      {o.voided ? `VOIDED by ${o.voided_by || "manager"}` : `Refunded ₹${o.refunded_amount.toFixed(2)}`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <ReceiptModal orderId={receiptOrderId} open={!!receiptOrderId} onClose={() => setReceiptOrderId(null)} />
      <RefundVoidModal order={refundOrder} onClose={() => setRefundOrder(null)} onDone={() => { setRefundOrder(null); reloadOrders && reloadOrders(); }} />
    </div>
  );
}
