import { prisma } from "@/lib/db";
import { requireAuth, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

// POST: confirm a pending unlock request. Caller must be:
//   - the OTHER team's captain/vice (so each team confirms the other), OR
//   - league director / deputy / app admin
// Effect: both lineups → draft, auto-generated games (without winner) deleted.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; eventId: string; teamId: string }> }
) {
  const { id, eventId, teamId } = await params;
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      round: { select: { leagueId: true } },
      leagueLineups: true,
      leagueTeams: { include: { team: { select: { id: true, captainId: true, viceCaptainId: true } } } },
    },
  });
  if (!event || event.round?.leagueId !== id) {
    return NextResponse.json({ error: "Event not found in league" }, { status: 404 });
  }

  const myLineup = event.leagueLineups.find((l) => l.teamId === teamId);
  if (!myLineup) return NextResponse.json({ error: "No lineup for that team" }, { status: 404 });
  if (!myLineup.unlockRequestedById) {
    return NextResponse.json({ error: "No pending unlock request" }, { status: 400 });
  }

  const league = await prisma.league.findUnique({ where: { id }, select: { createdById: true, deputyId: true } });
  const isAppAdmin = user.role === "admin";
  const isOrganizer = isAppAdmin || league?.createdById === user.id || league?.deputyId === user.id;
  // Caller is the OTHER team's leader?
  const otherTeam = event.leagueTeams.find((t) => t.team.id !== teamId)?.team;
  const isOtherLeader = !!otherTeam && (otherTeam.captainId === user.id || otherTeam.viceCaptainId === user.id);
  if (!isOrganizer && !isOtherLeader) {
    return NextResponse.json({ error: "Only the other team's captain or a league organizer can confirm" }, { status: 403 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.leagueGame.deleteMany({ where: { eventId, lineupGenerated: true, winnerId: null } });
    await tx.leagueLineup.updateMany({
      where: { eventId },
      data: { status: "draft", submittedAt: null, submittedById: null, unlockRequestedById: null },
    });
  });
  return NextResponse.json({ ok: true });
}
