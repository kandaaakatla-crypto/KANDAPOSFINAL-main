import { summaryRows } from "./receiptSummary";

const base = { items: [{ qty: 1, price: 412.4 }], subtotal: 412.4, total: 412 };

test("round-off row appears before TOTAL when set", () => {
  const rows = summaryRows({ ...base, roundOff: -0.4 });
  const labels = rows.map((r) => r.label);
  expect(labels.indexOf("Round off")).toBe(labels.indexOf("TOTAL") - 1);
  expect(rows.find((r) => r.label === "Round off").amount).toBe(-0.4);
});

test("no round-off row when zero or missing", () => {
  expect(summaryRows(base).some((r) => r.label === "Round off")).toBe(false);
  expect(summaryRows({ ...base, roundOff: 0 }).some((r) => r.label === "Round off")).toBe(false);
});
