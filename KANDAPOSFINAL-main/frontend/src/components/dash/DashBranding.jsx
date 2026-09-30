import React, { useEffect, useRef, useState } from "react";
import { useDash } from "../../store/DashContext";
import { brandingApi } from "../../api/client";
import { Image as ImageIcon, UploadCloud, Trash2, Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";

const MAX_MB = 8;

function BrandingSlot({ title, hint, field, value, aspect, onChange }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const pick = () => inputRef.current?.click();

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image file"); return; }
    if (file.size > MAX_MB * 1024 * 1024) { toast.error(`Image must be under ${MAX_MB}MB`); return; }
    setBusy(true);
    try {
      const store = await brandingApi.upload(field, file);
      onChange(store);
      toast.success(`${title} updated`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const store = await brandingApi.clear(field);
      onChange(store);
      toast.success(`${title} removed`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not remove");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
      <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--pos-border)" }}>
        <div className="text-sm font-bold" style={{ color: "var(--pos-text)" }}>{title}</div>
        <div className="text-xs mt-0.5" style={{ color: "var(--pos-muted)" }}>{hint}</div>
      </div>
      <div className="p-5 space-y-4">
        <div className="rounded-lg flex items-center justify-center overflow-hidden"
          style={{ background: "var(--pos-panel-2)", border: "1px dashed var(--pos-border)", aspectRatio: aspect, maxHeight: 220 }}>
          {value ? (
            <img src={value} alt={title} className="w-full h-full object-cover" data-testid={`branding-preview-${field}`} />
          ) : (
            <ImageIcon className="w-8 h-8" style={{ color: "var(--pos-muted)" }} />
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFile} data-testid={`branding-file-${field}`} />
        <div className="flex gap-2">
          <button data-testid={`branding-upload-${field}`} onClick={pick} disabled={busy}
            className="pos-btn flex-1 h-10 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 text-white disabled:opacity-50"
            style={{ background: "var(--pos-accent)" }}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
            {value ? "Replace" : "Upload"}
          </button>
          {value && (
            <button data-testid={`branding-remove-${field}`} onClick={remove} disabled={busy}
              className="pos-btn h-10 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"
              style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "#f87171" }}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DashBranding() {
  const { tenantInfo } = useDash();
  const [store, setStore] = useState(() => tenantInfo?.store || {});
  // tenantInfo loads asynchronously after boot, so on a direct visit/refresh
  // it's still null at first render — pick up the saved logo/background once
  // it arrives instead of showing empty slots.
  useEffect(() => {
    if (tenantInfo?.store) setStore(tenantInfo.store);
  }, [tenantInfo]);

  return (
    <div className="p-6 space-y-6" data-testid="dash-branding">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: "var(--pos-text)" }}>
          <QrCode className="w-6 h-6" style={{ color: "var(--pos-accent)" }} />
          QR Ordering Branding
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--pos-muted)" }}>
          Your own logo and background photo on the table and pickup ordering pages customers see when they scan your QR code — just for this store.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <BrandingSlot
          title="Logo"
          hint="Shown top-left on both ordering pages. Square works best."
          field="logo"
          aspect="1 / 1"
          value={store.logo_url}
          onChange={setStore}
        />
        <BrandingSlot
          title="Background photo"
          hint="Fills the page behind your menu. A wide photo works best."
          field="background"
          aspect="16 / 9"
          value={store.background_image_url}
          onChange={setStore}
        />
      </div>

      <div className="text-xs rounded-lg px-4 py-3" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)", color: "var(--pos-muted)" }}>
        Changes apply immediately — no need to reprint your table QR codes.
      </div>
    </div>
  );
}
