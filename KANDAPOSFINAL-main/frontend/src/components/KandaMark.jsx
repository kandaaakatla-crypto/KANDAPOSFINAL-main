import React from "react";

/**
 * The "K" brand mark: a vertical bar + inward chevron forming a K, with a
 * gold dot accent at the chevron's tip. Matches the standalone favicon.svg —
 * keep both in sync if the mark ever changes.
 */
export default function KandaMark({ size = 36, rounded = true, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      {rounded && <rect width="100" height="100" rx="22" fill="#0E6F58" />}
      <rect x="27" y="27" width="15" height="46" rx="7.5" fill="#FFFFFF" />
      <path d="M45 50 L73 26" stroke="#FFFFFF" strokeWidth="15" strokeLinecap="round" />
      <path d="M45 50 L73 74" stroke="#FFFFFF" strokeWidth="15" strokeLinecap="round" />
      <circle cx="76" cy="23" r="8" fill="#F2B33D" />
    </svg>
  );
}
