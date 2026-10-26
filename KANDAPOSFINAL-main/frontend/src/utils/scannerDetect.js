// Barcode scanners used with the POS are keyboard-wedge devices: they "type"
// the code very fast and finish with Enter. Humans can't type 6+ characters
// at under ~40ms per key, so a fast burst ending in Enter is a scanner.
// Pure and timestamp-driven so it is testable without a DOM.
export const MAX_GAP_MS = 40;
export const MIN_LENGTH = 4;

export function createScannerDetector({ maxGap = MAX_GAP_MS, minLength = MIN_LENGTH } = {}) {
  let buf = "";
  let last = 0;
  return {
    /** Feed one keydown. Returns the scanned code when a scan completes, else null. */
    feed(key, now) {
      if (last && now - last > maxGap) buf = "";
      last = now;
      if (key === "Enter") {
        const code = buf;
        buf = "";
        return code.length >= minLength ? code : null;
      }
      if (key.length === 1) buf += key;
      return null;
    },
    reset() { buf = ""; last = 0; },
  };
}
