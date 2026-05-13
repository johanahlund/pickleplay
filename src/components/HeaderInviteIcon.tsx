"use client";

/**
 * HeaderInviteIcon — the standalone "share invite" button used in the
 * top-right of every entity page header. Same 3-circle share glyph as
 * the AppHeader's built-in `onInvite` slot, with an optional single-
 * letter type badge ("E" event, "C" club, "L" league, "T" team, …) so
 * the user can tell what the share will share at a glance.
 *
 * Drop it directly into any custom header (leagues, clubs) so the
 * affordance stays in the same screen position across every page,
 * regardless of which header component a page uses.
 */

export interface HeaderInviteIconProps {
  onClick: () => void;
  /** Single-letter type badge ("E", "C", "L", "T", "M", …). */
  kind?: string;
  /** Aria-label / tooltip text. Defaults to "Share invite". */
  label?: string;
  /** Stroke color for the icon. Defaults to white (hero headers). */
  color?: string;
  /** Badge text color — usually the header bg, so the letter sits on
   *  a contrast-tinted chip. Defaults to "#14532d" (brand dark green). */
  badgeFg?: string;
}

export function HeaderInviteIcon({
  onClick,
  kind,
  label,
  color = "#fff",
  badgeFg = "#14532d",
}: HeaderInviteIconProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label || "Share invite"}
      title={label || "Share invite"}
      style={{
        position: "relative",
        background: "transparent",
        border: 0,
        padding: 0,
        cursor: "pointer",
        lineHeight: 0,
      }}
    >
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="6" cy="12" r="2.4" stroke={color} strokeWidth={1.8} />
        <circle cx="17" cy="6" r="2.4" stroke={color} strokeWidth={1.8} />
        <circle cx="17" cy="18" r="2.4" stroke={color} strokeWidth={1.8} />
        <path d="M8 11l7-4M8 13l7 4" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      </svg>
      {kind && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            bottom: -4,
            right: -6,
            minWidth: 14,
            height: 14,
            padding: "0 3px",
            background: color,
            color: badgeFg,
            borderRadius: 3,
            fontSize: 9,
            fontWeight: 800,
            lineHeight: "14px",
            textAlign: "center",
            letterSpacing: "0.02em",
          }}
        >{kind}</span>
      )}
    </button>
  );
}

export default HeaderInviteIcon;
