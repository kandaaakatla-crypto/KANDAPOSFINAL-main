import React, { useEffect, useState, useRef } from "react";
import { usePos } from "../../store/PosContext";
import { tablesApi } from "../../api/client";
import { LayoutGrid, Plus, Save, Trash2, Square, Circle, RectangleHorizontal, Move, RotateCw } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "../ui/alert-dialog";

const GRID = 10;
const MIN_SIZE = 40;
const snap = (n) => Math.round(n / GRID) * GRID;

const STATUS_COLOR = {
  available: "#22c55e",
  occupied: "#ef4444",
  reserved: "#f59e0b",
};

function TableShape({ t, selected, editable, onPointerDown, onResizePointerDown, onRotatePointerDown }) {
  const radius = t.shape === "round" ? "50%" : t.shape === "rect" ? "12px" : "10px";
  return (
    <div
      data-testid={`floor-table-${t.id}`}
      onPointerDown={onPointerDown}
      className="absolute flex flex-col items-center justify-center font-bold cursor-move select-none"
      style={{
        left: t.x, top: t.y, width: t.width, height: t.height,
        background: STATUS_COLOR[t.status] + (selected ? "" : "33"),
        border: `2px solid ${STATUS_COLOR[t.status]}`,
        borderRadius: radius,
        transform: `rotate(${t.rotation || 0}deg)`,
        boxShadow: selected ? "0 0 0 3px var(--pos-accent), 0 0 24px rgba(0,0,0,0.4)" : "none",
        transition: "background 80ms, box-shadow 80ms",
        color: "var(--pos-text)",
      }}
    >
      <div className="text-base leading-none">T{t.number}</div>
      <div className="text-[9px] mt-0.5 opacity-80">{t.seats} seats</div>

      {selected && editable && (
        <>
          {/* Rotate handle — drag around the shape's center to set rotation */}
          <div
            data-testid={`rotate-handle-${t.id}`}
            onPointerDown={onRotatePointerDown}
            className="absolute rounded-full cursor-alias flex items-center justify-center"
            style={{
              width: 20, height: 20, left: "50%", top: -30, transform: "translateX(-50%)",
              background: "var(--pos-accent)", border: "2px solid #fff", touchAction: "none",
            }}
            title="Drag to rotate"
          >
            <RotateCw className="w-3 h-3 text-white" />
          </div>
          <div className="absolute" style={{ left: "50%", top: -10, width: 2, height: 10, background: "var(--pos-accent)", transform: "translateX(-50%)" }} />

          {/* Resize handle — drag to change width/height */}
          <div
            data-testid={`resize-handle-${t.id}`}
            onPointerDown={onResizePointerDown}
            className="absolute cursor-nwse-resize"
            style={{
              width: 16, height: 16, right: -8, bottom: -8,
              background: "var(--pos-accent)", border: "2px solid #fff", borderRadius: 4, touchAction: "none",
            }}
            title="Drag to resize"
          />
        </>
      )}
    </div>
  );
}

