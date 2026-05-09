import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET: list both lineups for the match-day. Slot details are visible only
// to that team's roster manager (captain/vice/director/admin) OR if the
// lineup has been revealed.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; matchDayId: string }> }
) {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const { id, matchDayId } = await params;

  const matchDay = await prisma.leagueMatchDay.findUnique({
    where: { id: matchDayId },
    include: {
      round: { select: { leagueId: true } },
      teams: {
        include: {
          team: { select: { id: true, name: true, captainId: true, viceCaptainId: true } },
        },
      },
      lineups: {
        include: {
          slots: {
            include: {
              player1: { select: { id: true, name: true, photoUrl: true, gender: true } },
              player2: { select: { id: true, name: true, photoUrl: true, gender: true } },
            },
            orderBy: [{ categoryId: "asc" }, { slotNumber: "asc" }],
          },
          submittedBy: { select: { id: true, name: true } },
          unlockRequestedBy: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!matchDay || matchDay.round.leagueId !== id) {
    return NextResponse.json({ error: "Match-day not found in league" }, { status: 404 });
  }

  const league = await prisma.league.findUnique({
    where: { id },
    select: { createdById: true, deputyId: true, config: true },
  });
  const isAppAdmin = user.role === "admin";
  const isOrganizer = isAppAdmin || league?.createdById === user.id || league?.deputyId === user.id;

  type Slot = (typeof matchDay.lineups)[number]["slots"][number];
  const stripSlots = (lineup: typeof matchDay.lineups[number]) => {
    const team = matchDay.teams.find((t) => t.team.id === lineup.teamId)?.team;
    const isTeamLeader = !!team && (team.captainId === user.id || team.viceCaptainId === user.id);
    const canSeeSlots = isOrganizer || isTeamLeader || lineup.status === "revealed";
    return {
      id: lineup.id,
      teamId: lineup.teamId,
      status: lineup.status,
      submittedAt: lineup.submittedAt,
      submittedBy: lineup.submittedBy,
      unlockRequestedBy: lineup.unlockRequestedBy,
      slotCount: lineup.slots.length,
      slots: canSeeSlots
        ? lineup.slots.map((s: Slot) => ({
            id: s.id,
            categoryId: s.categoryId,
            slotNumber: s.slotNumber,
            player1: s.player1,
            player2: s.player2,
          }))
        : null,
    };
  };

  return NextResponse.json({
    matchDayId,
    teams: matchDay.teams.map((t) => ({ id: t.team.id, name: t.team.name })),
    lineups: matchDay.lineups.map(stripSlots),
    config: league?.config || {},
  });
}
