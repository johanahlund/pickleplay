/**
 * Pill/badge label for a club. Uses `shortName` when set, otherwise the
 * first 10 characters of the full name. Keeps UI consistent across
 * events list pills, league team pills, and any other club badge.
 */
export function clubLabel(club: { shortName?: string | null; name: string } | null | undefined): string {
  if (!club) return "";
  if (club.shortName && club.shortName.trim()) return club.shortName.trim();
  return club.name.slice(0, 10);
}
