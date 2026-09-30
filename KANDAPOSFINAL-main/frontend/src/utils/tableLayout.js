// Shared by the Table Plan and the layout editor so both draw every table
// in the same place and at the same size.

export const DEFAULT_TABLE_SIZE = 80;
const GAP = 30;
const PER_ROW = 6;

/** Fill in default geometry and spread out tables that have never been
 * positioned. The API reports an unplaced table at (0, 0), so a fresh floor
 * (or tables added before the editor existed) would otherwise all stack on
 * top of each other in the corner — impossible to tell apart or grab the
 * right one to drag. Tables sharing (0, 0) are laid out on a grid below any
 * already-placed tables; a single table at (0, 0) is left where it is. */
export function withDefaultLayout(tables) {
  const norm = tables.map((t) => ({
    ...t,
    x: t.x ?? 0,
    y: t.y ?? 0,
    width: t.width || DEFAULT_TABLE_SIZE,
    height: t.height || DEFAULT_TABLE_SIZE,
    shape: t.shape || "square",
    rotation: t.rotation || 0,
  }));
  const atOrigin = norm.filter((t) => t.x === 0 && t.y === 0);
  if (atOrigin.length < 2) return norm;
  const placed = norm.filter((t) => !(t.x === 0 && t.y === 0));
  const top = placed.length ? Math.max(...placed.map((t) => t.y + t.height)) + GAP : 20;
  const slot = DEFAULT_TABLE_SIZE + GAP;
  const pos = new Map(
    [...atOrigin]
      .sort((a, b) => a.number - b.number)
      .map((t, i) => [t.id, { x: 20 + (i % PER_ROW) * slot, y: top + Math.floor(i / PER_ROW) * slot }]),
  );
  return norm.map((t) => (pos.has(t.id) ? { ...t, ...pos.get(t.id) } : t));
}
