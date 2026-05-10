/**
 * Display helpers for League names.
 *
 * `shortName` is an optional ≤15-char field used in headers, back links,
 * and pills. When unset we fall back to a truncated slice of the full
 * `name` so callers don't have to repeat the same fallback inline.
 */

export const LEAGUE_SHORT_NAME_MAX = 25;

export function leagueShortName(
  league: { shortName?: string | null; name: string } | null | undefined,
): string {
  if (!league) return "";
  const sn = (league.shortName ?? "").trim();
  if (sn) return sn;
  // Truncate the full name. Don't try to be clever about word boundaries —
  // the user can set shortName explicitly if they want a hand-crafted one.
  if (league.name.length <= LEAGUE_SHORT_NAME_MAX) return league.name;
  return `${league.name.slice(0, LEAGUE_SHORT_NAME_MAX).trimEnd()}…`;
}
