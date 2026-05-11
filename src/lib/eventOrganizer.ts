/**
 * Derived event organizer. The "organizer" of an event is:
 *   - For STANDALONE events: the event creator (event.createdById).
 *   - For LEAGUE events: the captain of the host team — derived live,
 *     not stored. If the host team's captain changes, the organizer
 *     changes with it. If the event's host team changes, ditto.
 *
 * Used by:
 *   - Status-transition guard (only the organizer + admins can flip
 *     event.status, with extra restrictions for league events).
 *   - Visibility rule for Setup-state events.
 *
 * The shape required for a league event is narrow — just the host
 * teamId and the leagueTeams array with each team's id, captainId, and
 * viceCaptainId. Callers can either pass a Prisma row already shaped
 * that way or pull from the API response.
 */

export interface OrganizerEvent {
  createdById?: string | null;
  hostTeamId?: string | null;
  leagueTeams?: Array<{
    teamId: string;
    team?: { id?: string; captainId?: string | null; viceCaptainId?: string | null } | null;
  }>;
}

/**
 * The single canonical organizer id. Null if undeterminable (e.g.,
 * league event with no host team set).
 */
export function getEventOrganizerId(event: OrganizerEvent): string | null {
  // League event path: prefer host team's captain.
  if (event.hostTeamId && event.leagueTeams && event.leagueTeams.length > 0) {
    const host = event.leagueTeams.find((lt) => lt.teamId === event.hostTeamId);
    const captain = host?.team?.captainId ?? null;
    if (captain) return captain;
    // Fall back to vice captain only if no captain set — extremely rare.
    const vice = host?.team?.viceCaptainId ?? null;
    if (vice) return vice;
    // Host team is set but has no captain/vice. League admin still
    // controls the event; no team-side organizer to derive.
    return null;
  }
  // Standalone path: the creator is the organizer.
  return event.createdById ?? null;
}

/**
 * Quick "is this person allowed to act as the organizer for this
 * event?" check. Mirrors getEventOrganizerId() but also accepts the
 * vice-captain for league events (the captain may delegate, and the
 * vice already has admin powers on the team-roster surface).
 */
export function isEventOrganizer(event: OrganizerEvent, playerId: string): boolean {
  if (!playerId) return false;
  // Standalone: only the creator is the organizer.
  if (!event.hostTeamId || !event.leagueTeams || event.leagueTeams.length === 0) {
    return event.createdById === playerId;
  }
  // League: host captain or vice qualifies.
  const host = event.leagueTeams.find((lt) => lt.teamId === event.hostTeamId);
  if (!host) return false;
  return host.team?.captainId === playerId || host.team?.viceCaptainId === playerId;
}
