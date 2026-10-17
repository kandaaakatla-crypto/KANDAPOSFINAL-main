import { Capacitor } from "@capacitor/core";

// Share today's / this week's sales (routes/report_share.py) as a PDF plus a
// short WhatsApp-ready message. In the phone app this opens the system share
// sheet (WhatsApp, mail, Drive…); on the web it uses the Web Share API where
// files are supported, otherwise opens WhatsApp with the text and downloads
// the PDF.

const inr = (n) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;
const PAY = { cash: "Cash", card: "Card", upi: "UPI", unpaid: "Unpaid" };

export function reportMessage(d) {
  const day = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const when = d.from === d.to ? day(d.to) : `${day(d.from)} to ${day(d.to)}`;
  const lines = [
    `*${d.storeName} · ${d.label}* (${when})`,
    `Sales ${inr(d.sales)} · ${d.orders} ${d.orders === 1 ? "order" : "orders"} · avg ${inr(d.avgOrder)}`,
  ];
  const pays = Object.entries(d.payments || {}).sort((a, b) => b[1] - a[1]);
  if (pays.length) lines.push(pays.map(([k, v]) => `${PAY[k] || k} ${inr(v)}`).join(" · "));
  if (d.topItems?.length) lines.push(`Top: ${d.topItems.slice(0, 3).map((i) => `${i.name} (${i.qty})`).join(", ")}`);
  return lines.join("\n");
}

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

const isCancel = (e) => e?.name === "AbortError" || /cancel/i.test(e?.message || "");

// Returns "shared" | "cancelled" | "fallback".
export async function shareReport(api, days) {
  const [{ data }, pdf] = await Promise.all([
    api.get("/reports/share", { params: { days } }),
    api.get("/reports/share.pdf", { params: { days }, responseType: "blob" }),
  ]);
  const text = reportMessage(data);
  const filename = days === 1 ? `sales-${data.to}.pdf` : `sales-${data.from}-to-${data.to}.pdf`;
  const title = `${data.storeName} · ${data.label}`;

  try {
    if (Capacitor.isNativePlatform()) {
      const [{ Filesystem, Directory }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")]);
      const { uri } = await Filesystem.writeFile({ path: filename, data: await toBase64(pdf.data), directory: Directory.Cache });
      await Share.share({ title, text, files: [uri], dialogTitle: "Share sales report" });
      return "shared";
    }
    const file = new File([pdf.data], filename, { type: "application/pdf" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title, text, files: [file] });
      return "shared";
    }
  } catch (e) {
    if (isCancel(e)) return "cancelled";
    throw e;
  }

  // Desktop browsers: WhatsApp gets the text, the PDF lands in Downloads.
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  const url = URL.createObjectURL(pdf.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return "fallback";
}
