import React, { useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { receiptsApi } from "../../api/client";

/** Send the customer their bill on WhatsApp (from Kanda's number), and
 *  optionally ask for a Google review. Lives under the receipt actions. */
export default function WhatsAppBillForm({ orderId, defaultPhone = "", canAskReview = false }) {
  const [phone, setPhone] = useState(defaultPhone);
  const [review, setReview] = useState(false);
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!phone.trim()) { toast.error("Enter the customer's WhatsApp number"); return; }
    setSending(true);
    try {
      const res = await receiptsApi.whatsapp(orderId, phone.trim(), canAskReview && review);
      toast.success(res?.sent?.includes("review") ? "Bill and review request sent on WhatsApp" : "Bill sent on WhatsApp");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't send on WhatsApp");
    } finally { setSending(false); }
  };

  return (
    <div className="col-span-2 rounded-lg p-2.5 space-y-2" style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
      <div className="flex gap-2">
        <input data-testid="wa-bill-phone" type="tel" inputMode="tel" placeholder="Customer's WhatsApp number" value={phone}
          onChange={(e) => setPhone(e.target.value)} maxLength={20}
          className="flex-1 min-w-0 h-10 px-3 rounded-md text-sm"
          style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)", color: "var(--pos-text)" }} />
        <button data-testid="wa-bill-send" onClick={send} disabled={sending}
          className="pos-btn h-10 px-3 rounded-md flex items-center gap-1.5 text-xs font-bold text-white disabled:opacity-50"
          style={{ background: "#16a34a" }}>
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageCircle className="w-3.5 h-3.5" />} WhatsApp bill
        </button>
      </div>
      {canAskReview && (
        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--pos-muted)" }}>
          <input data-testid="wa-bill-review" type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} />
          Also ask for a Google review
        </label>
      )}
    </div>
  );
}
