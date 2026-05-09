import { prisma } from "@/lib/db";
import { requireAuth, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

async function loadAuth(leagueId: string, teamId: string) {
  const user = await requireAuth();
  if (user.role === "admin") return { user, isOrganizer: true, isTeamLeader: true };
  const [league, team] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { createdById: true, deputyId: true } }),
    prisma.leagueTeam.findUnique({ where: { id: teamId }, select: { captainId: true, viceCaptainId: true, leagueId: true } }),
  ]);
  if (!league || !team || team.leagueId !== leagueId) throw new Error("NotFound");
  const isOrganizer = league.createdById === user.id || league.deputyId === user.id;
  const isTeamLeader = team.captainId === user.id || team.viceCaptainId === user.id;
  if (!isOrganizer && !isTeamLeader) throw new Error("Forbidden");
  return { user, isOrganizer, isTeamLeader };
}

// POST: request unlock. Behavior:
//   - if only this team is submitted (other still draft): unlock immediately
//   - if both submitted/revealed: record a pending request unless caller is
//     an organizer/admin (force-unlock both)
//   - blocked entirely if any lineup-generated game already has a winner
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; eventId: string; teamId: string }> }
) {
  const { id, eventId, teamId } = await params;
  let auth;
  try { auth = await loadAuth(id, teamId); } catch (e) { return authErrorResponse(e); }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      round: { select: { leagueId: true } },
      leagueLineups: true,
      leagueGames: { select: { lineupGenerated: true, winnerId: true } },
    },
  });
  if (!event || event.round?.leagueId !== id) {
    return NextResponse.json({ error: "Event not found in league" }, { status: 404 });
  }
  if (event.leagueGames.some((g) => g.lineupGenerated && g.winnerId)) {
    return NextResponse.json({ error: "Cannot unlock — event already in progress (a game has a recorded winner)" }, { status: 400 });
  }

  const myLineup = event.leagueLineups.find((l) => l.teamId === teamId);
  if (!myLineup || myLineup.status === "draft") {
    return NextResponse.json({ error: "Nothing to unlock" }, { status: 400 });
  }
  const otherLineup = event.leagueLineups.find((l) => l.teamId !== teamId);
  const otherSubmittedOrRevealed = !!otherLineup && (otherLineup.status === "submitted" || otherLineup.status === "revealed");

  // Force-unlock if organizer/admin OR if opponent hasn't submitted
  if (auth.isOrganizer || !otherSubmittedOrRevealed) {
    await prisma.$transaction(async (tx) => {
      await tx.leagueGame.deleteMany({ where: { eventId, lineupGenerated: true, winnerId: null } });
      await tx.leagueLineup.updateMany({
        where: { eventId },
        data: { status: "draft", submittedAt: null, submittedById: null, unlockRequestedById: null },
      });
    });
    return NextResponse.json({ ok: true, unlocked: "immediate" });
  }

  // Otherwise: record a pending unlock request, requires opponent's confirm
  await prisma.leagueLineup.update({
    where: { id: myLineup.id },
    data: { unlockRequestedById: auth.user.id },
  });
  return NextResponse.json({ ok: true, unlocked: "pending" });
}

// DELETE: cancel a pending unlock request (caller is requester or organizer)
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; eventId: string; teamId: string }> }
) {
  const { id, eventId, teamId } = await params;
  let auth;
  try { auth = await loadAuth(id, teamId); } catch (e) { return authErrorResponse(e); }
  await prisma.leagueLineup.updateMany({
    where: { eventId, teamId, unlockRequestedById: auth.isOrganizer ? undefined : auth.user.id },
    data: { unlockRequestedById: null },
  });
  return NextResponse.json({ ok: true });
}
