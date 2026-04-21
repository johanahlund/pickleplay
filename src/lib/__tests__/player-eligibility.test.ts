import { describe, test, expect } from "vitest";

/**
 * Unit tests for player eligibility logic.
 * Players must participate in at least N match days to be eligible for playoffs.
 */

interface GamePlayer { playerId: string }
interface Game { gamePlayers: GamePlayer[] }
interface MatchDay { id: string; games: Game[] }
interface Round { matchDays: MatchDay[] }

function computeEligibility(
  rounds: Round[],
  minMatchDays: number,
): Record<string, { matchDaysPlayed: number; eligible: boolean }> {
  const playerMatchDays: Record<string, Set<string>> = {};

  for (const round of rounds) {
    for (const md of round.matchDays) {
      for (const game of md.games) {
        for (const gp of game.gamePlayers) {
          if (!playerMatchDays[gp.playerId]) playerMatchDays[gp.playerId] = new Set();
          playerMatchDays[gp.playerId].add(md.id);
        }
      }
    }
  }

  const result: Record<string, { matchDaysPlayed: number; eligible: boolean }> = {};
  for (const [playerId, mdSet] of Object.entries(playerMatchDays)) {
    result[playerId] = {
      matchDaysPlayed: mdSet.size,
      eligible: mdSet.size >= minMatchDays,
    };
  }
  return result;
}

describe("Player Eligibility", () => {
  test("player with 0 match days is not eligible (min=2)", () => {
    const result = computeEligibility([], 2);
    // Player not in any game at all
    expect(result["player1"]).toBeUndefined();
  });

  test("player with 1 match day is not eligible (min=2)", () => {
    const rounds: Round[] = [{
      matchDays: [{
        id: "md1",
        games: [{ gamePlayers: [{ playerId: "p1" }, { playerId: "p2" }] }],
      }],
    }];
    const result = computeEligibility(rounds, 2);
    expect(result["p1"].matchDaysPlayed).toBe(1);
    expect(result["p1"].eligible).toBe(false);
  });

  test("player with 2 match days is eligible (min=2)", () => {
    const rounds: Round[] = [
      { matchDays: [{ id: "md1", games: [{ gamePlayers: [{ playerId: "p1" }] }] }] },
      { matchDays: [{ id: "md2", games: [{ gamePlayers: [{ playerId: "p1" }] }] }] },
    ];
    const result = computeEligibility(rounds, 2);
    expect(result["p1"].matchDaysPlayed).toBe(2);
    expect(result["p1"].eligible).toBe(true);
  });

  test("multiple games in same match day count as 1", () => {
    const rounds: Round[] = [{
      matchDays: [{
        id: "md1",
        games: [
          { gamePlayers: [{ playerId: "p1" }, { playerId: "p2" }] },
          { gamePlayers: [{ playerId: "p1" }, { playerId: "p3" }] }, // p1 in two games, same MD
        ],
      }],
    }];
    const result = computeEligibility(rounds, 2);
    expect(result["p1"].matchDaysPlayed).toBe(1); // still just 1 match day
    expect(result["p1"].eligible).toBe(false);
  });

  test("different match days across rounds are counted separately", () => {
    const rounds: Round[] = [
      { matchDays: [
        { id: "md1", games: [{ gamePlayers: [{ playerId: "p1" }] }] },
        { id: "md2", games: [{ gamePlayers: [{ playerId: "p1" }] }] },
      ] },
    ];
    const result = computeEligibility(rounds, 2);
    expect(result["p1"].matchDaysPlayed).toBe(2);
    expect(result["p1"].eligible).toBe(true);
  });

  test("min=0 makes everyone eligible", () => {
    const rounds: Round[] = [{
      matchDays: [{ id: "md1", games: [{ gamePlayers: [{ playerId: "p1" }] }] }],
    }];
    const result = computeEligibility(rounds, 0);
    expect(result["p1"].eligible).toBe(true);
  });

  test("tracks multiple players independently", () => {
    const rounds: Round[] = [
      { matchDays: [{ id: "md1", games: [{ gamePlayers: [{ playerId: "p1" }, { playerId: "p2" }] }] }] },
      { matchDays: [{ id: "md2", games: [{ gamePlayers: [{ playerId: "p1" }] }] }] },
      { matchDays: [{ id: "md3", games: [{ gamePlayers: [{ playerId: "p2" }, { playerId: "p3" }] }] }] },
    ];
    const result = computeEligibility(rounds, 2);
    expect(result["p1"].matchDaysPlayed).toBe(2);
    expect(result["p1"].eligible).toBe(true);
    expect(result["p2"].matchDaysPlayed).toBe(2);
    expect(result["p2"].eligible).toBe(true);
    expect(result["p3"].matchDaysPlayed).toBe(1);
    expect(result["p3"].eligible).toBe(false);
  });
});
