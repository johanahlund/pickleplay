import { prisma } from "@/lib/db";
import { requireLeagueManager, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

// POST: create Grande Final event from league standings
// Generates a special playoff round with bracket seeding based on category rankings
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }

  const league = await prisma.league.findUnique({
    where: { id },
    include: {
      club: { select: { id: true, name: true } },
      teams: {
        include: {
          players: {
            include: { player: { select: { id: true, name: true, gender: true } } },
          },
        },
      },
      categories: { orderBy: { sortOrder: "asc" } },
      rounds: {
        include: {
          matchDays: {
            include: {
              teams: true,
              games: {
                include: { gamePlayers: { select: { playerId: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });

  const config = (league.config as Record<string, number> | null) || {};
  const minMatchDays = config.minMatchDaysForPlayoff ?? 2;

  // Compute category standings (principal games only) for seeding
  const categorySeeds: Record<string, { teamId: string; teamName: string; wins: number }[]> = {};
  for (const cat of league.categories) {
    const catWins: Record<string, number> = {};
    for (const team of league.teams) catWins[team.id] = 0;

    for (const round of league.rounds) {
      for (const md of round.matchDays) {
        for (const game of md.games) {
          if (game.categoryId !== cat.id || !game.winnerId) continue;
          if (game.isPrincipal === false) continue;
          catWins[game.winnerId] = (catWins[game.winnerId] || 0) + 1;
        }
      }
    }

    categorySeeds[cat.id] = league.teams
      .map((t) => ({ teamId: t.id, teamName: t.name, wins: catWins[t.id] || 0 }))
      .sort((a, b) => b.wins - a.wins);
  }

  // Compute player eligibility (distinct match days played)
  const playerMatchDays: Record<string, Set<string>> = {};
  for (const round of league.rounds) {
    for (const md of round.matchDays) {
      for (const game of md.games) {
        for (const gp of game.gamePlayers) {
          if (!playerMatchDays[gp.playerId]) playerMatchDays[gp.playerId] = new Set();
          playerMatchDays[gp.playerId].add(md.id);
        }
      }
    }
  }

  // Build eligible player lists per team
  const eligiblePlayers: Record<string, string[]> = {};
  for (const team of league.teams) {
    eligiblePlayers[team.id] = team.players
      .filter((tp) => (playerMatchDays[tp.playerId]?.size || 0) >= minMatchDays)
      .map((tp) => tp.playerId);
  }

  // Create the Grande Final round
  const maxRound = league.rounds.length > 0 ? Math.max(...league.rounds.map((r) => r.roundNumber)) : 0;
  const playoffRound = await prisma.leagueRound.create({
    data: {
      leagueId: id,
      roundNumber: maxRound + 1,
      name: "Grande Final",
      status: "scheduled",
    },
  });

  // Create the Grande Final event
  const event = await prisma.event.create({
    data: {
      name: `${league.name} — Grande Final`,
      date: new Date(),
      status: "setup",
      numCourts: 2,
      clubId: league.club?.id || null,
      createdById: league.createdById,
    },
  });

  // Create event classes for each league category
  for (const cat of league.categories) {
    await prisma.eventClass.create({
      data: {
        eventId: event.id,
        name: cat.name,
        format: cat.format,
        gender: cat.gender,
        ageGroup: cat.ageGroup,
        scoringFormat: cat.scoringFormat,
        winBy: cat.winBy,
        isDefault: false,
        competitionMode: "groups_elimination",
      },
    });
  }

  // Register eligible players from all teams
  for (const team of league.teams) {
    for (const playerId of (eligiblePlayers[team.id] || [])) {
      try {
        await prisma.eventPlayer.create({
          data: { eventId: event.id, playerId, status: "registered" },
        });
      } catch {
        // Player might already be registered (e.g. on multiple teams — shouldn't happen but safe)
      }
    }
  }

  // Create a match day linking the round to the event
  await prisma.leagueMatchDay.create({
    data: {
      roundId: playoffRound.id,
      eventId: event.id,
      date: new Date(),
      status: "scheduled",
    },
  });

  return NextResponse.json({
    ok: true,
    eventId: event.id,
    roundId: playoffRound.id,
    categorySeeds,
    eligiblePlayers,
  });
}
