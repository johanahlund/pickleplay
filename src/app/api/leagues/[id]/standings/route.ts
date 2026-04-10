import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export interface TeamStanding {
  teamId: string;
  teamName: string;
  logoUrl: string | null;
  played: number;
  won: number;
  lost: number;
  drawn: number;
  points: number; // capped per match day
  totalCategoryWins: number; // tiebreaker
  categoryWins: Record<string, number>; // per category
}

// GET: compute league standings
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const league = await prisma.league.findUnique({
    where: { id },
    include: {
      teams: { select: { id: true, name: true, logoUrl: true } },
      categories: { orderBy: { sortOrder: "asc" } },
      rounds: {
        include: {
          matchDays: {
            include: {
              teams: true,
              games: true,
            },
          },
        },
      },
    },
  });
  if (!league) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const config = (league.config as Record<string, number> | null) || {};
  const maxPointsPerMD = config.maxPointsPerMatchDay || 99;

  // General standings
  const standings: Record<string, TeamStanding> = {};
  for (const team of league.teams) {
    standings[team.id] = {
      teamId: team.id,
      teamName: team.name,
      logoUrl: team.logoUrl,
      played: 0,
      won: 0,
      lost: 0,
      drawn: 0,
      points: 0,
      totalCategoryWins: 0,
      categoryWins: Object.fromEntries(league.categories.map((c) => [c.id, 0])),
    };
  }

  for (const round of league.rounds) {
    for (const md of round.matchDays) {
      // Calculate per-team category wins for this match day
      const mdWins: Record<string, number> = {};
      for (const game of md.games) {
        if (game.winnerId) {
          mdWins[game.winnerId] = (mdWins[game.winnerId] || 0) + 1;
          if (standings[game.winnerId]) {
            standings[game.winnerId].totalCategoryWins++;
            standings[game.winnerId].categoryWins[game.categoryId] =
              (standings[game.winnerId].categoryWins[game.categoryId] || 0) + 1;
          }
        }
      }

      // Only count completed match days (at least one game with a winner)
      const hasResults = md.games.some((g) => g.winnerId);
      if (!hasResults) continue;

      // Determine match day points (capped) and W/L/D for each team
      const teamIds = md.teams.map((t) => t.teamId);
      for (const teamId of teamIds) {
        if (!standings[teamId]) continue;
        standings[teamId].played++;
        const pts = Math.min(mdWins[teamId] || 0, maxPointsPerMD);
        standings[teamId].points += pts;
      }

      // W/L/D only for 2-team match days
      if (teamIds.length === 2) {
        const [a, b] = teamIds;
        const aWins = mdWins[a] || 0;
        const bWins = mdWins[b] || 0;
        if (aWins > bWins) {
          if (standings[a]) standings[a].won++;
          if (standings[b]) standings[b].lost++;
        } else if (bWins > aWins) {
          if (standings[b]) standings[b].won++;
          if (standings[a]) standings[a].lost++;
        } else {
          if (standings[a]) standings[a].drawn++;
          if (standings[b]) standings[b].drawn++;
        }
      }
    }
  }

  // Sort: points desc, then totalCategoryWins desc
  const general = Object.values(standings).sort((a, b) =>
    b.points - a.points || b.totalCategoryWins - a.totalCategoryWins
  );

  // Category standings
  const categoryStandings: Record<string, { teamId: string; teamName: string; wins: number; losses: number; gamesPlayed: number }[]> = {};
  for (const cat of league.categories) {
    const catTeams: Record<string, { wins: number; losses: number; played: number }> = {};
    for (const team of league.teams) {
      catTeams[team.id] = { wins: 0, losses: 0, played: 0 };
    }

    for (const round of league.rounds) {
      for (const md of round.matchDays) {
        for (const game of md.games) {
          if (game.categoryId !== cat.id || !game.winnerId) continue;
          catTeams[game.winnerId].wins++;
          catTeams[game.winnerId].played++;
          const loserId = game.team1Id === game.winnerId ? game.team2Id : game.team1Id;
          catTeams[loserId].losses++;
          catTeams[loserId].played++;
        }
      }
    }

    categoryStandings[cat.id] = league.teams.map((t) => ({
      teamId: t.id,
      teamName: t.name,
      wins: catTeams[t.id].wins,
      losses: catTeams[t.id].losses,
      gamesPlayed: catTeams[t.id].played,
    })).sort((a, b) => b.wins - a.wins || a.losses - b.losses);
  }

  return NextResponse.json({ general, categoryStandings, categories: league.categories });
}
