/**
 * Shared invite-share helpers. Used by club invites, player invites,
 * the global "invite a friend to the app" button, and the per-context
 * Share sheets (event sign-up invite, lineup broadcast, etc).
 *
 * Outbound message strategy:
 *  - GROUP messages — one block of text copied once and pasted into
 *    existing WhatsApp / Telegram groups. Drives the existing-user
 *    cohort + cold prospects (people not yet in the app).
 *  - PERSONAL messages — one block per unclaimed player with their
 *    personal /claim/<token> link, designed to be sent 1:1 to drive
 *    account creation.
 *
 * Every outbound invite ends with a short "Add to Home Screen" tip so
 * recipients install the app as a PWA after signing in.
 */

/** Plain-text "Add to Home Screen" instructions appended to invites.
 *  Leads with the iOS Safari nudge — WhatsApp's in-app browser doesn't
 *  let you add to home screen, so the recipient has to switch to
 *  Safari first. */
export const ADD_TO_HOME_SCREEN_TIP = [
  "📱 iPhone: tap the ↗ Safari icon at the bottom of WhatsApp's browser to switch to Safari.",
  "",
  "Tip: After signing in, add the app to your home screen for one-tap access.",
  "• iPhone: in Safari → tap Share → Add to Home Screen.",
  "• Android: in Chrome → tap the menu (⋮) → Add to Home Screen (or Install app).",
].join("\n");

/**
 * Wrap an invite message with the share boundary and the install tip.
 * Keep the boundary short so it pastes cleanly into WhatsApp etc.
 */
export function withInstallTip(message: string): string {
  return `${message}\n\n${ADD_TO_HOME_SCREEN_TIP}`;
}

/**
 * Build the app-level "invite a friend" message. No club/team context —
 * just a general invite to sign up.
 */
export function buildAppInviteMessage(opts: { inviterName: string; signupUrl: string }): string {
  const { inviterName, signupUrl } = opts;
  return withInstallTip(
    `${inviterName} invites you to join FriendlyBall — the app for organising pickleball play.\n\nSign up here: ${signupUrl}`,
  );
}

// ── URL helpers ────────────────────────────────────────────────────

/** Lowercase, ASCII-only, hyphen-separated name slug for personal URLs.
 *  Strips accents + non-word chars. Decorative — server ignores it.
 *  Uses explicit Unicode escapes for combining marks so the regex stays
 *  robust regardless of source-file encoding/normalisation. */
export function nameSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Personal claim URL with a decorative name slug in the path query so
 *  the WA link preview reads e.g. ".../claim/abc123?for=alice-silva"
 *  instead of an opaque token. Server-side /claim/[token] ignores `for`.
 */
export function personalClaimUrl(origin: string, token: string, name: string): string {
  const slug = nameSlug(name);
  return slug
    ? `${origin}/claim/${token}?for=${slug}`
    : `${origin}/claim/${token}`;
}

// ── Event invite (sign-up) ─────────────────────────────────────────

export interface EventInviteContext {
  inviterName: string;
  eventName: string;            // e.g. "Setúbal vs Oeiras — Round 1"
  whenText: string;             // e.g. "Sat 23 May · 10:00"
  locationText?: string | null; // e.g. "Setúbal Pickleball Club"
  organizerText?: string | null;
  /** Public absolute URL to the event detail page. */
  eventUrl: string;
  /** Optional: short league-context line for league events, e.g. "I Liga · Round 1". */
  contextLine?: string | null;
}

/** GROUP message — paste into a WhatsApp group. Covers existing users
 *  (link opens app) AND cold prospects (link redirects to signup). */
export function buildEventInviteGroup(ctx: EventInviteContext): string {
  const lines: string[] = [];
  lines.push(`${ctx.inviterName} invites you to this Pickleball event:`);
  lines.push("");
  if (ctx.contextLine) lines.push(ctx.contextLine);
  lines.push(`🏓 ${ctx.eventName}`);
  lines.push(`📅 ${ctx.whenText}`);
  if (ctx.locationText) lines.push(`📍 ${ctx.locationText}`);
  if (ctx.organizerText) lines.push(`👤 ${ctx.organizerText}`);
  lines.push("");
  lines.push(`Sign up to the FriendlyBall app here: ${ctx.eventUrl}`);
  return withInstallTip(lines.join("\n"));
}

/** PERSONAL message — sent 1:1 to an unclaimed player with their
 *  personal claim link. Pre-fills their name + lands them on the event
 *  sign-up after they create their password. */
export function buildEventInvitePersonal(
  ctx: EventInviteContext,
  recipient: { name: string; claimUrl: string },
): string {
  const lines: string[] = [];
  lines.push(`Hi ${recipient.name.split(" ")[0]},`);
  lines.push("");
  lines.push(`${ctx.inviterName} invites you to this Pickleball event:`);
  lines.push("");
  if (ctx.contextLine) lines.push(ctx.contextLine);
  lines.push(`🏓 ${ctx.eventName}`);
  lines.push(`📅 ${ctx.whenText}`);
  if (ctx.locationText) lines.push(`📍 ${ctx.locationText}`);
  lines.push("");
  lines.push(`Sign up to the FriendlyBall app here: ${recipient.claimUrl}`);
  return withInstallTip(lines.join("\n"));
}
