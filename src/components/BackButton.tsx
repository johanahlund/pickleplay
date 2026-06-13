"use client";

import Link from "next/link";

/**
 * BackButton — the ONE canonical "up" affordance for the whole app.
 *
 * Hierarchical, NOT history-based: callers pass the parent screen's `href`, so
 * the destination AND the label are deterministic no matter how the user
 * arrived (list, notification, deep link, current-event FAB). We never call
 * `router.back()` — it's non-deterministic and breaks on deep-links / the
 * first page in a session.
 *
 * Native swipe-back (iOS Safari, Android gesture, and a one-flag enable in the
 * App Store / Play Store WebView wrappers) is a free OS bonus layered on top —
 * this component never depends on it and never breaks it.
 *
 * Single source of the chevron + label markup: AppHeader's hero/light variants
 * render this too, passing `color` to theme it white/green on the gradient.
 * Standalone pages use the default action colour.
 *
 * `onClick` (with no `href`) is supported for the rare intra-page "up" that
 * switches a view rather than navigating — but prefer `href` everywhere real
 * navigation is meant.
 */
export function BackButton({
  href,
  label,
  subtitle,
  color,
  onClick,
  className = "",
}: {
  href?: string;
  label: string;
  subtitle?: string;
  color?: string;
  onClick?: () => void;
  className?: string;
}) {
  const inner = (
    <>
      <svg width={10} height={16} viewBox="0 0 10 16" style={{ marginTop: 1, flexShrink: 0 }}>
        <path
          d="M8 2 L2 8 L8 14"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {subtitle ? (
        <span className="flex flex-col text-left leading-tight">
          <span>{label}</span>
          <span className="text-xs font-normal opacity-85">{subtitle}</span>
        </span>
      ) : (
        <span>{label}</span>
      )}
    </>
  );

  const cls =
    `inline-flex ${subtitle ? "items-start" : "items-center"} gap-1 text-[15px] font-medium ` +
    `text-action bg-transparent border-0 p-0 cursor-pointer text-left no-underline ${className}`;
  // Inline `color` (used by AppHeader's hero/light variants) overrides the
  // default `text-action`; the chevron follows via `currentColor`.
  const style = color ? { color } : undefined;

  if (onClick || !href) {
    return (
      <button type="button" onClick={onClick} className={cls} style={style}>
        {inner}
      </button>
    );
  }
  return (
    <Link href={href} className={cls} style={style}>
      {inner}
    </Link>
  );
}

export default BackButton;
