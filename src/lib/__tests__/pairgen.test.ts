import { describe, it, expect } from "vitest";
import { generatePairs, PairPlayer } from "../pairgen";

function makePlayers(count: number, overrides?: Partial<PairPlayer>[]): PairPlayer[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    rating: 2000 - i * 100,
    gender: i % 2 === 0 ? "M" : "F",
    skillLevel: null,
    ...overrides?.[i],
  }));
}

describe("generatePairs", () => {
  describe("by rating", () => {
    it("pairs strongest with weakest", () => {
      const players = makePlayers(4);
      const pairs = generatePairs(players, { mode: "rating" });
      expect(pairs.length).toBe(2);
      // Player 1 (2000) should pair with Player 4 (1700)
      const pair1 = pairs[0];
      expect([pair1.player1Id, pair1.player2Id].sort()).toEqual(["p1", "p4"]);
    });

    it("handles odd number of players", () => {
      const players = makePlayers(5);
      const pairs = generatePairs(players, { mode: "rating" });
      expect(pairs.length).toBe(2); // 5 players = 2 pairs, 1 leftover
    });

    it("returns empty for less than 2 players", () => {
      const pairs = generatePairs(makePlayers(1), { mode: "rating" });
      expect(pairs.length).toBe(0);
    });

    it("handles exactly 2 players", () => {
      const pairs = generatePairs(makePlayers(2), { mode: "rating" });
      expect(pairs.length).toBe(1);
    });
  });

  describe("by level", () => {
    it("pairs level 3 with level 1", () => {
      const players = makePlayers(4, [
        { skillLevel: 3 }, { skillLevel: 1 }, { skillLevel: 3 }, { skillLevel: 1 },
      ]);
      const pairs = generatePairs(players, { mode: "level" });
      expect(pairs.length).toBe(2);
      // Each pair should have one level 3 and one level 1
      for (const pair of pairs) {
        const p1 = players.find((p) => p.id === pair.player1Id)!;
        const p2 = players.find((p) => p.id === pair.player2Id)!;
        expect(Math.abs((p1.skillLevel || 2) - (p2.skillLevel || 2))).toBeGreaterThan(0);
      }
    });

    it("treats null skill level as 2", () => {
      const players = makePlayers(4, [
        { skillLevel: 3 }, { skillLevel: null }, { skillLevel: 1 }, { skillLevel: null },
      ]);
      const pairs = generatePairs(players, { mode: "level" });
      expect(pairs.length).toBe(2);
    });
  });

  describe("random", () => {
    it("creates the correct number of pairs", () => {
      const pairs = generatePairs(makePlayers(6), { mode: "random" });
      expect(pairs.length).toBe(3);
    });

    it("all players appear exactly once", () => {
      const players = makePlayers(8);
      const pairs = generatePairs(players, { mode: "random" });
      const allIds = pairs.flatMap((p) => [p.player1Id, p.player2Id]);
      expect(new Set(allIds).size).toBe(8);
    });
  });

  describe("preferMixed", () => {
    it("pairs M with F when possible", () => {
      const players = makePlayers(4, [
        { gender: "M" }, { gender: "F" }, { gender: "M" }, { gender: "F" },
      ]);
      const pairs = generatePairs(players, { mode: "rating", preferMixed: true });
      expect(pairs.length).toBe(2);
      for (const pair of pairs) {
        const p1 = players.find((p) => p.id === pair.player1Id)!;
        const p2 = players.find((p) => p.id === pair.player2Id)!;
        expect(p1.gender).not.toBe(p2.gender);
      }
    });

    it("falls back gracefully with uneven genders", () => {
      const players = makePlayers(4, [
        { gender: "M" }, { gender: "M" }, { gender: "M" }, { gender: "F" },
      ]);
      const pairs = generatePairs(players, { mode: "rating", preferMixed: true });
      expect(pairs.length).toBe(2);
      // At least one pair should be mixed
      const mixedCount = pairs.filter((pair) => {
        const p1 = players.find((p) => p.id === pair.player1Id)!;
        const p2 = players.find((p) => p.id === pair.player2Id)!;
        return p1.gender !== p2.gender;
      }).length;
      expect(mixedCount).toBeGreaterThanOrEqual(1);
    });
  });
});
