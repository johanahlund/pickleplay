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

export const frameClass =
  "bg-card rounded-xl border border-border overflow-hidden";

export const rowClass =
  "flex items-center justify-between gap-2 px-3 py-3";

export function Card({
  className = "",
  ...rest
}: ComponentPropsWithoutRef<"div">) {
  return <div className={`${frameClass} ${className}`} {...rest} />;
}

export function CardRow({
  className = "",
  ...rest
}: ComponentPropsWithoutRef<"div">) {
  return <div className={`${rowClass} ${className}`} {...rest} />;
}
