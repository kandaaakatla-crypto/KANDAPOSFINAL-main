import React from "react";
import { FOOD_TYPES } from "../../utils/foodType";

export default function FoodMark({ type, size = 14 }) {
  const meta = FOOD_TYPES[type];
  if (!meta) return null;
  return (
    <span role="img" aria-label={meta.label} title={meta.label} data-testid={`food-mark-${type}`}
      className="inline-flex items-center justify-center shrink-0"
      style={{ width: size, height: size, border: `1.5px solid ${meta.color}`, borderRadius: 3, background: "#fff" }}>
      <span style={{ width: size / 2, height: size / 2, borderRadius: "50%", background: meta.color }} />
    </span>
  );
}
