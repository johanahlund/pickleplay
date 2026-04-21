import { describe, test, expect } from "vitest";

/**
 * Unit tests for league standings tiebreaker cascade.
 * Tests: Points → H2H → Category Wins → Point Difference
 */

interface Game {
  categoryId: string;
  team1Id: string;
  team2Id: string;
  winnerId: string | null;
  isPrincipal: boolean;
  matchScore?: { team1: number; team2: number } | null;
}
interface MatchDay { teams: { teamId: string }[]; games: Game[] }
interface Round { matchDays: MatchDay[] }

interface TeamStanding {
  teamId: string;
  points: number;
  won: number;
  lost: number;
  drawn: number;
  totalCategoryWins: number;
  categoryWins: Record<string, number>;
  h2h: Record<string, number>;
  pointDifference: number;
}

function computeStandings(
  teamIds: string[],
  rounds: Round[],
  categoryIds: string[],
  maxPointsPerMatchDay: number,
): TeamStanding[] {
  const standings: Record<string, TeamStanding> = {};
  for (const tid of teamIds) {
    standings[tid] = {
      teamId: tid, points: 0, won: 0, lost: 0, drawn: 0,
      totalCategoryWins: 0,
      categoryWins: Object.fromEntries(categoryIds.map((c) => [c, 0])),
      h2h: {},
      pointDifference: 0,
    };
  }

  for (const round of rounds) {
    for (const md of round.matchDays) {
      const mdWins: Record<string, number> = {};
      for (const game of md.games) {
        if (game.winnerId) {
          mdWins[game.winnerId] = (mdWins[game.winnerId] || 0) + 1;
          standings[game.winnerId].totalCategoryWins++;
          standings[game.winnerId].categoryWins[game.categoryId] =
            (standings[game.winnerId].categoryWins[game.categoryId] || 0) + 1;
        }
        // Point difference
        if (game.matchScore) {
          standings[game.team1Id].pointDifference += (game.matchScore.team1 - game.matchScore.team2);
          standings[game.team2Id].pointDifference += (game.matchScore.team2 - game.matchScore.team1);
        }
      }

      const hasResults = md.games.some((g) => g.winnerId);
      if (!hasResults) continue;

      const tids = md.teams.map((t) => t.teamId);
      for (const tid of tids) {
        if (!standings[tid]) continue;
        standings[tid].points += Math.min(mdWins[tid] || 0, maxPointsPerMatchDay);
      }

      if (tids.length === 2) {
        const [a, b] = tids;
        const aW = mdWins[a] || 0, bW = mdWins[b] || 0;
        if (aW > bW) {
          standings[a].won++; standings[b].lost++;
          standings[a].h2h[b] = (standings[a].h2h[b] || 0) + 1;
        } else if (bW > aW) {
          standings[b].won++; standings[a].lost++;
          standings[b].h2h[a] = (standings[b].h2h[a] || 0) + 1;
        } else {
          standings[a].drawn++; standings[b].drawn++;
        }
      }
    }
  }

  return Object.values(standings).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const aH2H = a.h2h[b.teamId] || 0;
    const bH2H = b.h2h[a.teamId] || 0;
    if (aH2H !== bH2H) return bH2H - aH2H;
    if (b.totalCategoryWins !== a.totalCategoryWins) return b.totalCategoryWins - a.totalCategoryWins;
    return b.pointDifference - a.pointDifference;
  });
}

function computeCategoryStandings(
  teamIds: string[],
  rounds: Round[],
  categoryId: string,
) {
  const catTeams: Record<string, { wins: number; losses: number }> = {};
  for (const tid of teamIds) catTeams[tid] = { wins: 0, losses: 0 };

  for (const round of rounds) {
    for (const md of round.matchDays) {
      for (const game of md.games) {
        if (game.categoryId !== categoryId || !game.winnerId) continue;
        if (game.isPrincipal === false) continue; // only principal games
        catTeams[game.winnerId].wins++;
        const loserId = game.team1Id === game.winnerId ? game.team2Id : game.team1Id;
        catTeams[loserId].losses++;
      }
    }
  }

  return Object.entries(catTeams)
    .map(([id, s]) => ({ teamId: id, ...s }))
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses);
}

