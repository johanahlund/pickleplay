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

// ── Match-day schedule share ──────────────────────────────────────
//
// "Share the schedule for this match day" — a single block of text the
// host typically pastes into a club WhatsApp group on the day. Grouped
// by court, sorted by start time within each court (TBD games at the
// end of each court list). Includes scores once a game has a winner.

export interface MatchDayShareGame {
  /** Court the game is on. `null` = not yet assigned. */
  courtNum: number | null;
  /** Scheduled start (Date or ISO string). `null` = TBD. */
  scheduledAt: Date | string | null;
  /** Display label for the category, e.g. "Men's Doubles". */
  categoryName: string;
  /** Pre-formatted player names ("Alice S.") for team 1 / team 2 — the
   *  caller knows the team roster, this builder stays format-only. */
  team1PlayerNames: string[];
  team2PlayerNames: string[];
  /** Final team scores (single-game). Pass when `winnerTeam` is set. */
  team1Score?: number | null;
  team2Score?: number | null;
  /** 1 or 2 if the game has a winner; null/undefined otherwise. */
  winnerTeam?: 1 | 2 | null;
  /** 1-based match number within the category (LeagueGame.slotNumber).
   *  Appears in the share as "Match 1" / "Match 2" so captains can
   *  distinguish two games of the same category. */
  slotNumber?: number | null;
}

export interface MatchDayShareContext {
  leagueName: string;
  /** "Round 3" or similar — optional. */
  roundLabel?: string | null;
  /** The two teams playing the match day. */
  team1Name?: string | null;
  team2Name?: string | null;
  /** Calendar date, already formatted ("Sat 23 May"). */
  dateText: string;
  /** Earliest start time across all games, pre-formatted ("10:00"). */
  doorsTimeText?: string | null;
  /** Venue line ("Setúbal Pickleball Club, Setúbal"). */
  locationText?: string | null;
  /** Public absolute URL to the event detail page. */
  eventUrl: string;
  games: MatchDayShareGame[];
}

