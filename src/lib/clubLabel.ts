/**
 * Pill/badge label for a club. Uses `shortName` when set, otherwise the
 * first 20 characters of the full name. Keeps UI consistent across
 * events list pills, league team pills, and any other club badge.
 */
export function clubLabel(club: { shortName?: string | null; name: string } | null | undefined): string {
  if (!club) return "";
  if (club.shortName && club.shortName.trim()) return club.shortName.trim();
  return club.name.slice(0, 20);
}

/**
 * Display label for a club member's role. The DB stores "owner" / "admin" /
 * "member" — we keep those values for backwards compatibility but render
 * "owner" as "Director" in the UI, which matches how clubs talk about
 * themselves in pickleball culture (a club director, not an "owner").
 */
export function clubRoleLabel(role: string | null | undefined): string {
  if (role === "owner") return "Director";
  if (role === "admin") return "Admin";
  if (role === "member") return "Member";
  return role || "";
}
