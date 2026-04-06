import { describe, it, expect } from "vitest";
import { generateNextMatch } from "../rotation";

function makePlayers(count: number, overrides?: Partial<{ matchesPlayed: number; isPlaying: boolean; lastMatchEndedAt: number; skillLevel: number; gender: string }>[]) {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    rating: 1000 + i * 50,
    gender: i % 2 === 0 ? "M" : "F",
    skillLevel: null as number | null,
    matchesPlayed: 0,
    lastMatchEndedAt: 0,
    isPlaying: false,
    ...overrides?.[i],
  }));
}

const baseConfig = {
  format: "doubles" as const,
  pairingMode: "random",
  prioSpeed: true,
  prioFairness: true,
  prioSkill: false,
  courtNum: 1,
  numCourts: 2,
};

describe("generateNextMatch", () => {
  it("hard stop when not enough players", () => {
    const players = makePlayers(3);
    const result = generateNextMatch(players, baseConfig);
    expect(result).not.toBeNull();
    expect(result!.isHardStop).toBe(true);
    expect(result!.shouldWait).toBe(true);
    expect(result!.waitReason).toContain("3 players available");
  });

  it("hard stop when all playing", () => {
    const players = makePlayers(4, [
      { isPlaying: true }, { isPlaying: true }, { isPlaying: true }, { isPlaying: true },
    ]);
    const result = generateNextMatch(players, baseConfig);
    expect(result).not.toBeNull();
    expect(result!.isHardStop).toBe(true);
    expect(result!.waitReason).toContain("All 4 players are on court");
  });

  it("generates match with 4 available players", () => {
    const players = makePlayers(4);
    const result = generateNextMatch(players, baseConfig);
    expect(result).not.toBeNull();
    expect(result!.team1.length).toBe(2);
    expect(result!.team2.length).toBe(2);
    expect(result!.isHardStop).toBe(false);
    expect(result!.shouldWait).toBe(false);
  });

  it("generates singles match with 2 players", () => {
    const players = makePlayers(2);
    const result = generateNextMatch(players, { ...baseConfig, format: "singles" });
    expect(result).not.toBeNull();
    expect(result!.team1.length).toBe(1);
    expect(result!.team2.length).toBe(1);
  });

  it("excludes playing players", () => {
    const players = makePlayers(6, [{ isPlaying: true }, { isPlaying: true }]);
    const result = generateNextMatch(players, baseConfig);
    expect(result).not.toBeNull();
    expect(result!.team1).not.toContain("p1");
    expect(result!.team2).not.toContain("p1");
  });

  it("prioritizes players with fewer matches", () => {
    const players = makePlayers(6, [
      { matchesPlayed: 5 }, { matchesPlayed: 5 },
      { matchesPlayed: 0 }, { matchesPlayed: 0 },
      { matchesPlayed: 0 }, { matchesPlayed: 0 },
    ]);
    const result = generateNextMatch(players, baseConfig);
    expect(result).not.toBeNull();
    const all = [...result!.team1, ...result!.team2];
    expect(all).not.toContain("p1");
    expect(all).not.toContain("p2");
  });

  it("suggests waiting with reason and better matchup", () => {
    const players = makePlayers(8, [
      { matchesPlayed: 0, isPlaying: true },
      { matchesPlayed: 0, isPlaying: true },
      { matchesPlayed: 0, isPlaying: true },
      { matchesPlayed: 0, isPlaying: true },
      { matchesPlayed: 5 }, { matchesPlayed: 5 },
      { matchesPlayed: 5 }, { matchesPlayed: 5 },
    ]);
    const result = generateNextMatch(players, baseConfig);
    expect(result).not.toBeNull();
    expect(result!.shouldWait).toBe(true);
    expect(result!.isHardStop).toBe(false);
    expect(result!.waitReason).toContain("Player 1");
    expect(result!.betterMatchup).toBeDefined();
    expect(result!.betterMatchup!.team1Names.length).toBeGreaterThan(0);
    expect(result!.betterMatchup!.reason).toContain("Player 1");
  });

  it("does not suggest waiting when speed only", () => {
    const players = makePlayers(8, [
      { matchesPlayed: 0, isPlaying: true },
      { matchesPlayed: 0, isPlaying: true },
      { matchesPlayed: 0, isPlaying: true },
      { matchesPlayed: 0, isPlaying: true },
      { matchesPlayed: 5 }, { matchesPlayed: 5 },
      { matchesPlayed: 5 }, { matchesPlayed: 5 },
    ]);
    const result = generateNextMatch(players, {
      ...baseConfig, prioSpeed: true, prioFairness: false, prioSkill: false,
    });
    expect(result!.shouldWait).toBe(false);
  });

  it("includes player names in result", () => {
    const players = makePlayers(4);
    const result = generateNextMatch(players, baseConfig);
    expect(result!.team1Names.length).toBe(2);
    expect(result!.team2Names.length).toBe(2);
    expect(result!.team1Names[0]).toContain("Player");
  });

  it("all selected players are unique", () => {
    const players = makePlayers(8);
    const result = generateNextMatch(players, baseConfig);
    const all = [...result!.team1, ...result!.team2];
    expect(new Set(all).size).toBe(4);
  });
});
