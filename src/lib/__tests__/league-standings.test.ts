import { describe, test, expect } from "vitest";

/**
 * Unit tests for league standings computation logic.
 * Tests the scoring rules: points capping, category rankings, tiebreakers.
 */

// Standalone computation functions (mirrors the API logic)
interface Game { categoryId: string; team1Id: string; team2Id: string; winnerId: string | null }
interface MatchDay { teams: { teamId: string }[]; games: Game[] }
interface Round { matchDays: MatchDay[] }

function computeStandings(
  teamIds: string[],
  rounds: Round[],
  categoryIds: string[],
  maxPointsPerMatchDay: number,
) {
  const standings: Record<string, { points: number; won: number; lost: number; drawn: number; totalCategoryWins: number; categoryWins: Record<string, number> }> = {};
  for (const tid of teamIds) {
    standings[tid] = { points: 0, won: 0, lost: 0, drawn: 0, totalCategoryWins: 0, categoryWins: Object.fromEntries(categoryIds.map((c) => [c, 0])) };
  }

  for (const round of rounds) {
    for (const md of round.matchDays) {
      const mdWins: Record<string, number> = {};
      for (const game of md.games) {
        if (game.winnerId) {
          mdWins[game.winnerId] = (mdWins[game.winnerId] || 0) + 1;
          standings[game.winnerId].totalCategoryWins++;
          standings[game.winnerId].categoryWins[game.categoryId] = (standings[game.winnerId].categoryWins[game.categoryId] || 0) + 1;
        }
      }

      const hasResults = md.games.some((g) => g.winnerId);
      if (!hasResults) continue;

      const tids = md.teams.map((t) => t.teamId);
      for (const tid of tids) {
        standings[tid].points += Math.min(mdWins[tid] || 0, maxPointsPerMatchDay);
      }

      if (tids.length === 2) {
        const [a, b] = tids;
        const aW = mdWins[a] || 0, bW = mdWins[b] || 0;
        if (aW > bW) { standings[a].won++; standings[b].lost++; }
        else if (bW > aW) { standings[b].won++; standings[a].lost++; }
        else { standings[a].drawn++; standings[b].drawn++; }
      }
    }
  }

  return Object.entries(standings)
    .map(([id, s]) => ({ teamId: id, ...s }))
    .sort((a, b) => b.points - a.points || b.totalCategoryWins - a.totalCategoryWins);
}

