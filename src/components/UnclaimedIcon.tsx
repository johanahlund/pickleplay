/**
 * Empty-circle glyph — "this player exists in the roster but hasn't
 * claimed an account yet". When `onClick` is provided the badge
 * becomes a button (tap → start the invite-to-claim flow); otherwise
 * it's a non-interactive span for indication only.
 *
 * Colour-codes by `lastInvitedAt`:
 *   - never invited     → gray ⭕      (default)
 *   - invited ≤ 7 days  → amber 🟠     (recently chased — back off)
 *   - invited > 7 days  → faded amber  (chased a while ago — fair game)
 *
 * Counts (invitesSent + last-sent date) surface via the tooltip so
 * admins can see history at a glance without a separate UI.
 */
type Props = {
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
  invitesSent?: number;
  lastInvitedAt?: string | Date | null;
};

function ageBucket(lastInvitedAt: string | Date | null | undefined): "never" | "recent" | "old" {
  if (!lastInvitedAt) return "never";
  const ts = typeof lastInvitedAt === "string" ? new Date(lastInvitedAt).getTime() : lastInvitedAt.getTime();
  if (!Number.isFinite(ts)) return "never";
  const ageDays = (Date.now() - ts) / 86_400_000;
  return ageDays <= 7 ? "recent" : "old";
}

function relativeDays(lastInvitedAt: string | Date): string {
  const ts = typeof lastInvitedAt === "string" ? new Date(lastInvitedAt).getTime() : lastInvitedAt.getTime();
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

function defaultTooltip(invitesSent: number, lastInvitedAt: string | Date | null | undefined, interactive: boolean): string {
  if (!invitesSent || !lastInvitedAt) {
    return interactive ? "Invite to claim account" : "Unclaimed — no account yet";
  }
  const noun = invitesSent === 1 ? "invite" : "invites";
  const head = `${invitesSent} ${noun} · last ${relativeDays(lastInvitedAt)}`;
  return interactive ? `${head} — tap to invite again` : head;
}

export function UnclaimedIcon({ onClick, title, disabled, invitesSent = 0, lastInvitedAt = null }: Props) {
  const bucket = ageBucket(lastInvitedAt);
  // Glyphs picked to render as colour-bearing emoji on every platform
  // so the icon "reads" at a glance without a separate filled SVG.
  //   never  → ⭕ (red-outline ring — neutral but visible)
  //   recent → 🟠 (orange disc — "we just chased them")
  //   old    → 🟡 (yellow disc — "chased a while ago, fair game")
  // Use opacity to soften the "old" bucket further.
  const glyph = bucket === "never" ? "⭕" : bucket === "recent" ? "🟠" : "🟡";
  const opacity = bucket === "old" ? 0.55 : 1;
  const t = title ?? defaultTooltip(invitesSent, lastInvitedAt, !!onClick);

  const sharedClass = "inline-flex items-center justify-center text-[10px] leading-none shrink-0";
  if (!onClick) {
    return (
      <span className={sharedClass} title={t} aria-label="Unclaimed" style={{ opacity }}>
        {glyph}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={disabled}
      className={`${sharedClass} hover:opacity-70 active:opacity-50 transition-opacity disabled:opacity-50`}
      title={t}
      aria-label={t}
      style={{ opacity }}
    >
      {glyph}
    </button>
  );
}