/** Free-form layout editor — drag to move/resize/rotate, side panel for shape + delete. */
export default function TableLayoutEditor({ onExit }) {
  const { tables, staffUser, refreshTables } = usePos();
  const isManager = staffUser?.role === "Manager";
  const [localTables, setLocalTables] = useState(tables.map((t) => ({ ...t })));
  const [selectedId, setSelectedId] = useState(null);
  const [floor, setFloor] = useState([]);
  const dragRef = useRef({ id: null, mode: null, ox: 0, oy: 0, startW: 0, startH: 0, startX: 0, startY: 0 });
  const canvasRef = useRef(null);

  useEffect(() => {
    setLocalTables(tables.map((t) => ({ ...t, x: t.x ?? 0, y: t.y ?? 0, width: t.width ?? 80, height: t.height ?? 80, shape: t.shape || "square" })));
  }, [tables]);

  useEffect(() => {
    tablesApi.listFloor().then(setFloor).catch(() => {});
  }, []);

  const selected = localTables.find((t) => t.id === selectedId);

  const onPointerDown = (e, t) => {
    if (!isManager) return;
    setSelectedId(t.id);
    const rect = canvasRef.current.getBoundingClientRect();
    dragRef.current = { id: t.id, mode: "move", ox: e.clientX - rect.left - t.x, oy: e.clientY - rect.top - t.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizePointerDown = (e, t) => {
    if (!isManager) return;
    e.stopPropagation();
    dragRef.current = { id: t.id, mode: "resize", startX: e.clientX, startY: e.clientY, startW: t.width, startH: t.height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onRotatePointerDown = (e, t) => {
    if (!isManager) return;
    e.stopPropagation();
    dragRef.current = { id: t.id, mode: "rotate" };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d.id) return;
    const rect = canvasRef.current.getBoundingClientRect();

    if (d.mode === "move") {
      const x = snap(Math.max(0, e.clientX - rect.left - d.ox));
      const y = snap(Math.max(0, e.clientY - rect.top - d.oy));
      setLocalTables((ts) => ts.map((t) => (t.id === d.id ? { ...t, x, y } : t)));
      return;
    }
    if (d.mode === "resize") {
      const width = snap(Math.max(MIN_SIZE, d.startW + (e.clientX - d.startX)));
      const height = snap(Math.max(MIN_SIZE, d.startH + (e.clientY - d.startY)));
      setLocalTables((ts) => ts.map((t) => (t.id === d.id ? { ...t, width, height } : t)));
      return;
    }
    if (d.mode === "rotate") {
      const t = localTables.find((tt) => tt.id === d.id);
      if (!t) return;
      const cx = rect.left + t.x + t.width / 2;
      const cy = rect.top + t.y + t.height / 2;
      const angle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI) + 90;
      const rotation = Math.round((((angle % 360) + 360) % 360) / 5) * 5;
      setLocalTables((ts) => ts.map((tt) => (tt.id === d.id ? { ...tt, rotation } : tt)));
    }
  };
  const onPointerUp = () => { dragRef.current = { id: null, mode: null, ox: 0, oy: 0, startW: 0, startH: 0, startX: 0, startY: 0 }; };

  const patch = (changes) => {
    if (!selected) return;
    setLocalTables((ts) => ts.map((t) => (t.id === selected.id ? { ...t, ...changes } : t)));
  };

  const save = async () => {
    try {
      await Promise.all(localTables.map((t) =>
        tablesApi.setPosition(t.id, { x: t.x, y: t.y, width: t.width, height: t.height, shape: t.shape, rotation: t.rotation || 0 })
      ));
      if (refreshTables) await refreshTables();
      toast.success("Layout saved");
    } catch (e) {
      toast.error("Could not save layout");
    }
  };

  const addTable = async () => {
    const nums = localTables.map((t) => t.number);
    const next = Math.max(0, ...nums) + 1;
    try {
      const t = await tablesApi.create({ number: next, seats: 4, x: 30, y: 30, width: 80, height: 80, shape: "square" });
      setLocalTables((ts) => [...ts, t]);
      setSelectedId(t.id);
      if (refreshTables) await refreshTables();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not add table");
    }
  };

  const removeTable = async () => {
    if (!selected) return;
    await tablesApi.remove(selected.id);
    setLocalTables((ts) => ts.filter((t) => t.id !== selected.id));
    setSelectedId(null);
    if (refreshTables) await refreshTables();
  };

  return (
    <div className="h-full flex flex-col" data-testid="table-layout-editor">
      <div className="flex items-center justify-between px-4 py-2" style={{ background: "var(--pos-panel)", borderBottom: "1px solid var(--pos-border)" }}>
        <div className="flex items-center gap-2">
          <LayoutGrid className="w-4 h-4" style={{ color: "var(--pos-accent)" }} />
          <span className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>Floor layout</span>
          {!isManager && <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>Read-only</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {isManager && (
            <>
              <button data-testid="layout-add-table" onClick={addTable} className="pos-btn h-9 px-3 rounded-md text-xs font-bold flex items-center gap-1.5"
                style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                <Plus className="w-3.5 h-3.5" /> Add table
              </button>
              <button data-testid="layout-save" onClick={save} className="pos-btn h-9 px-3 rounded-md text-xs font-bold flex items-center gap-1.5 text-white"
                style={{ background: "var(--pos-accent)" }}>
                <Save className="w-3.5 h-3.5" /> Save
              </button>
            </>
          )}
          <button data-testid="layout-close" onClick={onExit} className="pos-btn h-9 px-3 rounded-md text-xs font-bold"
            style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
            Close
          </button>
        </div>
      </div>

      <div className="flex-1 flex">
        <div ref={canvasRef} className="flex-1 relative overflow-auto"
          onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          style={{ background: "repeating-linear-gradient(45deg, var(--pos-bg) 0 12px, var(--pos-panel) 12px 13px)", minHeight: 480 }}>
          {floor.map((fe) => (
            <div key={fe.id} className="absolute pointer-events-none" style={{
              left: fe.x, top: fe.y, width: fe.width, height: fe.height,
              background: fe.color || "#444", borderRadius: 2,
              transform: `rotate(${fe.rotation || 0}deg)`, opacity: 0.5,
            }}>
              {fe.kind === "label" && (
                <div className="text-[10px] text-white font-bold px-1">{fe.label}</div>
              )}
            </div>
          ))}
          {localTables.map((t) => (
            <TableShape key={t.id} t={t} selected={t.id === selectedId} editable={isManager}
              onPointerDown={(e) => onPointerDown(e, t)}
              onResizePointerDown={(e) => onResizePointerDown(e, t)}
              onRotatePointerDown={(e) => onRotatePointerDown(e, t)} />
          ))}
        </div>

        {selected && isManager && (
          <aside className="w-64 p-3 space-y-3" data-testid="layout-side-panel" style={{ background: "var(--pos-panel)", borderLeft: "1px solid var(--pos-border)" }}>
            <div>
              <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--pos-muted)" }}>Table {selected.number}</div>
              <div className="text-[11px]" style={{ color: "var(--pos-muted)" }}>Status: {selected.status}</div>
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--pos-muted)" }}>Shape</div>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: "square", icon: Square },
                  { id: "round", icon: Circle },
                  { id: "rect", icon: RectangleHorizontal },
                ].map((s) => (
                  <button key={s.id} data-testid={`shape-${s.id}`} onClick={() => patch({ shape: s.id })}
                    className="pos-btn h-9 rounded-md flex items-center justify-center"
                    style={{ background: selected.shape === s.id ? "var(--pos-accent)" : "var(--pos-panel-2)", color: selected.shape === s.id ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
                    <s.icon className="w-4 h-4" />
                  </button>
                ))}
              </div>
            </div>

            <label className="text-[10px] uppercase tracking-wider block" style={{ color: "var(--pos-muted)" }}>
              seats
              <input type="number" value={selected.seats || 0} onChange={(e) => patch({ seats: Number(e.target.value) })}
                className="mt-1 w-full h-9 px-2 rounded-md text-sm"
                style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
            </label>

            <div className="rounded-md px-3 py-2 text-xs tabular-nums" data-testid="layout-dimensions" style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}>
              {Math.round(selected.width)} × {Math.round(selected.height)} px · {selected.rotation || 0}°
            </div>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button data-testid="layout-remove-table"
                  className="pos-btn w-full h-9 rounded-md text-xs font-bold flex items-center justify-center gap-1.5"
                  style={{ background: "var(--pos-panel-2)", color: "#dc2626", border: "1px solid rgba(220,38,38,0.4)" }}>
                  <Trash2 className="w-3.5 h-3.5" /> Remove table
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove table?</AlertDialogTitle>
                  <AlertDialogDescription>Remove table {selected.number}?</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction data-testid="layout-remove-table-confirm" onClick={removeTable}>Remove</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <div className="text-[10px] flex items-start gap-1.5 mt-2 pt-2" style={{ color: "var(--pos-muted)", borderTop: "1px solid var(--pos-border)" }}>
              <Move className="w-3 h-3 mt-0.5 flex-shrink-0" /> Drag to move · drag the orange corner to resize · drag the orange dot to rotate.
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