describe("League Standings", () => {
  const teams = ["teamA", "teamB"];
  const cats = ["masc", "fem", "mix", "singles"];

  test("empty league has zero points", () => {
    const result = computeStandings(teams, [], cats, 3);
    expect(result[0].points).toBe(0);
    expect(result[0].won).toBe(0);
  });

  test("winning all 4 categories only gives maxPointsPerMatchDay (3)", () => {
    const rounds: Round[] = [{
      matchDays: [{
        teams: [{ teamId: "teamA" }, { teamId: "teamB" }],
        games: cats.map((c) => ({ categoryId: c, team1Id: "teamA", team2Id: "teamB", winnerId: "teamA" })),
      }],
    }];
    const result = computeStandings(teams, rounds, cats, 3);
    const a = result.find((r) => r.teamId === "teamA")!;
    expect(a.points).toBe(3); // capped at 3, not 4
    expect(a.totalCategoryWins).toBe(4); // but total wins counts all
    expect(a.won).toBe(1);
  });

  test("winning 2 categories gives 2 points (under cap)", () => {
    const rounds: Round[] = [{
      matchDays: [{
        teams: [{ teamId: "teamA" }, { teamId: "teamB" }],
        games: [
          { categoryId: "masc", team1Id: "teamA", team2Id: "teamB", winnerId: "teamA" },
          { categoryId: "fem", team1Id: "teamA", team2Id: "teamB", winnerId: "teamA" },
          { categoryId: "mix", team1Id: "teamA", team2Id: "teamB", winnerId: "teamB" },
          { categoryId: "singles", team1Id: "teamA", team2Id: "teamB", winnerId: "teamB" },
        ],
      }],
    }];
    const result = computeStandings(teams, rounds, cats, 3);
    const a = result.find((r) => r.teamId === "teamA")!;
    const b = result.find((r) => r.teamId === "teamB")!;
    expect(a.points).toBe(2);
    expect(b.points).toBe(2);
    expect(a.drawn).toBe(1); // 2-2 is a draw
    expect(b.drawn).toBe(1);
  });

  test("3-1 result gives winner 3 points, loser 1 (capped)", () => {
    const rounds: Round[] = [{
      matchDays: [{
        teams: [{ teamId: "teamA" }, { teamId: "teamB" }],
        games: [
          { categoryId: "masc", team1Id: "teamA", team2Id: "teamB", winnerId: "teamA" },
          { categoryId: "fem", team1Id: "teamA", team2Id: "teamB", winnerId: "teamA" },
          { categoryId: "mix", team1Id: "teamA", team2Id: "teamB", winnerId: "teamA" },
          { categoryId: "singles", team1Id: "teamA", team2Id: "teamB", winnerId: "teamB" },
        ],
      }],
    }];
    const result = computeStandings(teams, rounds, cats, 3);
    const a = result.find((r) => r.teamId === "teamA")!;
    const b = result.find((r) => r.teamId === "teamB")!;
    expect(a.points).toBe(3);
    expect(b.points).toBe(1);
    expect(a.won).toBe(1);
    expect(b.lost).toBe(1);
  });

  test("multiple rounds accumulate correctly", () => {
    const rounds: Round[] = [
      { matchDays: [{ teams: [{ teamId: "teamA" }, { teamId: "teamB" }], games: cats.map((c) => ({ categoryId: c, team1Id: "teamA", team2Id: "teamB", winnerId: "teamA" })) }] },
      { matchDays: [{ teams: [{ teamId: "teamA" }, { teamId: "teamB" }], games: cats.map((c) => ({ categoryId: c, team1Id: "teamA", team2Id: "teamB", winnerId: "teamB" })) }] },
    ];
    const result = computeStandings(teams, rounds, cats, 3);
    const a = result.find((r) => r.teamId === "teamA")!;
    const b = result.find((r) => r.teamId === "teamB")!;
    expect(a.points).toBe(3);
    expect(b.points).toBe(3);
    expect(a.won).toBe(1);
    expect(a.lost).toBe(1);
  });

  test("category wins used as tiebreaker", () => {
    // Both teams have 3 points but teamA has more total category wins
    const rounds: Round[] = [
      { matchDays: [{ teams: [{ teamId: "teamA" }, { teamId: "teamB" }], games: cats.map((c) => ({ categoryId: c, team1Id: "teamA", team2Id: "teamB", winnerId: "teamA" })) }] },
      { matchDays: [{ teams: [{ teamId: "teamA" }, { teamId: "teamB" }], games: [
        { categoryId: "masc", team1Id: "teamA", team2Id: "teamB", winnerId: "teamB" },
        { categoryId: "fem", team1Id: "teamA", team2Id: "teamB", winnerId: "teamB" },
        { categoryId: "mix", team1Id: "teamA", team2Id: "teamB", winnerId: "teamB" },
        { categoryId: "singles", team1Id: "teamA", team2Id: "teamB", winnerId: null },
      ] }] },
    ];
    const result = computeStandings(teams, rounds, cats, 3);
    // TeamA: 3 pts (round 1, 4 wins capped to 3) + 0 pts = 3, total cat wins = 4
    // TeamB: 0 pts (round 1) + 3 pts (round 2, 3 wins) = 3, total cat wins = 3
    expect(result[0].teamId).toBe("teamA"); // wins tiebreaker
    expect(result[0].totalCategoryWins).toBe(4);
    expect(result[1].totalCategoryWins).toBe(3);
  });

  test("unplayed games (winnerId null) are ignored", () => {
    const rounds: Round[] = [{
      matchDays: [{
        teams: [{ teamId: "teamA" }, { teamId: "teamB" }],
        games: [
          { categoryId: "masc", team1Id: "teamA", team2Id: "teamB", winnerId: "teamA" },
          { categoryId: "fem", team1Id: "teamA", team2Id: "teamB", winnerId: null },
          { categoryId: "mix", team1Id: "teamA", team2Id: "teamB", winnerId: null },
          { categoryId: "singles", team1Id: "teamA", team2Id: "teamB", winnerId: null },
        ],
      }],
    }];
    const result = computeStandings(teams, rounds, cats, 3);
    const a = result.find((r) => r.teamId === "teamA")!;
    expect(a.points).toBe(1);
    expect(a.totalCategoryWins).toBe(1);
    expect(a.won).toBe(1); // 1-0 counts as win
  });

  test("category standings track per-category wins", () => {
    const rounds: Round[] = [{
      matchDays: [{
        teams: [{ teamId: "teamA" }, { teamId: "teamB" }],
        games: [
          { categoryId: "masc", team1Id: "teamA", team2Id: "teamB", winnerId: "teamA" },
          { categoryId: "fem", team1Id: "teamA", team2Id: "teamB", winnerId: "teamB" },
          { categoryId: "mix", team1Id: "teamA", team2Id: "teamB", winnerId: "teamA" },
          { categoryId: "singles", team1Id: "teamA", team2Id: "teamB", winnerId: "teamB" },
        ],
      }],
    }];
    const result = computeStandings(teams, rounds, cats, 3);
    const a = result.find((r) => r.teamId === "teamA")!;
    expect(a.categoryWins["masc"]).toBe(1);
    expect(a.categoryWins["fem"]).toBe(0);
    expect(a.categoryWins["mix"]).toBe(1);
  });

  test("maxPointsPerMatchDay=99 effectively means no cap", () => {
    const rounds: Round[] = [{
      matchDays: [{
        teams: [{ teamId: "teamA" }, { teamId: "teamB" }],
        games: cats.map((c) => ({ categoryId: c, team1Id: "teamA", team2Id: "teamB", winnerId: "teamA" })),
      }],
    }];
    const result = computeStandings(teams, rounds, cats, 99);
    const a = result.find((r) => r.teamId === "teamA")!;
    expect(a.points).toBe(4); // no cap
  });

  test("3+ teams in a match day", () => {
    const threeTeams = ["teamA", "teamB", "teamC"];
    const rounds: Round[] = [{
      matchDays: [{
        teams: threeTeams.map((t) => ({ teamId: t })),
        games: [
          { categoryId: "masc", team1Id: "teamA", team2Id: "teamB", winnerId: "teamA" },
          { categoryId: "masc", team1Id: "teamA", team2Id: "teamC", winnerId: "teamC" },
          { categoryId: "masc", team1Id: "teamB", team2Id: "teamC", winnerId: "teamC" },
        ],
      }],
    }];
    const result = computeStandings(threeTeams, rounds, cats, 3);
    const c = result.find((r) => r.teamId === "teamC")!;
    expect(c.points).toBe(2); // won 2 games
    expect(c.won).toBe(0); // W/L/D not computed for 3+ team match days
    expect(c.drawn).toBe(0);
  });
});
