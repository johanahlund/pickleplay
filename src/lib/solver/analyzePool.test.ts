import { describe, it, expect } from "vitest";
import { analyzePool } from "./analyzePool";
import type { PairingSettings, SolverPlayer, SkillLevel } from "./types";

function mk(id: string, level: SkillLevel, gender: "M" | "F" | null = null): SolverPlayer {
  return { id, name: id, skillLevel: level, gender, matchCount: 0 };
}

const base: PairingSettings = {
  base: "random",
  teams: "rotating",
  gender: "random",
  skillWindow: Infinity,
  matchCountWindow: 1,
  varietyWindow: 0,
};

describe("analyzePool", () => {
  it("reports basic pool counts", () => {
    const players = [
      mk("a", 2, "M"),
      mk("b", 2, "F"),
      mk("c", 3, "M"),
      mk("d", 3, "F"),
    ];
    const result = analyzePool(players, 1, base);
    expect(result.pool.total).toBe(4);
    expect(result.pool.active).toBe(4);
    expect(result.pool.genderCounts).toEqual({ M: 2, F: 2, unknown: 0 });
    expect(result.pool.skillDistribution[2]).toBe(2);
    expect(result.pool.skillDistribution[3]).toBe(2);
  });

  it("counts paused players separately", () => {
    const players = [
      mk("a", 3),
      mk("b", 3),
      mk("c", 3),
      mk("d", 3),
      { ...mk("e", 3), paused: true },
    ];
    const result = analyzePool(players, 1, base);
    expect(result.pool.active).toBe(4);
    expect(result.pool.paused).toBe(1);
  });

  it("warns on impossible small pool", () => {
    const players = [mk("a", 3), mk("b", 3), mk("c", 3)];
    const result = analyzePool(players, 1, base);
    expect(result.warnings.some((w) => w.includes("at least 4"))).toBe(true);
  });

  it("warns when gender=mixed but count is imbalanced", () => {
    const players = [
      mk("m1", 3, "M"),
      mk("m2", 3, "M"),
      mk("m3", 3, "M"),
      mk("f1", 3, "F"),
    ];
    const result = analyzePool(players, 1, { ...base, gender: "mixed" });
    expect(result.warnings.some((w) => w.includes("Mixed"))).toBe(true);
  });

  it("reports max clean rounds for rich pool with skill=0", () => {
    const players = [
      ...Array.from({ length: 4 }, (_, i) => mk(`lo${i}`, 1)),
      ...Array.from({ length: 4 }, (_, i) => mk(`hi${i}`, 3)),
    ];
    const result = analyzePool(players, 2, { ...base, skillWindow: 0 });
    // Rich pool: the first round is clean (skill 0 satisfied + no variety
    // history). Round 2 MUST have variety repeats because a single round of
    // doubles on 4 players consumes all 6 pair relationships (2 partner + 4
    // opponent) — round 2 is forced into some kind of repeat. Eventually, as
    // variety cost accumulates enough to outweigh skill cost, the solver
    // falls back to cross-level pairings. We only assert the clean-round
    // floor; what happens many rounds later is emergent.
    expect(result.feasibility.maxCleanRounds).toBeGreaterThanOrEqual(1);
  });

  it("catches variety breaking in a small pool", () => {
    // 4 players, 1 court — variety can only give 3 unique partnerings
    // before repeats are forced (each player has 3 possible partners).
    const players = Array.from({ length: 4 }, (_, i) => mk(`p${i}`, 3));
    const result = analyzePool(players, 1, { ...base, varietyWindow: 0 });
    // After 3 rounds, every unique pair has been used; round 4 must repeat.
    expect(result.feasibility.firstViolation.variety).toBeDefined();
  });

  it("capacity respects sit-out for odd counts", () => {
    const players = Array.from({ length: 7 }, (_, i) => mk(`p${i}`, 3));
    const result = analyzePool(players, 2, base);
    expect(result.capacity.playersPerRound).toBe(4); // only 1 court fillable
    expect(result.capacity.sitOutPerRound).toBe(3);
  });

  it("varietyCeiling is n-1", () => {
    const players = Array.from({ length: 8 }, (_, i) => mk(`p${i}`, 3));
    const result = analyzePool(players, 2, base);
    expect(result.varietyCeiling).toBe(7);
  });
});
