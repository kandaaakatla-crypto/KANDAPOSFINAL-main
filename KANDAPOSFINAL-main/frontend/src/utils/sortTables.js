// IndexedDB hands tables back in key order, so "T10" lands before "T2".
// Sort by the numeric table number (then name) instead.
export function sortTables(tables) {
  return [...(tables || [])].sort((a, b) => {
    const d = (Number(a.number) || 0) - (Number(b.number) || 0);
    return d !== 0 ? d : String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true });
  });
}
