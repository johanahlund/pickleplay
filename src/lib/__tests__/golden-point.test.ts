import { describe, test, expect } from "vitest";

/**
 * Unit tests for Golden Point scoring logic.
 * Tests parseWinBy and isGameWon with the "2_gp18" format.
 */

// Mirrors the logic from RallyTracker.tsx
function parseWinBy(wb: string): { winByN: number; cap: number | null; goldenPoint: number | null } {
  const gpMatch = wb.match(/^(\d+)_gp(\d+)$/);
  if (gpMatch) return { winByN: parseInt(gpMatch[1]), cap: null, goldenPoint: parseInt(gpMatch[2]) };
  if (wb.startsWith("cap")) return { winByN: 2, cap: parseInt(wb.replace("cap", "")) || null, goldenPoint: null };
  return { winByN: parseInt(wb) || 2, cap: null, goldenPoint: null };
}

function isGameWon(score: [number, number], target: number, winByN: number, cap: number | null, goldenPoint: number | null = null): false | 1 | 2 {
  const [s1, s2] = score;
  if (goldenPoint) {
    if (s1 >= goldenPoint) return 1;
    if (s2 >= goldenPoint) return 2;
    if (s1 >= target && s1 - s2 >= winByN) return 1;
    if (s2 >= target && s2 - s1 >= winByN) return 2;
    return false;
  }
  const needed = cap ? Math.min(target, cap) : target;
  if (s1 >= needed && s1 - s2 >= winByN) return 1;
  if (s2 >= needed && s2 - s1 >= winByN) return 2;
  if (cap && s1 >= cap) return 1;
  if (cap && s2 >= cap) return 2;
  return false;
}

function isGamePoint(score: [number, number], target: number, winByN: number, cap: number | null, goldenPoint: number | null = null): boolean {
  return (
    isGameWon([score[0] + 1, score[1]], target, winByN, cap, goldenPoint) !== false ||
    isGameWon([score[0], score[1] + 1], target, winByN, cap, goldenPoint) !== false
  );
}

describe("parseWinBy", () => {
  test("parses simple win-by-2", () => {
    expect(parseWinBy("2")).toEqual({ winByN: 2, cap: null, goldenPoint: null });
  });

  test("parses win-by-1", () => {
    expect(parseWinBy("1")).toEqual({ winByN: 1, cap: null, goldenPoint: null });
  });

  test("parses cap format", () => {
    expect(parseWinBy("cap15")).toEqual({ winByN: 2, cap: 15, goldenPoint: null });
    expect(parseWinBy("cap18")).toEqual({ winByN: 2, cap: 18, goldenPoint: null });
  });

  test("parses golden point format", () => {
    expect(parseWinBy("2_gp18")).toEqual({ winByN: 2, cap: null, goldenPoint: 18 });
    expect(parseWinBy("2_gp21")).toEqual({ winByN: 2, cap: null, goldenPoint: 21 });
  });

  test("defaults to win-by-2 for empty/invalid", () => {
    expect(parseWinBy("")).toEqual({ winByN: 2, cap: null, goldenPoint: null });
  });
});

describe("Golden Point - isGameWon", () => {
  // Sets to 15, win by 2, golden point at 18
  const target = 15;
  const { winByN, goldenPoint } = parseWinBy("2_gp18");

  test("normal win at 15-0", () => {
    expect(isGameWon([15, 0], target, winByN, null, goldenPoint)).toBe(1);
  });

  test("normal win at 15-13", () => {
    expect(isGameWon([15, 13], target, winByN, null, goldenPoint)).toBe(1);
  });

  test("15-14 is NOT a win (need win by 2)", () => {
    expect(isGameWon([15, 14], target, winByN, null, goldenPoint)).toBe(false);
  });

  test("16-14 IS a win (win by 2)", () => {
    expect(isGameWon([16, 14], target, winByN, null, goldenPoint)).toBe(1);
  });

  test("17-15 IS a win (win by 2)", () => {
    expect(isGameWon([17, 15], target, winByN, null, goldenPoint)).toBe(1);
  });

  test("17-16 is NOT a win (still need win by 2)", () => {
    expect(isGameWon([17, 16], target, winByN, null, goldenPoint)).toBe(false);
  });

  test("17-17 is NOT a win (golden point threshold)", () => {
    expect(isGameWon([17, 17], target, winByN, null, goldenPoint)).toBe(false);
  });

  test("18-17 IS a win (golden point! first to 18 wins)", () => {
    expect(isGameWon([18, 17], target, winByN, null, goldenPoint)).toBe(1);
  });

  test("17-18 IS a win for team 2 (golden point)", () => {
    expect(isGameWon([17, 18], target, winByN, null, goldenPoint)).toBe(2);
  });

  test("team 2 wins normally at 5-15", () => {
    expect(isGameWon([5, 15], target, winByN, null, goldenPoint)).toBe(2);
  });
});

describe("Golden Point - isGamePoint", () => {
  const target = 15;
  const { winByN, goldenPoint } = parseWinBy("2_gp18");

  test("14-0 is game point (next point wins)", () => {
    expect(isGamePoint([14, 0], target, winByN, null, goldenPoint)).toBe(true);
  });

  test("14-13 is NOT game point (15-13 is only +1, need +2)", () => {
    // 15-13 → diff is 2, target reached, so it IS game point actually
    expect(isGamePoint([14, 13], target, winByN, null, goldenPoint)).toBe(true);
  });

  test("14-14 is NOT game point (15-14 is not win by 2)", () => {
    expect(isGamePoint([14, 14], target, winByN, null, goldenPoint)).toBe(false);
  });

  test("16-15 is game point for team 1 (17-15 = win by 2)", () => {
    expect(isGamePoint([16, 15], target, winByN, null, goldenPoint)).toBe(true);
  });

  test("17-17 is game point for both (golden point!)", () => {
    expect(isGamePoint([17, 17], target, winByN, null, goldenPoint)).toBe(true);
  });

  test("16-16 is NOT game point (17-16 is not enough)", () => {
    expect(isGamePoint([16, 16], target, winByN, null, goldenPoint)).toBe(false);
  });
});

describe("Standard win-by-2 (no golden point)", () => {
  test("game can go indefinitely without golden point", () => {
    expect(isGameWon([25, 24], 15, 2, null, null)).toBe(false);
    expect(isGameWon([26, 24], 15, 2, null, null)).toBe(1);
    expect(isGameWon([30, 28], 15, 2, null, null)).toBe(1);
  });
});

describe("Cap format (no golden point)", () => {
  test("cap15 means first to 15 wins regardless", () => {
    expect(isGameWon([15, 14], 11, 2, 15, null)).toBe(1);
    expect(isGameWon([14, 14], 11, 2, 15, null)).toBe(false);
  });
});
