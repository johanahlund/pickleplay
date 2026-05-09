import React from "react";

/** Small inline icon next to a club name. Renders the club logo if
 *  available, otherwise a neutral building glyph. Replaces the previous
 *  emoji approach. Default size is ~16px square. */
export function ClubBadge({
  logoUrl,
  size = 16,
  className,
}: {
  logoUrl?: string | null;
  size?: number;
  className?: string;
}) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        className={`rounded object-cover inline-block align-middle ${className ?? ""}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`inline-flex items-center justify-center rounded bg-gray-100 text-muted align-middle ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <svg width={Math.round(size * 0.7)} height={Math.round(size * 0.7)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21h18" />
        <path d="M5 21V8l7-4 7 4v13" />
        <path d="M9 21v-6h6v6" />
      </svg>
    </span>
  );
}
