import { prisma } from "@/lib/db";

/**
 * Caller is allowed to invite (= generate a claim-token for, or mark
 * as-sent for) a target player if any of:
 *   - app admin
 *   - the player IS the caller (self-invite, rare)
 *   - club owner/admin of any club the player is a member of
 *   - league organizer / deputy / helper of any league the player is
 *     rostered on (LeagueTeamPlayer)
 *   - captain / vice of any league team the player is on
 *
 * Shared between the token-mint route and the mark-as-sent route so
 * the gate stays in lockstep.
 */
export async function canInvite(callerId: string, callerRole: string, playerId: string): Promise<boolean> {
  if (callerRole === "admin") return true;
  if (callerId === playerId) return true;

  const clubMembers = await prisma.clubMember.findMany({
    where: { playerId },
    select: { clubId: true },
  });
  if (clubMembers.length > 0) {
    const clubIds = clubMembers.map((m) => m.clubId);
    const isClubManager = await prisma.clubMember.findFirst({
      where: { playerId: callerId, clubId: { in: clubIds }, role: { in: ["owner", "admin"] } },
      select: { id: true },
    });
    if (isClubManager) return true;
  }

  const teamRows = await prisma.leagueTeamPlayer.findMany({
    where: { playerId },
    select: {
      team: { select: { id: true, captainId: true, viceCaptainId: true, leagueId: true } },
    },
  });
  for (const r of teamRows) {
    if (r.team.captainId === callerId || r.team.viceCaptainId === callerId) return true;
  }
  if (teamRows.length > 0) {
    const leagueIds = Array.from(new Set(teamRows.map((r) => r.team.leagueId)));
    const orgLeague = await prisma.league.findFirst({
      where: {
        id: { in: leagueIds },
        OR: [
          { createdById: callerId },
          { deputyId: callerId },
          { helpers: { some: { playerId: callerId } } },
        ],
      },
      select: { id: true },
    });
    if (orgLeague) return true;
  }

  return false;
}
