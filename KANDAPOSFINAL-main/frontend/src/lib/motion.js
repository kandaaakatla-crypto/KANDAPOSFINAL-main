/** Shared framer-motion spring presets, so press/hover feedback feels the
 * same everywhere it's used instead of every call site picking its own
 * stiffness/damping by feel. */

export const TAP_SPRING = { type: "spring", stiffness: 500, damping: 24 };
export const HOVER_SPRING = { type: "spring", stiffness: 300, damping: 22 };

/** Drop-in whileTap/transition props for a pressable element (buttons, tiles). */
export const pressable = {
  whileTap: { scale: 0.96 },
  transition: TAP_SPRING,
};

/** A slightly stronger press for small tap targets (keypad keys, chips). */
export const pressableSmall = {
  whileTap: { scale: 0.9 },
  transition: TAP_SPRING,
};

/** Hover-lift for cards/tiles that should feel liftable, not just clickable. */
export const liftable = {
  whileHover: { y: -2 },
  whileTap: { scale: 0.98 },
  transition: HOVER_SPRING,
};
