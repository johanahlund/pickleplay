import { describe, it, expect } from "vitest";
import { generateNextMatch, RotationResult } from "../rotation";

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
  it("returns null when not enough players", () => {
    const players = makePlayers(3);
    const result = generateNextMatch(players, baseConfig);
    expect(result).toBeNull();
  });

  it("generates a match with 4 available players (doubles)", () => {
    const players = makePlayers(4);
    const result = generateNextMatch(players, baseConfig);
    expect(result).not.toBeNull();
    expect(result!.team1.length).toBe(2);
    expect(result!.team2.length).toBe(2);
  });

  it("generates a match with 2 available players (singles)", () => {
    const players = makePlayers(2);
    const result = generateNextMatch(players, { ...baseConfig, format: "singles" });
    expect(result).not.toBeNull();
    expect(result!.team1.length).toBe(1);
    expect(result!.team2.length).toBe(1);
  });

  it("excludes players currently on other courts", () => {
    const players = makePlayers(6, [
      { isPlaying: true },
      { isPlaying: true },
    ]);
    const result = generateNextMatch(players, baseConfig);
    expect(result).not.toBeNull();
    expect(result!.team1).not.toContain("p1");
    expect(result!.team1).not.toContain("p2");
    expect(result!.team2).not.toContain("p1");
    expect(result!.team2).not.toContain("p2");
  });

  it("prioritizes players with fewer matches when fairness is on", () => {
    const players = makePlayers(6, [
      { matchesPlayed: 5 },
      { matchesPlayed: 5 },
      { matchesPlayed: 0 },
      { matchesPlayed: 0 },
      { matchesPlayed: 0 },
      { matchesPlayed: 0 },
    ]);
    const result = generateNextMatch(players, baseConfig);
    expect(result).not.toBeNull();
    const allSelected = [...result!.team1, ...result!.team2];
    // Players 3-6 (0 matches) should be picked over players 1-2 (5 matches)
    expect(allSelected).not.toContain("p1");
    expect(allSelected).not.toContain("p2");
  });

  it("includes winners in King of Court mode", () => {
    const players = makePlayers(6, [
      { matchesPlayed: 3 },
      { matchesPlayed: 3 },
      { matchesPlayed: 1 },
      { matchesPlayed: 1 },
      { matchesPlayed: 1 },
      { matchesPlayed: 1 },
    ]);
    const result = generateNextMatch(players, {
      ...baseConfig,
      pairingMode: "king_of_court",
      winners: ["p1", "p2"],
    });
    expect(result).not.toBeNull();
    const allSelected = [...result!.team1, ...result!.team2];
    // Winners get strong bonus even with more matches
    expect(allSelected).toContain("p1");
    expect(allSelected).toContain("p2");
  });

  it("suggests waiting when a playing player has much fewer matches", () => {
    const players = makePlayers(8, [
      { matchesPlayed: 0, isPlaying: true }, // on another court, 0 matches
      { matchesPlayed: 0, isPlaying: true },
      { matchesPlayed: 0, isPlaying: true },
      { matchesPlayed: 0, isPlaying: true },
      { matchesPlayed: 5 }, // available but played a lot
      { matchesPlayed: 5 },
      { matchesPlayed: 5 },
      { matchesPlayed: 5 },
    ]);
    const result = generateNextMatch(players, baseConfig);
    expect(result).not.toBeNull();
    expect(result!.shouldWait).toBe(true);
    expect(result!.waitReason).toContain("Player 1");
  });

  it("does not suggest waiting when speed is sole priority", () => {
    const players = makePlayers(8, [
      { matchesPlayed: 0, isPlaying: true },
      { matchesPlayed: 0, isPlaying: true },
      { matchesPlayed: 0, isPlaying: true },
      { matchesPlayed: 0, isPlaying: true },
      { matchesPlayed: 5 },
      { matchesPlayed: 5 },
      { matchesPlayed: 5 },
      { matchesPlayed: 5 },
    ]);
    const result = generateNextMatch(players, {
      ...baseConfig,
      prioSpeed: true,
      prioFairness: false,
      prioSkill: false,
    });
    expect(result).not.toBeNull();
    expect(result!.shouldWait).toBe(false);
  });

  it("all selected players are unique", () => {
    const players = makePlayers(8);
    const result = generateNextMatch(players, baseConfig);
    expect(result).not.toBeNull();
    const allSelected = [...result!.team1, ...result!.team2];
    expect(new Set(allSelected).size).toBe(4);
  });
});
