import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET: compute player eligibility for playoffs
// A player must have participated in at least N match days (default 2)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const { id } = await params;

  const league = await prisma.league.findUnique({
    where: { id },
    select: {
      config: true,
      teams: {
        include: {
          players: {
            include: { player: { select: { id: true, name: true, gender: true, photoUrl: true } } },
          },
        },
      },
      rounds: {
        include: {
          events: {
            select: {
              id: true,
              leagueGames: {
                include: {
                  gamePlayers: { select: { playerId: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!league) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const config = (league.config as Record<string, number> | null) || {};
  const minMatchDays = config.minMatchDaysForPlayoff ?? 2;

  // Count distinct match-day events each player participated in
  const playerMatchDays: Record<string, Set<string>> = {};
  for (const round of league.rounds) {
    for (const ev of round.events) {
      for (const game of ev.leagueGames) {
        for (const gp of game.gamePlayers) {
          if (!playerMatchDays[gp.playerId]) playerMatchDays[gp.playerId] = new Set();
          playerMatchDays[gp.playerId].add(ev.id);
        }
      }
    }
  }

  // Build eligibility per team
  const result = league.teams.map((team) => ({
    teamId: team.id,
    teamName: team.name,
    players: team.players.map((tp) => {
      const matchDayCount = playerMatchDays[tp.playerId]?.size || 0;
      return {
        playerId: tp.playerId,
        name: tp.player.name,
        gender: tp.player.gender,
        photoUrl: tp.player.photoUrl,
        matchDaysPlayed: matchDayCount,
        eligible: matchDayCount >= minMatchDays,
      };
    }),
  }));

  return NextResponse.json({ minMatchDays, teams: result });
}
