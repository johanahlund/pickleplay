import { describe, it, expect } from "vitest";
import { generateRound } from "./generateRound";
import type {
  MatchHistoryEntry,
  PairingSettings,
  SolverInput,
  SolverPlayer,
  SkillLevel,
} from "./types";

// ── Helpers ────────────────────────────────────────────────────────────────

function mkPlayer(
  id: string,
  skillLevel: SkillLevel,
  gender: "M" | "F" | null = null,
  matchCount = 0,
): SolverPlayer {
  return { id, name: id, skillLevel, gender, matchCount };
}

const baseSettings: PairingSettings = {
  base: "random",
  teams: "rotating",
  gender: "random",
  skillWindow: Infinity,
  matchCountWindow: 1,
  varietyWindow: 0,
  maxWaitWindow: Infinity,
};

function run(
  players: SolverPlayer[],
  numCourts: number,
  overrides: Partial<PairingSettings> = {},
  history: MatchHistoryEntry[] = [],
) {
  const input: SolverInput = {
    players,
    numCourts,
    format: "singles",
    settings: { ...baseSettings, ...overrides },
    history,
    locks: [],
  };
  return generateRound(input);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("generateRound — singles basics", () => {
  it("produces 1 match per court with 2 players each", () => {
    const players = Array.from({ length: 4 }, (_, i) => mkPlayer(`p${i}`, 3));
    const result = run(players, 2);
    expect(result.round).toHaveLength(2);
    const used = new Set<string>();
    for (const m of result.round) {
      used.add(m.team1.player1Id);
      used.add(m.team2.player1Id);
      // sentinel: player1Id === player2Id in singles
      expect(m.team1.player1Id).toBe(m.team1.player2Id);
      expect(m.team2.player1Id).toBe(m.team2.player2Id);
    }
    expect(used.size).toBe(4);
  });

  it("sits out the odd player", () => {
    const players = Array.from({ length: 5 }, (_, i) => mkPlayer(`p${i}`, 3));
    const result = run(players, 2);
    expect(result.round).toHaveLength(2);
    expect(result.sittingOut).toHaveLength(1);
  });

  it("caps at numCourts even with lots of players", () => {
    const players = Array.from({ length: 10 }, (_, i) => mkPlayer(`p${i}`, 3));
    const result = run(players, 2);
    expect(result.round).toHaveLength(2);
    expect(result.sittingOut).toHaveLength(6);
  });
});

describe("generateRound — singles skill window", () => {
  it("skill=0 pairs same-level players in a rich pool", () => {
    const players = [
      mkPlayer("lo1", 1),
      mkPlayer("lo2", 1),
      mkPlayer("hi1", 3),
      mkPlayer("hi2", 3),
    ];
    const result = run(players, 2, { skillWindow: 0 });
    expect(result.round).toHaveLength(2);
    expect(result.cost).toBe(0);
    for (const m of result.round) {
      const p1 = players.find((p) => p.id === m.team1.player1Id)!;
      const p2 = players.find((p) => p.id === m.team2.player1Id)!;
      expect(p1.skillLevel).toBe(p2.skillLevel);
    }
  });

  it("skill=1 allows ±1 gap", () => {
    const players = [mkPlayer("a", 2), mkPlayer("b", 3)];
    const result = run(players, 1, { skillWindow: 1 });
    expect(result.cost).toBe(0);
  });
});

describe("generateRound — singles gender", () => {
  it("gender=mixed pairs M vs F", () => {
    const players = [
      mkPlayer("m1", 3, "M"),
      mkPlayer("m2", 3, "M"),
      mkPlayer("f1", 3, "F"),
      mkPlayer("f2", 3, "F"),
    ];
    const result = run(players, 2, { gender: "mixed" });
    for (const m of result.round) {
      const g1 = players.find((p) => p.id === m.team1.player1Id)!.gender;
      const g2 = players.find((p) => p.id === m.team2.player1Id)!.gender;
      expect(g1).not.toBe(g2);
    }
    expect(result.cost).toBe(0);
  });

  it("gender=same pairs same-gender opponents", () => {
    const players = [
      mkPlayer("m1", 3, "M"),
      mkPlayer("m2", 3, "M"),
      mkPlayer("f1", 3, "F"),
      mkPlayer("f2", 3, "F"),
    ];
    const result = run(players, 2, { gender: "same" });
    for (const m of result.round) {
      const g1 = players.find((p) => p.id === m.team1.player1Id)!.gender;
      const g2 = players.find((p) => p.id === m.team2.player1Id)!.gender;
      expect(g1).toBe(g2);
    }
    expect(result.cost).toBe(0);
  });
});

describe("generateRound — singles variety", () => {
  it("avoids repeat opponents when variety=0", () => {
    const players = [mkPlayer("a", 3), mkPlayer("b", 3), mkPlayer("c", 3), mkPlayer("d", 3)];
    const history: MatchHistoryEntry[] = [
      // In singles, team1Ids = [a, a] and team2Ids = [b, b] (sentinel).
      // History format expects actual player IDs, so use one id per team.
      { round: 1, courtNum: 1, team1Ids: ["a", "a"], team2Ids: ["b", "b"] },
      { round: 1, courtNum: 2, team1Ids: ["c", "c"], team2Ids: ["d", "d"] },
    ];
    const result = run(players, 2, { varietyWindow: 0 }, history);
    // Round 2 should not pit a vs b or c vs d again.
    for (const m of result.round) {
      const pair = [m.team1.player1Id, m.team2.player1Id].sort().join(":");
      expect(pair).not.toBe("a:b");
      expect(pair).not.toBe("c:d");
    }
  });
});