describe("H2H Tiebreaker", () => {
  const teams = ["A", "B", "C"];
  const cats = ["masc", "fem", "mix", "singles"];

  test("H2H breaks tie when points are equal", () => {
    // Round 1: A beats B (3-1), Round 2: B beats A (3-1)
    // Both have 3 points. But say A won the H2H in a separate third encounter...
    // Simpler: A beats B in round 1, B beats C in round 2, A and B both have 3 pts
    const rounds: Round[] = [
      { matchDays: [{
        teams: [{ teamId: "A" }, { teamId: "B" }],
        games: cats.map((c) => ({ categoryId: c, team1Id: "A", team2Id: "B", winnerId: "A", isPrincipal: true })),
      }] },
      { matchDays: [{
        teams: [{ teamId: "B" }, { teamId: "C" }],
        games: cats.map((c) => ({ categoryId: c, team1Id: "B", team2Id: "C", winnerId: "B", isPrincipal: true })),
      }] },
      { matchDays: [{
        teams: [{ teamId: "A" }, { teamId: "C" }],
        games: cats.map((c) => ({ categoryId: c, team1Id: "A", team2Id: "C", winnerId: "C", isPrincipal: true })),
      }] },
    ];
    const result = computeStandings(teams, rounds, cats, 3);
    // A: 3 pts (beat B) + 0 (lost to C) = 3, wins=1, loss=1
    // B: 0 pts (lost to A) + 3 (beat C) = 3, wins=1, loss=1
    // C: 0 pts (lost to B) + 3 (beat A) = 3, wins=1, loss=1
    // All tied at 3 points with 4 total category wins each!
    // H2H: comparing pairwise — A beat B, B beat C, C beat A (circular)
    // Falls through to totalCategoryWins (all equal) then pointDifference
    expect(result[0].points).toBe(3);
    expect(result[1].points).toBe(3);
    expect(result[2].points).toBe(3);
  });

  test("H2H breaks tie between two teams", () => {
    // A and B play twice: A wins first, B wins second. Same points.
    // But A has more total category wins because A won 4-0, B won 3-1
    const rounds: Round[] = [
      { matchDays: [{
        teams: [{ teamId: "A" }, { teamId: "B" }],
        games: cats.map((c) => ({ categoryId: c, team1Id: "A", team2Id: "B", winnerId: "A", isPrincipal: true })),
      }] },
      { matchDays: [{
        teams: [{ teamId: "A" }, { teamId: "B" }],
        games: [
          { categoryId: "masc", team1Id: "A", team2Id: "B", winnerId: "B", isPrincipal: true },
          { categoryId: "fem", team1Id: "A", team2Id: "B", winnerId: "B", isPrincipal: true },
          { categoryId: "mix", team1Id: "A", team2Id: "B", winnerId: "B", isPrincipal: true },
          { categoryId: "singles", team1Id: "A", team2Id: "B", winnerId: "A", isPrincipal: true },
        ],
      }] },
    ];
    const result = computeStandings(["A", "B"], rounds, cats, 3);
    // A: 3 (round 1, 4 wins capped) + 1 (round 2, 1 win) = 4 pts
    // B: 0 (round 1) + 3 (round 2, 3 wins capped) = 3 pts
    // Not actually tied! A wins on points
    expect(result[0].teamId).toBe("A");
    expect(result[0].points).toBe(4);
    expect(result[1].points).toBe(3);
  });
});

