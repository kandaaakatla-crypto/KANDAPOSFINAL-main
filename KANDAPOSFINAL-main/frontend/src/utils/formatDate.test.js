import { fmtDate, fmtDateTime } from "./formatDate";

test("formats in IST regardless of device zone", () => {
  // 05:24 UTC is 10:54 IST
  expect(fmtDateTime("2026-10-03T05:24:00Z")).toBe("3 Oct 2026, 10:54 am IST");
  expect(fmtDateTime("2026-10-03T18:30:00Z")).toBe("4 Oct 2026, 12:00 am IST");
});
test("date only", () => expect(fmtDate("2026-10-03T05:24:00Z")).toBe("3 Oct 2026"));
test("bad input is a dash", () => {
  expect(fmtDateTime(null)).toBe("—");
  expect(fmtDate("nope")).toBe("—");
});
