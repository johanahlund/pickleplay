import { describe, it, expect } from "vitest";
import { generateRound } from "./generateRound";
import type {
  MatchHistoryEntry,
  PairingSettings,
  SolverInput,
  SolverPlayer,
  SkillLevel,
  Team,
} from "./types";

function mkPlayer(id: string, level: SkillLevel): SolverPlayer {
  return { id, name: id, skillLevel: level, gender: null, matchCount: 0 };
}

function mkTeam(player1Id: string, player2Id: string): Team {
  return { player1Id, player2Id };
}

const baseSettings: PairingSettings = {
  base: "swiss",
  teams: "fixed",
  gender: "random",
  skillWindow: Infinity,
  matchCountWindow: Infinity,
  varietyWindow: Infinity,
  maxWaitWindow: Infinity,
};

function run(
  players: SolverPlayer[],
  fixedTeams: Team[],
  numCourts: number,
  history: MatchHistoryEntry[] = [],
) {
  const input: SolverInput = {
    players,
    numCourts,
    settings: baseSettings,
    history,
    locks: [],
    fixedTeams,
  };
  return generateRound(input);
}

describe("generateRound — Swiss round 1", () => {
  it("seeds round 1 by team strength and pairs adjacent", () => {
    // 4 teams with sumLevel 2, 4, 6, 8. Sorted desc: 8, 6, 4, 2.
    // Adjacent pairing: (8 vs 6) on court 1, (4 vs 2) on court 2.
    const players = [
      mkPlayer("a1", 4), mkPlayer("a2", 4),
      mkPlayer("b1", 3), mkPlayer("b2", 3),
      mkPlayer("c1", 2), mkPlayer("c2", 2),
      mkPlayer("d1", 1), mkPlayer("d2", 1),
    ];
    const fixedTeams = [
      mkTeam("a1", "a2"), // sum 8
      mkTeam("b1", "b2"), // sum 6
      mkTeam("c1", "c2"), // sum 4
      mkTeam("d1", "d2"), // sum 2
    ];
    const result = run(players, fixedTeams, 2);
    expect(result.round).toHaveLength(2);

    // Court 1 should be the top 2 teams (a + b). Court 2 should be bottom 2 (c + d).
    const teamKey = (pid1: string, pid2: string) => [pid1, pid2].sort().join("|");
    const court1 = result.round[0];
    const court2 = result.round[1];
    const c1Teams = [
      teamKey(court1.team1.player1Id, court1.team1.player2Id),
      teamKey(court1.team2.player1Id, court1.team2.player2Id),
    ].sort();
    const c2Teams = [
      teamKey(court2.team1.player1Id, court2.team1.player2Id),
      teamKey(court2.team2.player1Id, court2.team2.player2Id),
    ].sort();
    expect(c1Teams).toEqual(["a1|a2", "b1|b2"]);
    expect(c2Teams).toEqual(["c1|c2", "d1|d2"]);
  });
});

describe("generateRound — Swiss subsequent rounds", () => {
  it("pairs teams by W/L record after round 1", () => {
    // 4 teams, all equal strength.
    const players = [
      mkPlayer("a1", 3), mkPlayer("a2", 3),
      mkPlayer("b1", 3), mkPlayer("b2", 3),
      mkPlayer("c1", 3), mkPlayer("c2", 3),
      mkPlayer("d1", 3), mkPlayer("d2", 3),
    ];
    const fixedTeams = [
      mkTeam("a1", "a2"),
      mkTeam("b1", "b2"),
      mkTeam("c1", "c2"),
      mkTeam("d1", "d2"),
    ];
    // Round 1 results: a beat b, c beat d.
    // After round 1 standings: a (1-0), c (1-0), b (0-1), d (0-1).
    // Round 2 should pair: (a vs c) on court 1, (b vs d) on court 2.
    const history: MatchHistoryEntry[] = [
      {
        round: 1, courtNum: 1,
        team1Ids: ["a1", "a2"], team2Ids: ["b1", "b2"],
        winningTeam: 1,
      },
      {
        round: 1, courtNum: 2,
        team1Ids: ["c1", "c2"], team2Ids: ["d1", "d2"],
        winningTeam: 1,
      },
    ];
    const result = run(players, fixedTeams, 2, history);
    expect(result.round).toHaveLength(2);

    const teamKey = (m: typeof result.round[number]) => {
      const t1 = [m.team1.player1Id, m.team1.player2Id].sort().join("|");
      const t2 = [m.team2.player1Id, m.team2.player2Id].sort().join("|");
      return [t1, t2].sort().join(" vs ");
    };
    expect(teamKey(result.round[0])).toBe("a1|a2 vs c1|c2");
    expect(teamKey(result.round[1])).toBe("b1|b2 vs d1|d2");
  });

  it("uses seed as tiebreaker when W/L is tied", () => {
    // Two teams each with 1-0, different seeds. Swiss should sort by
    // wins first (tied), then losses (tied), then seed (sumLevel DESC).
    const players = [
      mkPlayer("strong1", 5), mkPlayer("strong2", 5),
      mkPlayer("weak1", 1), mkPlayer("weak2", 1),
      mkPlayer("mid1", 3), mkPlayer("mid2", 3),
      mkPlayer("other1", 3), mkPlayer("other2", 3),
    ];
    const fixedTeams = [
      mkTeam("strong1", "strong2"), // sum 10
      mkTeam("weak1", "weak2"),     // sum 2
      mkTeam("mid1", "mid2"),       // sum 6
      mkTeam("other1", "other2"),   // sum 6
    ];
    // All 4 teams with 0 record → round 1 uses pure seed sort.
    const result = run(players, fixedTeams, 2);
    // Top seed (strong) should be on court 1.
    const court1 = result.round[0];
    const ids = new Set([
      court1.team1.player1Id,
      court1.team1.player2Id,
      court1.team2.player1Id,
      court1.team2.player2Id,
    ]);
    expect(ids.has("strong1")).toBe(true);
  });
});
