import React, { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { smsApi } from "../api/client";

/** Asks the server whether SMS is usable. `setUp` stays true until the server
 *  says otherwise, so a slow or failed status call never blocks sending. */
export function useSmsStatus() {
  const [status, setStatus] = useState({ configured: true, reason: "" });
  useEffect(() => {
    smsApi.status().then(setStatus).catch(() => {});
  }, []);
  return status;
}

export default function SmsNotSetUp({ reason }) {
  return (
    <div data-testid="sms-not-set-up" role="status" className="flex items-start gap-2 rounded-lg p-3 text-xs"
      style={{ background: "rgba(217,119,6,0.14)", border: "1px solid rgba(217,119,6,0.4)", color: "var(--pos-text)" }}>
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#d97706" }} />
      <div><b>Not set up.</b> {reason} Messages can&apos;t be delivered until it is, so sending is turned off.</div>
    </div>
  );
}
