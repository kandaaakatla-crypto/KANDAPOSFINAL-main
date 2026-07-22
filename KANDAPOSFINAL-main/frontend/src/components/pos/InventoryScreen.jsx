import React, { useState } from "react";
import { usePos } from "../../store/PosContext";
import { Minus, Plus, AlertTriangle, PackageCheck, Truck, Trash } from "lucide-react";
import { toast } from "sonner";
import { WastePanel } from "./OpsPanels";

export default function InventoryScreen() {
  const { inventory, adjustStock, reorderStock, staffUser } = usePos();
  const [view, setView] = useState("all");
  const [showWaste, setShowWaste] = useState(false);

  const lowItems = inventory.filter((i) => i.stock <= i.reorder);
  const list = view === "low" ? lowItems : inventory;

  return (
    <div className="h-full flex flex-col p-4 gap-4" data-testid="inventory-screen">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold text-white">Inventory &amp; Stock</h2>
        <div className="flex gap-2">
          <button data-testid="inv-filter-all" onClick={() => setView("all")} className="pos-btn px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: view === "all" ? "var(--pos-accent)" : "var(--pos-panel)", color: view === "all" ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
            All Items ({inventory.length})
          </button>
          <button data-testid="inv-filter-low" onClick={() => setView("low")} className="pos-btn px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"
            style={{ background: view === "low" ? "#b91c1c" : "var(--pos-panel)", color: view === "low" ? "#fff" : "#f87171", border: "1px solid var(--pos-border)" }}>
            <AlertTriangle className="w-3.5 h-3.5" /> Low Stock ({lowItems.length})
          </button>
          <button data-testid="inv-toggle-waste" onClick={() => setShowWaste((v) => !v)} className="pos-btn px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"
            style={{ background: showWaste ? "var(--pos-accent)" : "var(--pos-panel)", color: showWaste ? "#fff" : "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
            <Trash className="w-3.5 h-3.5" /> Wastage log
          </button>
        </div>
      </div>

      {showWaste && (
        <div className="rounded-xl p-4" data-testid="waste-section"
          style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
            <Trash className="w-4 h-4" /> Wastage / spoilage log
          </h3>
          <WastePanel />
        </div>
      )}

      {lowItems.length > 0 && view === "all" && (
        <div className="rounded-xl px-4 py-3 flex items-center gap-3 text-sm" style={{ background: "#33150e", border: "1px solid #7d3a2e", color: "#fca5a5" }} data-testid="low-stock-banner">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {lowItems.length} item{lowItems.length > 1 ? "s" : ""} at or below reorder level: {lowItems.map((i) => i.name).join(", ")}
        </div>
      )}

      <div className="flex-1 overflow-y-auto pos-scroll rounded-xl" style={{ border: "1px solid var(--pos-border)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "var(--pos-panel)" }}>
              {["Item", "In Stock", "Reorder Level", "Supplier", "Status", "Adjust"].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs uppercase tracking-wider font-semibold" style={{ color: "var(--pos-muted)", borderBottom: "1px solid var(--pos-border)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((i) => {
              const low = i.stock <= i.reorder;
              return (
                <tr key={i.id} data-testid={`inv-row-${i.id}`} style={{ borderBottom: "1px solid var(--pos-border)", background: low ? "#2a141077" : "transparent" }}>
                  <td className="px-4 py-3 font-medium text-white">{i.name}</td>
                  <td className="px-4 py-3 tabular-nums font-bold" style={{ color: low ? "#f87171" : "#7ee2a8" }}>{i.stock} {i.unit}</td>
                  <td className="px-4 py-3 tabular-nums" style={{ color: "var(--pos-muted)" }}>{i.reorder} {i.unit}</td>
                  <td className="px-4 py-3" style={{ color: "var(--pos-muted)" }}>{i.supplier}</td>
                  <td className="px-4 py-3">
                    {low ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full uppercase" style={{ background: "#3a1515", color: "#f87171" }}><AlertTriangle className="w-3 h-3" /> Reorder</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full uppercase" style={{ background: "#13271a", color: "#22c55e" }}><PackageCheck className="w-3 h-3" /> OK</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button data-testid={`stock-minus-${i.id}`} onClick={() => adjustStock(i.id, -1)} className="pos-btn w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}><Minus className="w-3.5 h-3.5 text-white" /></button>
                      <button data-testid={`stock-plus-${i.id}`} onClick={() => adjustStock(i.id, 1)} className="pos-btn w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}><Plus className="w-3.5 h-3.5 text-white" /></button>
                      {low && (
                        <button data-testid={`reorder-${i.id}`} onClick={() => { reorderStock(i.id); toast.success(`Purchase order sent for ${i.name}`); }}
                          className="pos-btn h-8 px-3 rounded-lg text-xs font-bold text-white flex items-center gap-1" style={{ background: "var(--pos-blue)" }}>
                          <Truck className="w-3.5 h-3.5" /> Reorder
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