function fmtTime(scheduledAt: Date | string | null): string {
  if (!scheduledAt) return "TBD";
  const d = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  if (Number.isNaN(d.getTime())) return "TBD";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Build the WhatsApp-ready match-day schedule message. */
export function buildMatchDayShare(ctx: MatchDayShareContext): string {
  // Group by court (null/TBD-court goes last).
  const byCourt = new Map<number | null, MatchDayShareGame[]>();
  for (const g of ctx.games) {
    const key = g.courtNum ?? null;
    const list = byCourt.get(key);
    if (list) list.push(g);
    else byCourt.set(key, [g]);
  }
  const courts = Array.from(byCourt.keys()).sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });

  // Within each court, sort by scheduledAt ascending; nulls last.
  for (const c of courts) {
    const list = byCourt.get(c)!;
    list.sort((a, b) => {
      const ta = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Number.POSITIVE_INFINITY;
      const tb = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Number.POSITIVE_INFINITY;
      return ta - tb;
    });
  }

  const heading: string[] = [];
  const roundSuffix = ctx.roundLabel ? ` — ${ctx.roundLabel}` : "";
  heading.push(`🏆 *${ctx.leagueName}${roundSuffix}*`);
  if (ctx.team1Name && ctx.team2Name) {
    heading.push(`${ctx.team1Name} vs ${ctx.team2Name}`);
  }
  heading.push(`📅 ${ctx.dateText}${ctx.doorsTimeText ? ` · Starts ${ctx.doorsTimeText}` : ""}`);
  if (ctx.locationText) heading.push(`📍 ${ctx.locationText}`);

  const lines: string[] = [...heading, "", "━━━━━━━━━━━━━━━━━━━"];

  for (const c of courts) {
    const list = byCourt.get(c)!;
    const courtLabel = c === null ? "Court TBD" : `Court ${c}`;
    // Extra blank line before each court header so the visual break
    // between courts is unmistakable in WhatsApp's tight line-spacing.
    lines.push("");
    lines.push("");
    lines.push(`*${courtLabel}*`);
    for (const g of list) {
      lines.push("");
      const matchSuffix = g.slotNumber != null ? ` · Match ${g.slotNumber}` : "";
      lines.push(`${fmtTime(g.scheduledAt)} · _${g.categoryName}_${matchSuffix}`);
      const t1 = g.team1PlayerNames.join(" + ") || "?";
      const t2 = g.team2PlayerNames.join(" + ") || "?";
      lines.push(`${t1}  vs  ${t2}`);
      if (g.winnerTeam && g.team1Score != null && g.team2Score != null) {
        const winnerNames = g.winnerTeam === 1 ? t1 : t2;
        const scoreText = g.winnerTeam === 1
          ? `${g.team1Score}-${g.team2Score}`
          : `${g.team2Score}-${g.team1Score}`;
        lines.push(`✅ ${winnerNames} — *${scoreText}*`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Higher-level helper: given the event payload from /api/events/[id]
 * (the same wire shape both the event page and the lineup page can
 * receive), build the WhatsApp-ready match-day schedule + a title for
 * the modal. Returns null for non-league events. Pages just fetch the
 * event and call this — no need to keep duplicated assembly logic in
 * each caller.
 */
type MatchDayEventPayload = {
  id: string;
  date: string | Date;
  locationId?: string | null;
  club?: { name: string; locations?: { id: string; name: string }[] | null } | null;
  leagueTeams?: { team: { id: string; name: string } }[] | null;
  /** Event sign-ups — used to resolve non-roster friendly-extra names. */
  players?: { player: { id: string; name: string } }[] | null;
  round?: {
    name: string | null;
    roundNumber: number;
    league: {
      name: string;
      categories?: { id: string; name: string }[] | null;
      teams?: { id: string; players: { playerId: string; player: { name: string } }[] }[] | null;
    };
  } | null;
  matches?: {
    leagueGame?: { id: string } | null;
    players: { team: number; score: number }[];
  }[] | null;
  leagueGames?: {
    id: string;
    categoryId: string;
    team1Id: string;
    team2Id: string;
    slotNumber?: number | null;
    scheduledAt?: string | null;
    courtNum?: number | null;
    winnerId?: string | null;
    gamePlayers: { playerId: string; team?: number | null; player?: { id: string; name: string } }[];
  }[] | null;
};

/** Format a full name as "First L." Strips parenthesised qualifiers
 *  ("Lloyd (Captain)" → "Lloyd L.") and skips tokens that don't start
 *  with a letter so a stray "(" can't become the initial. */
function shortName(full: string): string {
  const cleaned = full.replace(/\([^)]*\)/g, " ").trim();
  const parts = cleaned.split(/\s+/).filter((p) => /^\p{L}/u.test(p));
  if (parts.length === 0) return full;
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return `${parts[0]} ${last[0]}.`;
}

export function buildMatchDayShareFromEvent(
  evt: MatchDayEventPayload,
  origin: string,
): { message: string; title: string } | null {
  if (!evt.round) return null;
  const league = evt.round.league;
  const teams = league.teams || [];
  const categories = league.categories || [];

  // Resolve playerId → name with three sources:
  //   1. League team rosters (the canonical source)
  //   2. Event sign-ups (covers non-roster friendly extras)
  //   3. The gamePlayer's inline player record (last-resort fallback)
  const playerById = new Map<string, string>();
  for (const t of teams) {
    for (const tp of t.players) playerById.set(tp.playerId, tp.player.name);
  }
  for (const ep of evt.players || []) playerById.set(ep.player.id, ep.player.name);
  const resolveName = (gp: { playerId: string; player?: { name: string } }) =>
    shortName(playerById.get(gp.playerId) || gp.player?.name || "?");

  const categoryById = new Map(categories.map((c) => [c.id, c.name]));
  type MatchLite = { leagueGame?: { id: string } | null; players: { team: number; score: number }[] };
  const matchByGame = new Map<string, MatchLite>();
  for (const m of (evt.matches || []) as MatchLite[]) {
    if (m.leagueGame?.id) matchByGame.set(m.leagueGame.id, m);
  }

  // Per-team roster lookup so we can attribute legacy null-team
  // LeagueGamePlayer rows (written before the `team` field existed)
  // to the correct side based on roster membership.
  const rosterByTeamId = new Map<string, Set<string>>();
  for (const t of teams) {
    rosterByTeamId.set(t.id, new Set(t.players.map((tp) => tp.playerId)));
  }

  const games: MatchDayShareGame[] = (evt.leagueGames || []).map((g) => {
    const t1Roster = rosterByTeamId.get(g.team1Id) ?? new Set<string>();
    const t2Roster = rosterByTeamId.get(g.team2Id) ?? new Set<string>();
    const sideOf = (gp: { playerId: string; team?: number | null }): 1 | 2 => {
      if (gp.team === 1) return 1;
      if (gp.team === 2) return 2;
      if (t1Roster.has(gp.playerId)) return 1;
      if (t2Roster.has(gp.playerId)) return 2;
      // Orphan: non-roster + no team tag (legacy friendly extra).
      // Show on side 1 so they appear somewhere rather than vanish.
      return 1;
    };
    const t1Names = g.gamePlayers.filter((gp) => sideOf(gp) === 1).map(resolveName);
    const t2Names = g.gamePlayers.filter((gp) => sideOf(gp) === 2).map(resolveName);
    const match = matchByGame.get(g.id);
    const team1Score = match ? Math.max(0, ...match.players.filter((p) => p.team === 1).map((p) => p.score)) : null;
    const team2Score = match ? Math.max(0, ...match.players.filter((p) => p.team === 2).map((p) => p.score)) : null;
    let winnerTeam: 1 | 2 | null = null;
    if (g.winnerId) {
      winnerTeam = g.winnerId === g.team1Id ? 1 : g.winnerId === g.team2Id ? 2 : null;
    } else if (match && team1Score != null && team2Score != null && team1Score !== team2Score) {
      winnerTeam = team1Score > team2Score ? 1 : 2;
    }
    return {
      courtNum: g.courtNum ?? null,
      scheduledAt: g.scheduledAt ?? null,
      categoryName: categoryById.get(g.categoryId) || "—",
      slotNumber: g.slotNumber ?? null,
      team1PlayerNames: t1Names,
      team2PlayerNames: t2Names,
      team1Score,
      team2Score,
      winnerTeam,
    };
  });

  // Event start time = the time the organizer set in Event Data, not
  // the earliest court schedule. The first court can be later than
  // doors-open, and the organizer owns the canonical "show up at" time.
  const eventStart = evt.date ? new Date(evt.date) : null;
  const doorsTimeText = eventStart && !Number.isNaN(eventStart.getTime())
    ? eventStart.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  const dateText = new Date(evt.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  // Use the location actually selected for the event (via locationId).
  // Falls back to the club name when no specific location is set.
  const selectedLocation = evt.locationId
    ? evt.club?.locations?.find((l) => l.id === evt.locationId)
    : null;
  const locationText = selectedLocation?.name
    ? (evt.club?.name && selectedLocation.name !== evt.club.name
        ? `${evt.club.name} · ${selectedLocation.name}`
        : selectedLocation.name)
    : evt.club?.name ?? null;
  const team1Name = evt.leagueTeams?.[0]?.team.name ?? null;
  const team2Name = evt.leagueTeams?.[1]?.team.name ?? null;
  const roundLabel = evt.round.name || `Round ${evt.round.roundNumber}`;

  const message = buildMatchDayShare({
    leagueName: league.name,
    roundLabel,
    team1Name,
    team2Name,
    dateText,
    doorsTimeText,
    locationText,
    eventUrl: `${origin}/events/${evt.id}`,
    games,
  });
  return {
    message,
    title: `Share match-day · ${roundLabel}`,
  };
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
