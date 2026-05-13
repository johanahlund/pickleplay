import { prisma } from "@/lib/db";
import { requireAuth, authErrorResponse } from "@/lib/auth";
import { recalcAllCourtsAndPersist } from "@/lib/leagueSchedule";
import { NextResponse } from "next/server";

/**
 * Manual "recalculate every court now" trigger. Useful when the operator
 * has just changed a league/round/category duration override and wants
 * the existing event to pick it up (no automatic event-wide cascade on
 * those upstream edits — operator-triggered keeps things predictable).
 *
 * Auth: host team captain/vice, league organizer (createdBy or deputy),
 * or app admin.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; eventId: string }> }
) {
  const { id: leagueId, eventId } = await params;
  let user;
  try { user = await requireAuth(); } catch (e) { return authErrorResponse(e); }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      hostTeamId: true,
      round: { select: { leagueId: true, league: { select: { createdById: true, deputyId: true } } } },
    },
  });
  if (!event || !event.round || event.round.leagueId !== leagueId) {
    return NextResponse.json({ error: "Event not found in this league" }, { status: 404 });
  }

  const isAppAdmin = user.role === "admin";
  const league = event.round.league;
  const isLeagueAdmin = league.createdById === user.id || league.deputyId === user.id;
  let isHostCaptain = false;
  if (event.hostTeamId) {
    const host = await prisma.leagueTeam.findUnique({
      where: { id: event.hostTeamId },
      select: { captainId: true, viceCaptainId: true },
    });
    isHostCaptain = !!host && (host.captainId === user.id || host.viceCaptainId === user.id);
  }
  if (!isAppAdmin && !isLeagueAdmin && !isHostCaptain) {
    return NextResponse.json({ error: "Not allowed to recalculate this event's schedule." }, { status: 403 });
  }

  const updated = await recalcAllCourtsAndPersist(eventId);
  return NextResponse.json({ ok: true, updated });
}
