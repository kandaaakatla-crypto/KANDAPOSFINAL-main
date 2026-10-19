import { billTitleLines } from "./escpos";

test("composition and unregistered stores print a Bill of Supply", () => {
  expect(billTitleLines({ gst_scheme: "regular" })).toEqual(["TAX INVOICE"]);
  expect(billTitleLines({})).toEqual(["TAX INVOICE"]);
  expect(billTitleLines({ gst_scheme: "unregistered" })).toEqual(["BILL OF SUPPLY"]);
  expect(billTitleLines({ gst_scheme: "composition" })[0]).toBe("BILL OF SUPPLY");
  expect(billTitleLines({ gst_scheme: "composition" })[1]).toMatch(/Composition taxable person/);
});
