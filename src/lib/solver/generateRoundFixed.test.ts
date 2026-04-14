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

function mkPlayer(
  id: string,
  skillLevel: SkillLevel,
  gender: "M" | "F" | null = null,
  matchCount = 0,
  paused = false,
): SolverPlayer {
  return { id, name: id, skillLevel, gender, matchCount, paused };
}

function mkTeam(player1Id: string, player2Id: string): Team {
  return { player1Id, player2Id };
}

const baseSettings: PairingSettings = {
  base: "random",
  teams: "fixed",
  gender: "random",
  skillWindow: Infinity,
  matchCountWindow: 1,
  varietyWindow: 0,
  maxWaitWindow: Infinity,
};

function run(
  players: SolverPlayer[],
  fixedTeams: Team[],
  numCourts: number,
  overrides: Partial<PairingSettings> = {},
  history: MatchHistoryEntry[] = [],
) {
  const input: SolverInput = {
    players,
    numCourts,
    settings: { ...baseSettings, ...overrides },
    history,
    locks: [],
    fixedTeams,
  };
  return generateRound(input);
}

describe("generateRound — fixed teams basics", () => {
  it("produces 1 matchup per court using the pre-formed teams", () => {
    const players = Array.from({ length: 8 }, (_, i) => mkPlayer(`p${i}`, 3));
    const fixedTeams = [
      mkTeam("p0", "p1"),
      mkTeam("p2", "p3"),
      mkTeam("p4", "p5"),
      mkTeam("p6", "p7"),
    ];
    const result = run(players, fixedTeams, 2);
    expect(result.round).toHaveLength(2);
    // Every match uses two of the pre-formed teams — never splits a pair.
    for (const m of result.round) {
      const team1Key = [m.team1.player1Id, m.team1.player2Id].sort().join(":");
      const team2Key = [m.team2.player1Id, m.team2.player2Id].sort().join(":");
      const fixedKeys = fixedTeams.map((t) => [t.player1Id, t.player2Id].sort().join(":"));
      expect(fixedKeys).toContain(team1Key);
      expect(fixedKeys).toContain(team2Key);
    }
  });

  it("sits out unmatched teams when there aren't enough courts", () => {
    const players = Array.from({ length: 8 }, (_, i) => mkPlayer(`p${i}`, 3));
    const fixedTeams = [
      mkTeam("p0", "p1"),
      mkTeam("p2", "p3"),
      mkTeam("p4", "p5"),
      mkTeam("p6", "p7"),
    ];
    const result = run(players, fixedTeams, 1);
    expect(result.round).toHaveLength(1);
    expect(result.sittingOut).toHaveLength(4);
  });

  it("excludes teams with any paused player", () => {
    const players = [
      mkPlayer("p0", 3),
      mkPlayer("p1", 3, null, 0, true), // paused
      mkPlayer("p2", 3),
      mkPlayer("p3", 3),
      mkPlayer("p4", 3),
      mkPlayer("p5", 3),
    ];
    const fixedTeams = [
      mkTeam("p0", "p1"), // has paused
      mkTeam("p2", "p3"),
      mkTeam("p4", "p5"),
    ];
    const result = run(players, fixedTeams, 2);
    // Only two teams are eligible → 1 matchup.
    expect(result.round).toHaveLength(1);
    const used = new Set<string>();
    for (const m of result.round) {
      used.add(m.team1.player1Id);
      used.add(m.team2.player1Id);
    }
    expect(used.has("p0")).toBe(false);
    expect(used.has("p1")).toBe(false);
  });
});

describe("generateRound — fixed teams skill window", () => {
  it("skill=1 prefers matchups within tolerance", () => {
    // 4 teams: two L1+L1 and two L3+L3. Skill=1 should keep them on
    // their own level (L1 vs L1 on court 1, L3 vs L3 on court 2) — spread 0.
    // Cross matchups would give spread 2, cost 100.
    const players = [
      mkPlayer("a1", 1), mkPlayer("a2", 1),
      mkPlayer("b1", 1), mkPlayer("b2", 1),
      mkPlayer("c1", 3), mkPlayer("c2", 3),
      mkPlayer("d1", 3), mkPlayer("d2", 3),
    ];
    const fixedTeams = [
      mkTeam("a1", "a2"),
      mkTeam("b1", "b2"),
      mkTeam("c1", "c2"),
      mkTeam("d1", "d2"),
    ];
    const result = run(players, fixedTeams, 2, { skillWindow: 1 });
    expect(result.round).toHaveLength(2);
    expect(result.cost).toBe(0);
  });
});

describe("generateRound — fixed teams variety", () => {
  it("avoids replaying the same matchup", () => {
    const players = Array.from({ length: 8 }, (_, i) => mkPlayer(`p${i}`, 3, null, 1));
    const fixedTeams = [
      mkTeam("p0", "p1"),
      mkTeam("p2", "p3"),
      mkTeam("p4", "p5"),
      mkTeam("p6", "p7"),
    ];
    const history: MatchHistoryEntry[] = [
      { round: 1, courtNum: 1, team1Ids: ["p0", "p1"], team2Ids: ["p2", "p3"] },
      { round: 1, courtNum: 2, team1Ids: ["p4", "p5"], team2Ids: ["p6", "p7"] },
    ];
    const result = run(players, fixedTeams, 2, { varietyWindow: 0 }, history);
    // Round 2 shouldn't repeat (p0,p1) vs (p2,p3) or (p4,p5) vs (p6,p7).
    const keyOf = (m: (typeof result.round)[number]) => {
      const a = [m.team1.player1Id, m.team1.player2Id].sort().join("|");
      const b = [m.team2.player1Id, m.team2.player2Id].sort().join("|");
      return [a, b].sort().join(" vs ");
    };
    const old1 = "p0|p1 vs p2|p3";
    const old2 = "p4|p5 vs p6|p7";
    for (const m of result.round) {
      expect(keyOf(m)).not.toBe(old1);
      expect(keyOf(m)).not.toBe(old2);
    }
  });
});
