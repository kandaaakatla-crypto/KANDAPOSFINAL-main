import { createScannerDetector } from "./scannerDetect";

function type(det, text, start, gap) {
  let t = start;
  let out = null;
  for (const ch of text) { det.feed(ch, t); t += gap; }
  out = det.feed("Enter", t);
  return out;
}

test("a fast burst ending in Enter is a scan", () => {
  expect(type(createScannerDetector(), "8901234567890", 1000, 8)).toBe("8901234567890");
});

test("human-speed typing is not a scan", () => {
  expect(type(createScannerDetector(), "8901234567890", 1000, 150)).toBeNull();
});

test("short bursts are ignored", () => {
  expect(type(createScannerDetector(), "12", 1000, 5)).toBeNull();
});

test("a slow keystroke starts a fresh buffer", () => {
  const det = createScannerDetector();
  det.feed("a", 0); det.feed("b", 10);
  // long pause, then a real scan
  expect(type(det, "55501234", 5000, 6)).toBe("55501234");
});
