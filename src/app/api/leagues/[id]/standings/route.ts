import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
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
  totalCategoryWins: number; // tiebreaker 2
  categoryWins: Record<string, number>; // per category
  h2h: Record<string, number>; // teamId -> match day wins against them
  pointDifference: number; // total points scored - conceded
}

// GET: compute league standings (login required)
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
    include: {
      teams: { select: { id: true, name: true, logoUrl: true } },
      categories: { orderBy: { sortOrder: "asc" } },
      rounds: {
        include: {
          matchDays: {
            include: {
              teams: true,
              games: {
                include: {
                  match: {
                    include: {
                      players: { select: { team: true, score: true } },
                    },
                  },
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
      h2h: {},
      pointDifference: 0,
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

        // Point difference from linked match
        if (game.match?.players) {
          const t1Score = game.match.players.filter((p) => p.team === 1).reduce((s, p) => Math.max(s, p.score), 0);
          const t2Score = game.match.players.filter((p) => p.team === 2).reduce((s, p) => Math.max(s, p.score), 0);
          // team1Id in LeagueGame corresponds to team 1 in the match
          if (standings[game.team1Id]) standings[game.team1Id].pointDifference += (t1Score - t2Score);
          if (standings[game.team2Id]) standings[game.team2Id].pointDifference += (t2Score - t1Score);
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

      // W/L/D and H2H only for 2-team match days
      if (teamIds.length === 2) {
        const [a, b] = teamIds;
        const aWins = mdWins[a] || 0;
        const bWins = mdWins[b] || 0;
        if (aWins > bWins) {
          if (standings[a]) { standings[a].won++; standings[a].h2h[b] = (standings[a].h2h[b] || 0) + 1; }
          if (standings[b]) standings[b].lost++;
        } else if (bWins > aWins) {
          if (standings[b]) { standings[b].won++; standings[b].h2h[a] = (standings[b].h2h[a] || 0) + 1; }
          if (standings[a]) standings[a].lost++;
        } else {
          if (standings[a]) standings[a].drawn++;
          if (standings[b]) standings[b].drawn++;
        }
      }
    }
  }

  // Sort with full tiebreaker cascade:
  // 1. Points (capped) desc
  // 2. H2H record (pairwise for 2 tied teams)
  // 3. Total category wins desc
  // 4. Point difference desc
  const general = Object.values(standings).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    // H2H: direct confrontation wins
    const aH2H = a.h2h[b.teamId] || 0;
    const bH2H = b.h2h[a.teamId] || 0;
    if (aH2H !== bH2H) return bH2H - aH2H;
    if (b.totalCategoryWins !== a.totalCategoryWins) return b.totalCategoryWins - a.totalCategoryWins;
    return b.pointDifference - a.pointDifference;
  });

  // Category standings — only principal games count for per-category rankings
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
          // Only principal games count for category rankings
          if (game.isPrincipal === false) continue;
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