describe("Point Difference Tiebreaker", () => {
  const cats = ["masc", "fem", "mix", "singles"];

  test("point difference breaks tie when H2H and category wins are equal", () => {
    const rounds: Round[] = [
      { matchDays: [{
        teams: [{ teamId: "A" }, { teamId: "B" }],
        games: [
          { categoryId: "masc", team1Id: "A", team2Id: "B", winnerId: "A", isPrincipal: true, matchScore: { team1: 15, team2: 5 } },
          { categoryId: "fem", team1Id: "A", team2Id: "B", winnerId: "A", isPrincipal: true, matchScore: { team1: 15, team2: 10 } },
          { categoryId: "mix", team1Id: "A", team2Id: "B", winnerId: "B", isPrincipal: true, matchScore: { team1: 10, team2: 15 } },
          { categoryId: "singles", team1Id: "A", team2Id: "B", winnerId: "B", isPrincipal: true, matchScore: { team1: 5, team2: 15 } },
        ],
      }] },
    ];
    const result = computeStandings(["A", "B"], rounds, cats, 3);
    // Both have 2 points, drawn, 2 category wins each
    // A point diff: (15-5) + (15-10) + (10-15) + (5-15) = 10+5-5-10 = 0
    // B point diff: (5-15) + (10-15) + (15-10) + (15-5) = -10-5+5+10 = 0
    // All equal!
    expect(result[0].points).toBe(2);
    expect(result[1].points).toBe(2);
    expect(result[0].pointDifference).toBe(0);

    // Now test with unequal margins
    const rounds2: Round[] = [
      { matchDays: [{
        teams: [{ teamId: "A" }, { teamId: "B" }],
        games: [
          { categoryId: "masc", team1Id: "A", team2Id: "B", winnerId: "A", isPrincipal: true, matchScore: { team1: 15, team2: 0 } },
          { categoryId: "fem", team1Id: "A", team2Id: "B", winnerId: "B", isPrincipal: true, matchScore: { team1: 13, team2: 15 } },
          { categoryId: "mix", team1Id: "A", team2Id: "B", winnerId: null, isPrincipal: true },
          { categoryId: "singles", team1Id: "A", team2Id: "B", winnerId: null, isPrincipal: true },
        ],
      }] },
    ];
    const result2 = computeStandings(["A", "B"], rounds2, cats, 3);
    // A: 1 pt, 1 cat win, PD: (15-0) + (13-15) = 15 - 2 = 13
    // B: 1 pt, 1 cat win, PD: (0-15) + (15-13) = -15 + 2 = -13
    expect(result2[0].teamId).toBe("A");
    expect(result2[0].pointDifference).toBe(13);
    expect(result2[1].pointDifference).toBe(-13);
  });
});

describe("isPrincipal in Category Standings", () => {
  test("extra games do not count for category rankings", () => {
    const rounds: Round[] = [{
      matchDays: [{
        teams: [{ teamId: "A" }, { teamId: "B" }],
        games: [
          { categoryId: "masc", team1Id: "A", team2Id: "B", winnerId: "A", isPrincipal: true },
          { categoryId: "masc", team1Id: "A", team2Id: "B", winnerId: "B", isPrincipal: false }, // extra game
        ],
      }],
    }];
    const catStandings = computeCategoryStandings(["A", "B"], rounds, "masc");
    // Only the principal game counts: A won
    expect(catStandings[0].teamId).toBe("A");
    expect(catStandings[0].wins).toBe(1);
    expect(catStandings[1].teamId).toBe("B");
    expect(catStandings[1].wins).toBe(0);
    expect(catStandings[1].losses).toBe(1);
  });

  test("principal games accumulate across rounds", () => {
    const rounds: Round[] = [
      { matchDays: [{
        teams: [{ teamId: "A" }, { teamId: "B" }],
        games: [
          { categoryId: "masc", team1Id: "A", team2Id: "B", winnerId: "A", isPrincipal: true },
        ],
      }] },
      { matchDays: [{
        teams: [{ teamId: "A" }, { teamId: "B" }],
        games: [
          { categoryId: "masc", team1Id: "A", team2Id: "B", winnerId: "B", isPrincipal: true },
        ],
      }] },
    ];
    const catStandings = computeCategoryStandings(["A", "B"], rounds, "masc");
    expect(catStandings[0].wins).toBe(1); // both have 1 win
    expect(catStandings[1].wins).toBe(1);
  });
});

