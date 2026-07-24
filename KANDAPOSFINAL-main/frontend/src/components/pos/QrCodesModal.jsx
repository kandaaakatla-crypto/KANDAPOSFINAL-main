import React, { useEffect, useState } from "react";
import { usePos } from "../../store/PosContext";
import { tablesApi, kioskApi } from "../../api/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { QrCode, Copy, ExternalLink, ShoppingBag, ChefHat, Monitor } from "lucide-react";
import { toast } from "sonner";

function QrBlock({ title, icon: Icon, loading, data, testid }) {
  if (loading) return <div className="text-xs py-4 text-center" style={{ color: "var(--pos-muted)" }}>Loading…</div>;
  if (!data) return null;
  return (
    <div className="rounded-xl p-4 flex items-center gap-4" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} data-testid={testid}>
      <img src={`data:image/png;base64,${data.qrPngBase64}`} alt={title} className="w-24 h-24 rounded-lg bg-white p-1.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-white flex items-center gap-1.5 mb-1"><Icon className="w-3.5 h-3.5" style={{ color: "var(--pos-accent)" }} /> {title}</div>
        <div className="text-[11px] font-mono truncate mb-2" style={{ color: "var(--pos-muted)" }}>{data.url}</div>
        <div className="flex gap-1.5">
          <button onClick={() => { navigator.clipboard.writeText(data.url); toast.success("Link copied"); }}
            className="pos-btn h-7 px-2 rounded-md text-[11px] font-bold flex items-center gap-1" style={{ background: "var(--pos-panel)", color: "var(--pos-muted)" }}>
            <Copy className="w-3 h-3" /> Copy
          </button>
          <a href={data.url} target="_blank" rel="noreferrer" className="pos-btn h-7 px-2 rounded-md text-[11px] font-bold flex items-center gap-1" style={{ background: "var(--pos-panel)", color: "var(--pos-muted)" }}>
            <ExternalLink className="w-3 h-3" /> Open
          </a>
        </div>
      </div>
    </div>
  );
}

function LinkBlock({ title, icon: Icon, url, testid }) {
  if (!url) return null;
  return (
    <div className="rounded-xl p-3 flex items-center justify-between gap-2" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} data-testid={testid}>
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="w-4 h-4 shrink-0" style={{ color: "var(--pos-accent)" }} />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="text-[11px] font-mono truncate" style={{ color: "var(--pos-muted)" }}>{url}</div>
        </div>
      </div>
      <div className="flex gap-1.5 shrink-0">
        <button onClick={() => { navigator.clipboard.writeText(url); toast.success("Link copied"); }}
          className="pos-btn h-7 px-2 rounded-md text-[11px] font-bold flex items-center gap-1" style={{ background: "var(--pos-panel)", color: "var(--pos-muted)" }}>
          <Copy className="w-3 h-3" /> Copy
        </button>
        <a href={url} target="_blank" rel="noreferrer" className="pos-btn h-7 px-2 rounded-md text-[11px] font-bold flex items-center gap-1" style={{ background: "var(--pos-panel)", color: "var(--pos-muted)" }}>
          <ExternalLink className="w-3 h-3" /> Open
        </a>
      </div>
    </div>
  );
}

export default function QrCodesModal({ open, onClose }) {
  const { tables } = usePos();
  const [pickup, setPickup] = useState(null);
  const [pickupLoading, setPickupLoading] = useState(true);
  const [tableId, setTableId] = useState("");
  const [tableQr, setTableQr] = useState(null);
  const [tableQrLoading, setTableQrLoading] = useState(false);
  const [kioskToken, setKioskToken] = useState("");

  useEffect(() => {
    if (!open) return;
    setPickupLoading(true);
    tablesApi.pickupQr().then(setPickup).catch(() => toast.error("Could not load pickup QR")).finally(() => setPickupLoading(false));
    kioskApi.myToken().then((r) => setKioskToken(r.token)).catch(() => {});
    if (!tableId && tables.length) setTableId(tables[0].id);
  }, [open]); // eslint-disable-line

  const loadTableQr = (id) => {
    setTableId(id);
    setTableQrLoading(true);
    setTableQr(null);
    tablesApi.qr(id).then(setTableQr).catch(() => toast.error("Could not load table QR")).finally(() => setTableQrLoading(false));
  };

  const origin = window.location.origin;
  const kdsUrl = kioskToken ? `${origin}/kds?token=${kioskToken}` : "";
  const displayUrl = kioskToken ? `${origin}/display?token=${kioskToken}` : "";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
        <DialogHeader><DialogTitle className="text-white flex items-center gap-2"><QrCode className="w-4 h-4" style={{ color: "var(--pos-accent)" }} /> Ordering QR Codes &amp; Screens</DialogTitle></DialogHeader>

        <div className="space-y-5">
          <div>
            <div className="text-[10px] uppercase tracking-wider mb-2 font-semibold" style={{ color: "var(--pos-muted)" }}>Pickup ordering</div>
            <QrBlock title="Pickup QR" icon={ShoppingBag} loading={pickupLoading} data={pickup} testid="pickup-qr-block" />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider mb-2 font-semibold" style={{ color: "var(--pos-muted)" }}>Table ordering</div>
            <Select value={tableId} onValueChange={loadTableQr}>
              <SelectTrigger data-testid="qr-table-select" className="h-10 text-white mb-2" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }}>
                <SelectValue placeholder="Choose a table" />
              </SelectTrigger>
              <SelectContent>
                {tables.map((t) => <SelectItem key={t.id} value={t.id}>Table {t.number}</SelectItem>)}
              </SelectContent>
            </Select>
            <QrBlock title={`Table QR`} icon={QrCode} loading={tableQrLoading} data={tableQr} testid="table-qr-block" />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider mb-2 font-semibold" style={{ color: "var(--pos-muted)" }}>Screens</div>
            <div className="space-y-2">
              <LinkBlock title="Kitchen Display" icon={ChefHat} url={kdsUrl} testid="kds-link-block" />
              <LinkBlock title="Customer Display" icon={Monitor} url={displayUrl} testid="display-link-block" />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
