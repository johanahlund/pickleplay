/**
 * Card — the canonical "panel of content" frame. White surface, soft
 * border, rounded corners. Replaces hand-rolled
 * `bg-card rounded-xl border border-border` (~30 instances across pages).
 *
 * CardRow — a horizontally-padded inner row used for the
 * "label / value / chevron" pattern (event data, edit triggers).
 *
 * The class strings are exported as `frameClass` / `rowClass` for
 * places that need to spread them onto a non-component element.
 */

import type { ComponentPropsWithoutRef } from "react";

// Matches the existing convention used across ~30 hand-rolled cards.
// `overflow-hidden` is opt-in — pass `<Card overflowHidden>` if you need
// it, or add `overflow-hidden` to className.
export const frameClass = "bg-card rounded-xl border border-border";

export const rowClass = "flex items-center justify-between gap-2 px-3 py-3";

export function Card({
  className = "",
  overflowHidden = false,
  ...rest
}: ComponentPropsWithoutRef<"div"> & { overflowHidden?: boolean }) {
  const cls = `${frameClass}${overflowHidden ? " overflow-hidden" : ""} ${className}`.trim();
  return <div className={cls} {...rest} />;
}

export function CardRow({
  className = "",
  ...rest
}: ComponentPropsWithoutRef<"div">) {
  return <div className={`${rowClass} ${className}`} {...rest} />;
}
