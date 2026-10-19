// Orders placed on this device carry a negative placeholder number until the
// server assigns the real one (see PosContext.newLocalOrderNumber). Showing
// "#-1" to staff or on a receipt looks like a bug, so every screen renders
// the number through this helper.
export function orderNo(order) {
  const n = order?.number;
  if (typeof n !== "number" || n <= 0) return "(syncing…)";
  return `#${n}`;
}
