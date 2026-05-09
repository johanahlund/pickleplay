import { prisma } from "@/lib/db";
import { requireLeagueManager, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

// POST: record game result (set winner) or create extra game
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; eventId: string }> }
) {
  const { id, eventId } = await params;
  try { await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }

  const body = await req.json();

  // --- Create extra (non-principal) game ---
  if (body.action === "create_extra") {
    const { categoryId, team1Id, team2Id, matchId } = body;
    if (!categoryId || !team1Id || !team2Id) {
      return NextResponse.json({ error: "categoryId, team1Id, team2Id required" }, { status: 400 });
    }
    const game = await prisma.leagueGame.create({
      data: { eventId, categoryId, team1Id, team2Id, isPrincipal: false, ...(matchId ? { matchId } : {}) },
    });
    return NextResponse.json(game);
  }

  // --- Set winner for existing game ---
  const { gameId, winnerId } = body;
  if (!gameId) return NextResponse.json({ error: "gameId required" }, { status: 400 });

  // Verify game belongs to this event, which belongs to this league
  const game = await prisma.leagueGame.findUnique({
    where: { id: gameId },
    select: {
      eventId: true,
      matchId: true,
      event: { select: { round: { select: { leagueId: true } } } },
    },
  });
  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });
  if (game.eventId !== eventId || game.event.round?.leagueId !== id) {
    return NextResponse.json({ error: "Game does not belong to this league" }, { status: 403 });
  }

  await prisma.leagueGame.update({
    where: { id: gameId },
    data: { winnerId: winnerId || null },
  });

  // Auto-populate LeagueGamePlayer from the linked Match's players
  if (game.matchId && winnerId) {
    const matchPlayers = await prisma.matchPlayer.findMany({
      where: { matchId: game.matchId },
      select: { playerId: true },
    });
    for (const mp of matchPlayers) {
      await prisma.leagueGamePlayer.upsert({
        where: { leagueGameId_playerId: { leagueGameId: gameId, playerId: mp.playerId } },
        create: { leagueGameId: gameId, playerId: mp.playerId },
        update: {},
      });
    }
  }

  // Recalculate event team points
  const games = await prisma.leagueGame.findMany({ where: { eventId } });
  const teamPoints: Record<string, number> = {};
  for (const g of games) {
    if (g.winnerId) {
      teamPoints[g.winnerId] = (teamPoints[g.winnerId] || 0) + 1;
    }
  }

  // Get league config for max points cap
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { round: { include: { league: { select: { config: true } } } } },
  });
  const config = (event?.round?.league.config as Record<string, number> | null) || {};
  const maxPoints = config.maxPointsPerMatchDay || 99;

  // Update team points
  const eventTeams = await prisma.leagueEventTeam.findMany({ where: { eventId } });
  for (const et of eventTeams) {
    const raw = teamPoints[et.teamId] || 0;
    await prisma.leagueEventTeam.update({
      where: { id: et.id },
      data: { points: Math.min(raw, maxPoints) },
    });
  }

  return NextResponse.json({ ok: true });
}