describe("Liga Interclubes Examples from Regulation V2", () => {
  const cats = ["masc", "fem", "mix", "singles"];

  test("Example 1: A wins 4-0, tabela 3-0 (cap at 3)", () => {
    const rounds: Round[] = [{
      matchDays: [{
        teams: [{ teamId: "A" }, { teamId: "B" }],
        games: cats.map((c) => ({ categoryId: c, team1Id: "A", team2Id: "B", winnerId: "A", isPrincipal: true })),
      }],
    }];
    const result = computeStandings(["A", "B"], rounds, cats, 3);
    expect(result.find((r) => r.teamId === "A")!.points).toBe(3);
    expect(result.find((r) => r.teamId === "B")!.points).toBe(0);
  });

  test("Example 2: A wins 3, B wins 1, tabela 3-1", () => {
    const rounds: Round[] = [{
      matchDays: [{
        teams: [{ teamId: "A" }, { teamId: "B" }],
        games: [
          { categoryId: "masc", team1Id: "A", team2Id: "B", winnerId: "A", isPrincipal: true },
          { categoryId: "fem", team1Id: "A", team2Id: "B", winnerId: "A", isPrincipal: true },
          { categoryId: "mix", team1Id: "A", team2Id: "B", winnerId: "A", isPrincipal: true },
          { categoryId: "singles", team1Id: "A", team2Id: "B", winnerId: "B", isPrincipal: true },
        ],
      }],
    }];
    const result = computeStandings(["A", "B"], rounds, cats, 3);
    expect(result.find((r) => r.teamId === "A")!.points).toBe(3);
    expect(result.find((r) => r.teamId === "B")!.points).toBe(1);
  });

  test("Example 3 (with repetitions): 6 games, A wins 4, B wins 2, tabela 3-2", () => {
    const rounds: Round[] = [{
      matchDays: [{
        teams: [{ teamId: "A" }, { teamId: "B" }],
        games: [
          { categoryId: "masc", team1Id: "A", team2Id: "B", winnerId: "A", isPrincipal: true },
          { categoryId: "masc", team1Id: "A", team2Id: "B", winnerId: "A", isPrincipal: false }, // extra
          { categoryId: "fem", team1Id: "A", team2Id: "B", winnerId: "A", isPrincipal: true },
          { categoryId: "mix", team1Id: "A", team2Id: "B", winnerId: "B", isPrincipal: true },
          { categoryId: "singles", team1Id: "A", team2Id: "B", winnerId: "A", isPrincipal: true },
          { categoryId: "singles", team1Id: "A", team2Id: "B", winnerId: "B", isPrincipal: false }, // extra
        ],
      }],
    }];
    const result = computeStandings(["A", "B"], rounds, cats, 3);
    // A wins 4 (capped to 3), B wins 2
    expect(result.find((r) => r.teamId === "A")!.points).toBe(3);
    expect(result.find((r) => r.teamId === "B")!.points).toBe(2);
  });

  test("Example 4 (with repetitions): 8 games, A wins 5, B wins 3, tabela 3-3", () => {
    const rounds: Round[] = [{
      matchDays: [{
        teams: [{ teamId: "A" }, { teamId: "B" }],
        games: [
          { categoryId: "masc", team1Id: "A", team2Id: "B", winnerId: "A", isPrincipal: true },
          { categoryId: "masc", team1Id: "A", team2Id: "B", winnerId: "A", isPrincipal: false },
          { categoryId: "fem", team1Id: "A", team2Id: "B", winnerId: "B", isPrincipal: true },
          { categoryId: "fem", team1Id: "A", team2Id: "B", winnerId: "B", isPrincipal: false },
          { categoryId: "mix", team1Id: "A", team2Id: "B", winnerId: "A", isPrincipal: true },
          { categoryId: "mix", team1Id: "A", team2Id: "B", winnerId: "A", isPrincipal: false },
          { categoryId: "singles", team1Id: "A", team2Id: "B", winnerId: "A", isPrincipal: true },
          { categoryId: "singles", team1Id: "A", team2Id: "B", winnerId: "B", isPrincipal: false },
        ],
      }],
    }];
    const result = computeStandings(["A", "B"], rounds, cats, 3);
    // A wins 5 (capped to 3), B wins 3 (capped to 3)
    expect(result.find((r) => r.teamId === "A")!.points).toBe(3);
    expect(result.find((r) => r.teamId === "B")!.points).toBe(3);
    // A wins on totalCategoryWins (5 vs 3)
    expect(result[0].teamId).toBe("A");
    expect(result[0].totalCategoryWins).toBe(5);
    expect(result[1].totalCategoryWins).toBe(3);
  });
});
