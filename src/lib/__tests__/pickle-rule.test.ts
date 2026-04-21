import { describe, test, expect } from "vitest";

/**
 * Unit tests for pickle detection logic.
 * A "pickle" is when a completed match has one team scoring 0.
 */

interface MatchPlayer {
  playerId: string;
  team: number;
  score: number;
  player: { name: string };
}

interface Match {
  id: string;
  status: string;
  players: MatchPlayer[];
}

function isPickle(match: Match): boolean {
  if (match.status !== "completed") return false;
  const team1 = match.players.filter((p) => p.team === 1);
  const team2 = match.players.filter((p) => p.team === 2);
  const s1 = team1[0]?.score ?? -1;
  const s2 = team2[0]?.score ?? -1;
  return (s1 === 0 || s2 === 0) && (s1 + s2 > 0);
}

function getPickleWinnerTeam(match: Match): 1 | 2 | null {
  if (!isPickle(match)) return null;
  const s1 = match.players.filter((p) => p.team === 1)[0]?.score ?? 0;
  return s1 === 0 ? 2 : 1;
}

function makeMatch(id: string, status: string, t1Score: number, t2Score: number): Match {
  return {
    id,
    status,
    players: [
      { playerId: "p1", team: 1, score: t1Score, player: { name: "Alice" } },
      { playerId: "p2", team: 1, score: t1Score, player: { name: "Bob" } },
      { playerId: "p3", team: 2, score: t2Score, player: { name: "Charlie" } },
      { playerId: "p4", team: 2, score: t2Score, player: { name: "Diana" } },
    ],
  };
}

describe("Pickle Detection", () => {
  test("15-0 is a pickle", () => {
    expect(isPickle(makeMatch("1", "completed", 15, 0))).toBe(true);
  });

  test("0-15 is a pickle", () => {
    expect(isPickle(makeMatch("2", "completed", 0, 15))).toBe(true);
  });

  test("11-0 is a pickle", () => {
    expect(isPickle(makeMatch("3", "completed", 11, 0))).toBe(true);
  });

  test("15-5 is NOT a pickle", () => {
    expect(isPickle(makeMatch("4", "completed", 15, 5))).toBe(false);
  });

  test("0-0 is NOT a pickle (no actual game played)", () => {
    expect(isPickle(makeMatch("5", "completed", 0, 0))).toBe(false);
  });

  test("pending match is NOT a pickle even if score is 0", () => {
    expect(isPickle(makeMatch("6", "pending", 15, 0))).toBe(false);
  });

  test("active match is NOT a pickle", () => {
    expect(isPickle(makeMatch("7", "active", 11, 0))).toBe(false);
  });
});

describe("Pickle Winner Detection", () => {
  test("team 1 wins when team 2 scores 0", () => {
    expect(getPickleWinnerTeam(makeMatch("1", "completed", 15, 0))).toBe(1);
  });

  test("team 2 wins when team 1 scores 0", () => {
    expect(getPickleWinnerTeam(makeMatch("2", "completed", 0, 15))).toBe(2);
  });

  test("returns null for non-pickle matches", () => {
    expect(getPickleWinnerTeam(makeMatch("3", "completed", 15, 5))).toBe(null);
  });

  test("returns null for pending matches", () => {
    expect(getPickleWinnerTeam(makeMatch("4", "pending", 15, 0))).toBe(null);
  });
});

describe("Pickle Summary", () => {
  test("finds all pickles in a list of matches", () => {
    const matches: Match[] = [
      makeMatch("1", "completed", 15, 0),  // pickle
      makeMatch("2", "completed", 11, 5),  // not pickle
      makeMatch("3", "completed", 0, 11),  // pickle
      makeMatch("4", "active", 8, 0),      // not completed
      makeMatch("5", "completed", 15, 13), // not pickle
    ];
    const pickles = matches.filter(isPickle);
    expect(pickles).toHaveLength(2);
    expect(pickles[0].id).toBe("1");
    expect(pickles[1].id).toBe("3");
  });
});
