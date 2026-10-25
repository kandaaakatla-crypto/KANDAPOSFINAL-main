import { useEffect, useRef } from "react";
import { createScannerDetector } from "../utils/scannerDetect";

/** Listens (passively) for keyboard-wedge scanner bursts anywhere in the app and
 *  calls onScan(code). It never swallows keys, so existing screens keep working. */
export default function useScannerWatch(onScan) {
  const cb = useRef(onScan);
  cb.current = onScan;
  useEffect(() => {
    const det = createScannerDetector();
    const onKey = (e) => {
      const code = det.feed(e.key, e.timeStamp || Date.now());
      if (code) cb.current && cb.current(code);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}
