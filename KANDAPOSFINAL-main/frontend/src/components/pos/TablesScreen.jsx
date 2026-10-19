import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { usePos } from "../../store/PosContext";
import { tablesApi } from "../../api/client";
import { Users, CircleDot, LayoutGrid, CalendarClock, IndianRupee, QrCode } from "lucide-react";
import { toast } from "sonner";
import TableLayoutEditor from "./TableLayoutEditor";
import ReservationModal from "./ReservationModal";
import QrCodesModal from "./QrCodesModal";
import { withDefaultLayout } from "../../utils/tableLayout";
import { orderNo } from "../../utils/orderNumber";

const STATUS_STYLE = {
  available: { color: "#22c55e", bg: "#13271a", border: "#2e7d4f", label: "Available" },
  occupied:  { color: "#ef4444", bg: "#321519", border: "#7d2e2e", label: "Occupied" },
  reserved:  { color: "#f59e0b", bg: "#33260e", border: "#7d5e2e", label: "Reserved" },
};

/**
 * Table Plan — spatial floor layout view.
 *
 * Renders each table at its saved (x, y, width, height, shape, rotation)
 * so the layout matches what was drawn in the editor. Available tables
 * are clickable to jump straight into New Order for that table.
 */
export default function TablesScreen() {
  const { tables, orders, setTableStatus, staffUser, features } = usePos();
  const navigate = useNavigate();
  const { slug } = useParams();
  const [layoutMode, setLayoutMode] = useState(false);
  const [resModalOpen, setResModalOpen] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [floor, setFloor] = useState([]);
  const isManager = staffUser?.role === "Manager";

  useEffect(() => { tablesApi.listFloor().then(setFloor).catch(() => {}); }, [layoutMode]);

  if (layoutMode) return <TableLayoutEditor onExit={() => setLayoutMode(false)} />;

  const handleClick = (t) => {
    if (t.status === "available") {
      toast.success(`Starting order for T${t.number}`);
      navigate(`/${slug}/pos?table=${t.number}`);
    } else if (t.status === "occupied") {
      const order = orderFor(t);
      if (order) {
        toast.info(`Opening open bill for T${t.number}`);
        navigate(`/${slug}/pos?table=${t.number}&order=${order.id}`);
      }
    } else if (t.status === "reserved") {
      setTableStatus(t.id, "available");
      toast.success(`Table ${t.number} reservation cleared`);
    }
  };

  const orderFor = (t) => orders.find((o) => o.id === t.orderId);
  const counts = tables.reduce((acc, t) => ({ ...acc, [t.status]: (acc[t.status] || 0) + 1 }), {});

  return (
    <div className="h-full flex flex-col p-4 gap-4" data-testid="tables-screen">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold" style={{ color: "var(--pos-text)" }}>Table Plan</h2>
        <div className="flex items-center gap-3 flex-wrap">
          {Object.entries(STATUS_STYLE).map(([k, s]) => (
            <span key={k} className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--pos-muted)" }}>
              <CircleDot className="w-3.5 h-3.5" style={{ color: s.color }} /> {s.label} ({counts[k] || 0})
            </span>
          ))}
          <button data-testid="open-reservations" onClick={() => setResModalOpen(true)}
            className="pos-btn h-9 px-3 rounded-md text-xs font-bold flex items-center gap-1.5"
            style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
            <CalendarClock className="w-3.5 h-3.5" /> Reservations
          </button>
          <button data-testid="open-layout-editor" onClick={() => setLayoutMode(true)}
            className="pos-btn h-9 px-3 rounded-md text-xs font-bold flex items-center gap-1.5"
            style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
            <LayoutGrid className="w-3.5 h-3.5" /> Edit layout
          </button>
          {isManager && features.qr_ordering && (
            <button data-testid="open-qr-codes" onClick={() => setQrModalOpen(true)}
              className="pos-btn h-9 px-3 rounded-md text-xs font-bold flex items-center gap-1.5"
              style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
              <QrCode className="w-3.5 h-3.5" /> QR Codes
            </button>
          )}
        </div>
      </div>
      <ReservationModal open={resModalOpen} onClose={() => setResModalOpen(false)} />
      <QrCodesModal open={qrModalOpen} onClose={() => setQrModalOpen(false)} />

      {/* Spatial floor plan — tables rendered at their saved x/y/shape/rotation. */}
      <div className="relative flex-1 overflow-auto rounded-xl pos-scroll"
        data-testid="table-floor-canvas"
        style={{
          background: "repeating-linear-gradient(45deg, var(--pos-bg) 0 12px, var(--pos-panel) 12px 13px)",
          border: "1px solid var(--pos-border)",
          minHeight: 480,
        }}>
        {/* Non-table decorations (walls / labels / bar) — drawn behind tables. */}
        {floor.map((fe) => (
          <div key={fe.id} className="absolute pointer-events-none"
            style={{
              left: fe.x, top: fe.y, width: fe.width, height: fe.height,
              background: fe.color || "#444", borderRadius: 2,
              transform: `rotate(${fe.rotation || 0}deg)`, opacity: 0.5,
            }}>
            {fe.kind === "label" && (
              <div className="text-[10px] text-white font-bold px-1">{fe.label}</div>
            )}
          </div>
        ))}

        {/* Tables at their saved coordinates. */}
        {withDefaultLayout(tables).map((t) => {
          const s = STATUS_STYLE[t.status];
          const order = orderFor(t);
          const radius = t.shape === "round" ? "50%" : t.shape === "rect" ? "12px" : "10px";
          const w = t.width, h = t.height;
          return (
            <motion.button key={t.id} data-testid={`table-${t.number}`} onClick={() => handleClick(t)}
              whileHover={{ scale: 1.05 }} whileTap={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 22 }}
              className="pos-btn absolute flex flex-col items-center justify-center text-white cursor-pointer"
              style={{
                left: t.x, top: t.y, width: w, height: h,
                background: s.color + "26",
                border: `2px solid ${s.color}`,
                borderRadius: radius,
                rotate: t.rotation || 0,
                boxShadow: `0 4px 14px ${s.color}22`,
              }}
              title={`Table ${t.number} · ${s.label}${order ? ` · Order ${orderNo(order)}` : ""}`}>
              <div className="text-lg font-bold leading-none">T{t.number}</div>
              <div className="text-[9px] mt-1 flex items-center gap-0.5 opacity-90">
                <Users className="w-2.5 h-2.5" /> {t.seats}
              </div>
              {order && (
                <div className="text-[9px] mt-1 flex items-center gap-0.5 font-bold tabular-nums">
                  <IndianRupee className="w-2.5 h-2.5" /> {order.total.toFixed(0)}
                </div>
              )}
              <span
                className="absolute -top-2 -right-2 text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide"
                style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}` }}>
                {s.label[0]}
              </span>
            </motion.button>
          );
        })}

        {tables.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: "var(--pos-muted)" }}>
            No tables yet. Click <b className="mx-1" style={{ color: "var(--pos-text)" }}>Edit layout</b> to add your first one.
          </div>
        )}
      </div>

      <div className="text-[11px] flex items-center gap-2" style={{ color: "var(--pos-muted)" }}>
        <span>Tap an available table to start a new order · tap an occupied one to reopen its bill · tap a reserved table to clear the reservation.</span>
      </div>
    </div>
  );
}
