// src/components/Logo.tsx
//
// FriendlyBall wordmark + swappable sport ball.
//
// The wordmark renders as "Friendly" + the ball — the ball glyph IS the
// "Ball" half of the name. The same mark reads as
// `FriendlyBall for pickleball`, `FriendlyBall for padel`,
// `FriendlyBall for tennis` just by swapping the ball.
//
// Default ball alignment is "midline" — the ball sits centered with the
// text x-height, which reads as motion rather than punctuation.
//
// Usage:
//   <Logo size={20} color="#15803d" />                 // header, light bg
//   <Logo size={20} color="#fff"    ball="pickle" />   // header, dark bg
//   <Logo size={34} ball="padel" />                    // future sport
//   <Logo size={20} wordmark="full" />                 // "FriendlyBall" + ball

import React from "react";

export type LogoBall =
  | "solid"
  | "pickle"
  | "tennis"
  | "padel"
  | "padel-blue";

export type LogoBallAlign = "baseline" | "midline" | "cap" | "float";

/** "full"  → "FriendlyBall" + ball glyph (default; name spelled out, ball = sport slot).
 *  "split" → "Friendly" + ball glyph (ball stands in for "Ball"). */
export type LogoWordmark = "split" | "full";

export interface LogoProps {
  size?: number;                // font-size in px; the ball scales with it
  color?: string;               // wordmark text color
  accentColor?: string;         // color for the "Ball" half when wordmark="full"
  weight?: number;              // 700–900, default 800
  ball?: LogoBall;              // which sport's ball
  ballColor?: string;           // only for `solid`
  ballAlign?: LogoBallAlign;    // default "midline"
  ballScale?: number;           // ball size as fraction of font size
  wordmark?: LogoWordmark;      // default "split"
  "aria-label"?: string;
}

export function Logo({
  size = 20,
  color = "#15803d",
  accentColor,
  weight = 800,
  ball = "pickle",
  ballColor = "#84cc16",
  ballAlign = "midline",
  ballScale,
  wordmark = "full",
  "aria-label": ariaLabel = "FriendlyBall",
}: LogoProps) {
  // When the ball substitutes for the word "Ball" it has to read as a
  // letterform, not punctuation — so scale it up by default. Even in the
  // "full" wordmark the ball is the brand mark, so keep it generous.
  const effectiveScale = ballScale ?? (wordmark === "split" ? 0.92 : 0.85);
  const ballSize = Math.round(size * effectiveScale);

  // Offset (px) to move the ball UP from the text baseline.
  const offsets: Record<LogoBallAlign, number> = {
    baseline: 0,
    midline: Math.round(size * 0.28 - ballSize / 2),
    cap:     Math.round(size * 0.62 - ballSize / 2),
    float:   Math.round(size * 0.82 - ballSize / 2),
  };
  const dy = offsets[ballAlign];

  return (
    <span
      role="img"
      aria-label={ariaLabel}
      style={{
        fontFamily:
          '-apple-system, "SF Pro Display", system-ui, sans-serif',
        fontWeight: weight,
        fontSize: size,
        letterSpacing: "-0.02em",
        color,
        display: "inline-flex",
        alignItems: "baseline",
        lineHeight: 1,
        gap: Math.max(2, Math.round(size * 0.04)),
      }}
    >
      {wordmark === "full" ? (
        <>
          <span>Friendly</span>
          <span style={accentColor ? { color: accentColor } : undefined}>Ball</span>
        </>
      ) : (
        <span>Friendly</span>
      )}
      <svg
        width={ballSize}
        height={ballSize}
        viewBox="0 0 20 20"
        style={{
          display: "inline-block",
          transform: `translateY(${-dy}px)`,
          flexShrink: 0,
        }}
        aria-hidden="true"
      >
        <BallGlyph kind={ball} solidColor={ballColor} />
      </svg>
    </span>
  );
}

function BallGlyph({
  kind,
  solidColor,
}: {
  kind: LogoBall;
  solidColor: string;
}) {
  if (kind === "solid") {
    return <circle cx="10" cy="10" r="9.5" fill={solidColor} />;
  }
  if (kind === "pickle") {
    return (
      <>
        <circle cx="10" cy="10" r="9.5" fill="#d9f99d" />
        {[[10,4],[5,7],[15,7],[7,11],[13,11],[10,15]].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="1.2" fill="#65a30d" opacity={0.65} />
        ))}
      </>
    );
  }
  if (kind === "tennis") {
    return (
      <>
        <circle cx="10" cy="10" r="9.5" fill="#d9f99d" />
        <path d="M1 10 Q6 4 10 4 Q14 4 19 10" fill="none" stroke="#fff" strokeWidth={1.2} />
        <path d="M1 10 Q6 16 10 16 Q14 16 19 10" fill="none" stroke="#fff" strokeWidth={1.2} />
      </>
    );
  }
  if (kind === "padel") {
    return (
      <>
        <circle cx="10" cy="10" r="9.5" fill="#fde047" />
        <path d="M2 8 Q10 5 18 8"  fill="none" stroke="#eab308" strokeWidth={1} opacity={0.6} />
        <path d="M2 12 Q10 15 18 12" fill="none" stroke="#eab308" strokeWidth={1} opacity={0.6} />
      </>
    );
  }
  if (kind === "padel-blue") {
    return (
      <>
        <circle cx="10" cy="10" r="9.5" fill="#38bdf8" />
        <path d="M2 8 Q10 5 18 8"  fill="none" stroke="#0284c7" strokeWidth={1} opacity={0.6} />
        <path d="M2 12 Q10 15 18 12" fill="none" stroke="#0284c7" strokeWidth={1} opacity={0.6} />
      </>
    );
  }
  return null;
}

/** Back-compat alias for callers that imported the old name. */
export type RallyBall = LogoBall;

export default Logo;
