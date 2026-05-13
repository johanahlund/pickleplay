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

/** Plain-text install guide appended to invites. Two clearly-labelled
 *  platform sections with the full step-by-step (open the link, switch
 *  to a real browser, sign up / sign in, add to home screen). The `verb`
 *  swap lets personal-claim invites say "sign up" (recipient definitely
 *  doesn't have an account yet) while open group/event invites stay on
 *  "sign in or sign up" to cover both new and existing users. */
function buildAddToHomeScreenTip(verb: "sign in or sign up" | "sign up"): string {
  return [
    "━━━━━━━━━━━━━━━━━━━━━",
    "📱 iPhone — one-time setup (Safari only needed THIS first time):",
    "1. Tap the link above. WhatsApp opens it in its built-in browser.",
    "2. Tap the ↗ Safari icon at the bottom-right to switch to Safari. (Only needed for this first-time setup.)",
    `3. In Safari, ${verb}.`,
    "4. Tap the Share button (square with up-arrow) at the bottom of Safari.",
    "5. Scroll down and tap 'Add to Home Screen'.",
    "6. Tap 'Add'. Done! From now on just open FriendlyBall from your home screen — no more Safari or WhatsApp browser needed.",
    "",
    "🤖 Android — one-time setup:",
    "1. Tap the link above. If WhatsApp's built-in browser opens it, tap the menu (⋮) → 'Open in Chrome' (or copy the link into Chrome). Chrome is only needed for this first-time setup.",
    `2. In Chrome, ${verb}.`,
    "3. Tap the menu (⋮) at the top-right.",
    "4. Tap 'Add to Home Screen' (or 'Install app' if you see that option).",
    "5. Confirm. Done! From now on just open FriendlyBall from your home screen — no more Chrome or WhatsApp browser needed.",
  ].join("\n");
}

/** Default tip — for group/event messages that go to a mixed audience. */
export const ADD_TO_HOME_SCREEN_TIP = buildAddToHomeScreenTip("sign in or sign up");
/** Claim-flow tip — recipient is a known unclaimed player, so the only
 *  action they ever take is "sign up". */
export const ADD_TO_HOME_SCREEN_TIP_CLAIM = buildAddToHomeScreenTip("sign up");

/**
 * Wrap an invite message with the share boundary and the install tip.
 * Use `forClaim: true` for personal /claim/<token> invites — the
 * "sign up" wording is correct in that flow (recipient has no account
 * yet). The default covers open group/event invites where some
 * recipients might already have accounts.
 */
export function withInstallTip(message: string, opts?: { forClaim?: boolean }): string {
  const tip = opts?.forClaim ? ADD_TO_HOME_SCREEN_TIP_CLAIM : ADD_TO_HOME_SCREEN_TIP;
  return `${message}\n\n${tip}`;
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
    .replace(/[̀-ͯ]/g, "") // combining diacritics
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
  lines.push(ctx.eventName);
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
  const firstName = recipient.name.split(" ")[0];
  const lines: string[] = [];
  lines.push(`Hi ${firstName},`);
  lines.push("");
  lines.push(`${ctx.inviterName} invited you to FriendlyBall — the friendly pickleball app — for this event. You've already been added as a player, so we just need you to set up your account:`);
  lines.push("");
  if (ctx.contextLine) lines.push(ctx.contextLine);
  lines.push(ctx.eventName);
  lines.push(`📅 ${ctx.whenText}`);
  if (ctx.locationText) lines.push(`📍 ${ctx.locationText}`);
  lines.push("");
  lines.push(`Set up your account here: ${recipient.claimUrl}`);
  return withInstallTip(lines.join("\n"), { forClaim: true });
}

// ── League invite ─────────────────────────────────────────────────

export interface LeagueInviteContext {
  inviterName: string;
  leagueName: string;          // e.g. "I Liga Interclubes Pickleball Zona Centro"
  seasonText?: string | null;  // e.g. "2026"
  leagueUrl: string;
  /** Optional: short blurb shown under the heading (number of teams, scope, etc). */
  blurb?: string | null;
}

/** GROUP message — paste into a club's WhatsApp group to recruit
 *  players + teams to the league. */
export function buildLeagueInviteGroup(ctx: LeagueInviteContext): string {
  const lines: string[] = [];
  lines.push(`${ctx.inviterName} invites you to this Pickleball league:`);
  lines.push("");
  lines.push(ctx.leagueName);
  if (ctx.seasonText) lines.push(`📅 ${ctx.seasonText}`);
  if (ctx.blurb) lines.push(ctx.blurb);
  lines.push("");
  lines.push(`Sign up to the FriendlyBall app here: ${ctx.leagueUrl}`);
  return withInstallTip(lines.join("\n"));
}

/** PERSONAL message — sent 1:1 to an unclaimed player with their
 *  personal claim link, inviting them into a league. */
export function buildLeagueInvitePersonal(
  ctx: LeagueInviteContext,
  recipient: { name: string; claimUrl: string },
): string {
  const firstName = recipient.name.split(" ")[0];
  const lines: string[] = [];
  lines.push(`Hi ${firstName},`);
  lines.push("");
  lines.push(`${ctx.inviterName} invited you to FriendlyBall — the friendly pickleball app — for this league:`);
  lines.push("");
  lines.push(ctx.leagueName);
  if (ctx.seasonText) lines.push(`📅 ${ctx.seasonText}`);
  if (ctx.blurb) lines.push(ctx.blurb);
  lines.push("");
  lines.push(`Set up your account here: ${recipient.claimUrl}`);
  return withInstallTip(lines.join("\n"), { forClaim: true });
}

// ── Club invite ───────────────────────────────────────────────────

export interface ClubInviteContext {
  inviterName: string;
  clubName: string;            // e.g. "Setúbal Pickleball Club"
  cityText?: string | null;    // e.g. "Setúbal, Portugal"
  /** Public absolute URL to the club's join page. For known invite
   *  tokens use the existing `/clubs/join/<token>`; for direct club
   *  page use `/clubs/<id>`. */
  joinUrl: string;
  blurb?: string | null;
}

/** GROUP message — paste into any chat to recruit players to a club. */
export function buildClubInviteGroup(ctx: ClubInviteContext): string {
  const lines: string[] = [];
  lines.push(`${ctx.inviterName} invites you to this Pickleball club:`);
  lines.push("");
  lines.push(ctx.clubName);
  if (ctx.cityText) lines.push(`📍 ${ctx.cityText}`);
  if (ctx.blurb) lines.push(ctx.blurb);
  lines.push("");
  lines.push(`Sign up to the FriendlyBall app here: ${ctx.joinUrl}`);
  return withInstallTip(lines.join("\n"));
}

/** PERSONAL message — sent 1:1 with a per-player claim link. */
export function buildClubInvitePersonal(
  ctx: ClubInviteContext,
  recipient: { name: string; claimUrl: string },
): string {
  const firstName = recipient.name.split(" ")[0];
  const lines: string[] = [];
  lines.push(`Hi ${firstName},`);
  lines.push("");
  lines.push(`${ctx.inviterName} invited you to FriendlyBall — the friendly pickleball app — to join this club:`);
  lines.push("");
  lines.push(ctx.clubName);
  if (ctx.cityText) lines.push(`📍 ${ctx.cityText}`);
  if (ctx.blurb) lines.push(ctx.blurb);
  lines.push("");
  lines.push(`Set up your account here: ${recipient.claimUrl}`);
  return withInstallTip(lines.join("\n"), { forClaim: true });
}
