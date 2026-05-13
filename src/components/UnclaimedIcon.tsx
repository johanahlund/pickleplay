/**
 * Empty-circle glyph (⭕) — means "this player exists in the roster but
 * hasn't claimed an account yet". When `onClick` is provided the badge
 * becomes a button (tap → start the invite-to-claim flow); otherwise
 * it's a non-interactive span for indication only.
 */
type Props = {
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
};

export function UnclaimedIcon({ onClick, title, disabled }: Props) {
  const t = title ?? (onClick ? "Invite to claim account" : "Unclaimed — no account yet");
  if (!onClick) {
    return (
      <span
        className="inline-flex items-center justify-center text-[10px] leading-none shrink-0"
        title={t}
        aria-label="Unclaimed"
      >
        ⭕
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={disabled}
      className="inline-flex items-center justify-center text-[10px] leading-none shrink-0 hover:opacity-70 active:opacity-50 transition-opacity disabled:opacity-50"
      title={t}
      aria-label={t}
    >
      ⭕
    </button>
  );
}
