import { initialPaymentFor, isPaid, tenderLabel } from "./tenders";

test("UPI, card machine and other settle at once; online card waits for Razorpay", () => {
  expect(initialPaymentFor("upi")).toBe("upi");
  expect(initialPaymentFor("card_machine")).toBe("card_machine");
  expect(initialPaymentFor("other")).toBe("other");
  expect(initialPaymentFor("cash")).toBe("cash");
  expect(initialPaymentFor("card")).toBe("unpaid");
});

test("a cash + UPI split is paid immediately so the cash half is kept", () => {
  expect(initialPaymentFor("split", [{ method: "cash", amount: 50 }, { method: "upi", amount: 160 }])).toBe("split");
  expect(initialPaymentFor("split", [{ method: "cash", amount: 50 }, { method: "card", amount: 160 }])).toBe("unpaid");
});

test("any non-unpaid payment counts as paid", () => {
  expect(isPaid({ payment: "upi" })).toBe(true);
  expect(isPaid({ payment: "unpaid" })).toBe(false);
  expect(tenderLabel("card_machine")).toBe("Card");
});
