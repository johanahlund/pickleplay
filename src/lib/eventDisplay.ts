/**
 * Display helpers for Event names. The stored `event.name` for a
 * league match-day is the verbose
 * "{league.name}: {teamA} vs {teamB} — Round N" string built at
 * creation time — too long for hero headers, back chevrons, and
 * tabs. For standalone events the stored name is whatever the
 * organizer typed.
 *
 * `eventShortName()` returns a compact identity for the event:
 *   - LEAGUE event with teams: "TeamA vs TeamB — Round N"
 *     (drops the redundant league prefix; the league is already
 *      named elsewhere in the same chrome).
 *   - LEAGUE event without teams yet: "Round N"
 *   - STANDALONE: stored name, truncated past EVENT_SHORT_NAME_MAX.
 */

export const EVENT_SHORT_NAME_MAX = 40;

export interface ShortNameEvent {
  name?: string | null;
  round?: {
    name?: string | null;
    roundNumber?: number | null;
  } | null;
  leagueTeams?: Array<{ team?: { name?: string | null } | null }>;
}

export function eventShortName(event: ShortNameEvent | null | undefined): string {
  if (!event) return "";
  if (event.round) {
    const teamNames = (event.leagueTeams ?? [])
      .map((lt) => lt.team?.name)
      .filter(Boolean)
      .join(" vs ");
    const roundLabel = event.round.name?.trim()
      || (event.round.roundNumber ? `Round ${event.round.roundNumber}` : "Round");
    return teamNames ? `${teamNames} — ${roundLabel}` : roundLabel;
  }
  const raw = (event.name ?? "").trim();
  if (!raw) return "";
  return raw.length <= EVENT_SHORT_NAME_MAX
    ? raw
    : `${raw.slice(0, EVENT_SHORT_NAME_MAX).trimEnd()}…`;
}
