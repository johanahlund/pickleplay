import { describe, it, expect } from "vitest";
import { generateRound } from "./generateRound";
import type {
  MatchHistoryEntry,
  PairLock,
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
  paused = false,
): SolverPlayer {
  return { id, name: id, skillLevel, gender, matchCount, paused };
}

const defaultSettings: PairingSettings = {
  base: "random",
  teams: "rotating",
  gender: "random",
  skillWindow: Infinity,
  matchCountWindow: 1,
  varietyWindow: 0,
};

function run(
  players: SolverPlayer[],
  numCourts: number,
  overrides: Partial<PairingSettings> = {},
  history: MatchHistoryEntry[] = [],
  locks: PairLock[] = [],
) {
  const input: SolverInput = {
    players,
    numCourts,
    settings: { ...defaultSettings, ...overrides },
    history,
    locks,
  };
  return generateRound(input);
}

/** Apply the result back as history so we can call generateRound again. */
function accumulate(
  players: SolverPlayer[],
  round: ReturnType<typeof generateRound>["round"],
  roundNumber: number,
): { players: SolverPlayer[]; historyAdd: MatchHistoryEntry[] } {
  const playedIds = new Set<string>();
  const historyAdd: MatchHistoryEntry[] = [];
  for (const m of round) {
    historyAdd.push({
      round: roundNumber,
      courtNum: m.court,
      team1Ids: [m.team1.player1Id, m.team1.player2Id],
      team2Ids: [m.team2.player1Id, m.team2.player2Id],
    });
    playedIds.add(m.team1.player1Id);
    playedIds.add(m.team1.player2Id);
    playedIds.add(m.team2.player1Id);
    playedIds.add(m.team2.player2Id);
  }
  const nextPlayers = players.map((p) =>
    playedIds.has(p.id) ? { ...p, matchCount: p.matchCount + 1 } : p,
  );
  return { players: nextPlayers, historyAdd };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("generateRound — basic structure", () => {
  it("produces one match per court with 4 unique players each", () => {
    const players = Array.from({ length: 8 }, (_, i) => mkPlayer(`p${i}`, 3));
    const result = run(players, 2);
    expect(result.round).toHaveLength(2);
    const seen = new Set<string>();
    for (const m of result.round) {
      for (const id of [m.team1.player1Id, m.team1.player2Id, m.team2.player1Id, m.team2.player2Id]) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    expect(seen.size).toBe(8);
    expect(result.sittingOut).toEqual([]);
  });

  it("sits out overflow when players don't divide cleanly", () => {
    const players = Array.from({ length: 5 }, (_, i) => mkPlayer(`p${i}`, 3));
    const result = run(players, 2);
    expect(result.round).toHaveLength(1); // only one court can be filled
    expect(result.sittingOut).toHaveLength(1);
  });

  it("fills up to numCourts but no more", () => {
    const players = Array.from({ length: 16 }, (_, i) => mkPlayer(`p${i}`, 3));
    const result = run(players, 2);
    expect(result.round).toHaveLength(2); // capped at numCourts
    expect(result.sittingOut).toHaveLength(8);
  });

  it("skips paused players", () => {
    const players = [
      ...Array.from({ length: 4 }, (_, i) => mkPlayer(`p${i}`, 3)),
      mkPlayer("paused1", 3, null, 0, true),
      mkPlayer("paused2", 3, null, 0, true),
    ];
    const result = run(players, 1);
    const used = new Set<string>();
    for (const m of result.round) {
      used.add(m.team1.player1Id);
      used.add(m.team1.player2Id);
      used.add(m.team2.player1Id);
      used.add(m.team2.player2Id);
    }
    expect(used.has("paused1")).toBe(false);
    expect(used.has("paused2")).toBe(false);
  });
});

describe("generateRound — skill window", () => {
  it("with skillWindow=0, pairs same-level players in a rich pool", () => {
    // Rich pool: 4 L1 + 4 L3
    const players = [
      ...Array.from({ length: 4 }, (_, i) => mkPlayer(`lo${i}`, 1)),
      ...Array.from({ length: 4 }, (_, i) => mkPlayer(`hi${i}`, 3)),
    ];
    const result = run(players, 2, { skillWindow: 0 });
    expect(result.round).toHaveLength(2);
    // Each match should be either all-L1 or all-L3, spread 0.
    for (const m of result.round) {
      const levels = [
        m.team1.player1Id,
        m.team1.player2Id,
        m.team2.player1Id,
        m.team2.player2Id,
      ].map((id) => players.find((p) => p.id === id)!.skillLevel);
      expect(Math.max(...levels) - Math.min(...levels)).toBe(0);
    }
  });

  it("with skillWindow=1, allows ±1 gaps", () => {
    const players = [
      mkPlayer("a", 2),
      mkPlayer("b", 2),
      mkPlayer("c", 3),
      mkPlayer("d", 3),
    ];
    const result = run(players, 1, { skillWindow: 1 });
    expect(result.round).toHaveLength(1);
    // Cost should be 0 — spread is 1, within window.
    expect(result.cost).toBe(0);
  });

  it("with a thin pool, falls back to closest-possible (high cost)", () => {
    // 4 players at wildly different levels. Cannot satisfy skillWindow=0.
    const players = [
      mkPlayer("a", 1),
      mkPlayer("b", 2),
      mkPlayer("c", 4),
      mkPlayer("d", 5),
    ];
    const result = run(players, 1, { skillWindow: 0 });
    // Solver still produces a match (greedy fallback), but with a skill cost.
    expect(result.round).toHaveLength(1);
    const skillViolations = result.violations.filter((v) => v.type === "skill");
    expect(skillViolations.length).toBeGreaterThan(0);
  });
});

describe("generateRound — gender rule", () => {
  it("gender=mixed prefers 1M+1F teams", () => {
    const players = [
      mkPlayer("m1", 3, "M"),
      mkPlayer("m2", 3, "M"),
      mkPlayer("f1", 3, "F"),
      mkPlayer("f2", 3, "F"),
    ];
    const result = run(players, 1, { gender: "mixed" });
    expect(result.round).toHaveLength(1);
    for (const team of [result.round[0].team1, result.round[0].team2]) {
      const g1 = players.find((p) => p.id === team.player1Id)!.gender;
      const g2 = players.find((p) => p.id === team.player2Id)!.gender;
      expect(g1).not.toBe(g2); // mixed
    }
    expect(result.cost).toBe(0);
  });

  it("gender=same prefers 2M or 2F teams", () => {
    const players = [
      mkPlayer("m1", 3, "M"),
      mkPlayer("m2", 3, "M"),
      mkPlayer("f1", 3, "F"),
      mkPlayer("f2", 3, "F"),
    ];
    const result = run(players, 1, { gender: "same" });
    for (const team of [result.round[0].team1, result.round[0].team2]) {
      const g1 = players.find((p) => p.id === team.player1Id)!.gender;
      const g2 = players.find((p) => p.id === team.player2Id)!.gender;
      expect(g1).toBe(g2); // same
    }
    expect(result.cost).toBe(0);
  });
});

describe("generateRound — variety window", () => {
  it("avoids repeat partners when variety=0", () => {
    const players = Array.from({ length: 4 }, (_, i) => mkPlayer(`p${i}`, 3));
    const history: MatchHistoryEntry[] = [
      { round: 1, courtNum: 1, team1Ids: ["p0", "p1"], team2Ids: ["p2", "p3"] },
    ];
    // Round 2 should NOT repeat (p0,p1) or (p2,p3) partnerships.
    const result = run(players, 1, { varietyWindow: 0 }, history);
    const teams = [
      [result.round[0].team1.player1Id, result.round[0].team1.player2Id].sort(),
      [result.round[0].team2.player1Id, result.round[0].team2.player2Id].sort(),
    ];
    const teamKeys = teams.map((t) => t.join(":"));
    expect(teamKeys).not.toContain("p0:p1");
    expect(teamKeys).not.toContain("p2:p3");
  });
});

describe("generateRound — match count window (fairness)", () => {
  it("prioritizes under-played players", () => {
    // p0-p3 have already played 3 matches, p4-p7 have played 0.
    const players = [
      ...Array.from({ length: 4 }, (_, i) => mkPlayer(`played${i}`, 3, null, 3)),
      ...Array.from({ length: 4 }, (_, i) => mkPlayer(`fresh${i}`, 3, null, 0)),
    ];
    // Average = 1.5, window ±1 → valid range [0.5, 2.5]. After this round,
    // "played" players would be at 4 (way out of window), "fresh" at 1 (in).
    const result = run(players, 1, { matchCountWindow: 1 });
    const used = new Set<string>();
    for (const m of result.round) {
      used.add(m.team1.player1Id);
      used.add(m.team1.player2Id);
      used.add(m.team2.player1Id);
      used.add(m.team2.player2Id);
    }
    // The 4 players chosen should be the "fresh" ones — they minimize
    // match-count violation cost.
    for (const id of used) {
      expect(id.startsWith("fresh")).toBe(true);
    }
  });

  it("converges toward equal play time over multiple rounds", () => {
    // 5 players, 1 court — one sits out each round. Over 5 rounds, every
    // player should have played 4 times (within window).
    let players = Array.from({ length: 5 }, (_, i) => mkPlayer(`p${i}`, 3));
    let history: MatchHistoryEntry[] = [];
    for (let r = 1; r <= 5; r++) {
      const result = run(players, 1, { matchCountWindow: 1 }, history);
      const { players: next, historyAdd } = accumulate(players, result.round, r);
      players = next;
      history = [...history, ...historyAdd];
    }
    const counts = players.map((p) => p.matchCount);
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    // Spread should be at most 1 (within window)
    expect(max - min).toBeLessThanOrEqual(1);
  });
});

describe("generateRound — manual pair locks", () => {
  it("keeps locked players together as partners", () => {
    const players = Array.from({ length: 4 }, (_, i) => mkPlayer(`p${i}`, 3));
    const result = run(players, 1, {}, [], [{ playerAId: "p0", playerBId: "p1" }]);
    // p0 and p1 must be on the same team.
    const m = result.round[0];
    const t1 = [m.team1.player1Id, m.team1.player2Id];
    const t2 = [m.team2.player1Id, m.team2.player2Id];
    const inT1 = t1.includes("p0") && t1.includes("p1");
    const inT2 = t2.includes("p0") && t2.includes("p1");
    expect(inT1 || inT2).toBe(true);
  });
});

describe("generateRound — scenario from design walkthrough", () => {
  it("Scenario 1: 4×L1 + 4×L3 with skill=0 puts levels on separate courts", () => {
    const players = [
      ...Array.from({ length: 4 }, (_, i) => mkPlayer(`lo${i}`, 1)),
      ...Array.from({ length: 4 }, (_, i) => mkPlayer(`hi${i}`, 3)),
    ];
    const result = run(players, 2, { skillWindow: 0 });
    expect(result.round).toHaveLength(2);
    expect(result.cost).toBe(0); // everything satisfied in rich pool
  });

  it("Scenario 3: 2×L1 + 4×L2 + 2×L3 with skill=1 fits", () => {
    const players = [
      mkPlayer("l1a", 1),
      mkPlayer("l1b", 1),
      ...Array.from({ length: 4 }, (_, i) => mkPlayer(`l2${i}`, 2)),
      mkPlayer("l3a", 3),
      mkPlayer("l3b", 3),
    ];
    const result = run(players, 2, { skillWindow: 1 });
    expect(result.round).toHaveLength(2);
    // Every match should have spread ≤ 1
    for (const m of result.round) {
      const levels = [
        m.team1.player1Id,
        m.team1.player2Id,
        m.team2.player1Id,
        m.team2.player2Id,
      ].map((id) => players.find((p) => p.id === id)!.skillLevel);
      expect(Math.max(...levels) - Math.min(...levels)).toBeLessThanOrEqual(1);
    }
  });
});
