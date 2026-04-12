import { prisma } from "@/lib/db";
import { requireLeagueManager, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

// POST: record game result (set winner)
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; matchDayId: string }> }
) {
  const { id, matchDayId } = await params;
  try { await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }

  const { gameId, winnerId } = await req.json();
  if (!gameId) return NextResponse.json({ error: "gameId required" }, { status: 400 });

  // Verify game belongs to this match day, which belongs to this league
  const game = await prisma.leagueGame.findUnique({
    where: { id: gameId },
    select: { matchDayId: true, matchDay: { select: { round: { select: { leagueId: true } } } } },
  });
  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });
  if (game.matchDayId !== matchDayId || game.matchDay.round.leagueId !== id) {
    return NextResponse.json({ error: "Game does not belong to this league" }, { status: 403 });
  }

  await prisma.leagueGame.update({
    where: { id: gameId },
    data: { winnerId: winnerId || null },
  });

  // Recalculate match day team points
  const games = await prisma.leagueGame.findMany({ where: { matchDayId } });
  const teamPoints: Record<string, number> = {};
  for (const g of games) {
    if (g.winnerId) {
      teamPoints[g.winnerId] = (teamPoints[g.winnerId] || 0) + 1;
    }
  }

  // Get league config for max points cap
  const matchDay = await prisma.leagueMatchDay.findUnique({
    where: { id: matchDayId },
    include: { round: { include: { league: { select: { config: true } } } } },
  });
  const config = (matchDay?.round.league.config as Record<string, number> | null) || {};
  const maxPoints = config.maxPointsPerMatchDay || 99;

  // Update team points
  const mdTeams = await prisma.leagueMatchDayTeam.findMany({ where: { matchDayId } });
  for (const mdt of mdTeams) {
    const raw = teamPoints[mdt.teamId] || 0;
    await prisma.leagueMatchDayTeam.update({
      where: { id: mdt.id },
      data: { points: Math.min(raw, maxPoints) },
    });
  }

  return NextResponse.json({ ok: true });
}
