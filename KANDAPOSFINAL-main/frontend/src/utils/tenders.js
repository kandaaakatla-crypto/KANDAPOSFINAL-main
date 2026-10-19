// How a bill was paid. "card" is an online Razorpay card charge; the others
// are recorded by the cashier against the restaurant's own UPI QR or card machine.
export const TENDER_LABELS = {
  cash: "Cash", upi: "UPI", card_machine: "Card", card: "Card (online)", other: "Other", split: "Split", unpaid: "Unpaid",
};

export const tenderLabel = (method) => TENDER_LABELS[method] || method;

export const isPaid = (order) => !!order && (order.payment || "unpaid") !== "unpaid";

// Online card needs Razorpay keys and an explicit switch; off by default.
export const ONLINE_CARD_ENABLED = process.env.REACT_APP_POS_ONLINE_CARD === "1";

// Payment to create the order with: online card (alone or in a split) stays
// unpaid until Razorpay verifies it; everything else is settled immediately.
export function initialPaymentFor(method, splits) {
  if (method === "card") return "unpaid";
  if (method === "split") return (splits || []).some((s) => s.method === "card") ? "unpaid" : "split";
  return method;
}
