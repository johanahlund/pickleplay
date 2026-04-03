import { describe, it, expect } from "vitest";
import {
  seedPairsIntoGroups,
  generateGroupMatchups,
  calculateGroupStandings,
} from "../groups";
import { CompetitionPair } from "../types";

function makePairs(count: number): CompetitionPair[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `pair${i + 1}`,
    player1Id: `p${i * 2 + 1}`,
    player2Id: `p${i * 2 + 2}`,
    combinedRating: 2000 - i * 100, // pair1=2000, pair2=1900, etc.
  }));
}

describe("seedPairsIntoGroups", () => {
  it("distributes 9 pairs evenly across 3 groups", () => {
    const pairs = makePairs(9);
    const result = seedPairsIntoGroups(pairs, {
      numGroups: 3,
      groupSeeding: "rating",
    });

    expect(result.length).toBe(9);

    const groupA = result.filter((p) => p.groupLabel === "A");
    const groupB = result.filter((p) => p.groupLabel === "B");
    const groupC = result.filter((p) => p.groupLabel === "C");

    expect(groupA.length).toBe(3);
    expect(groupB.length).toBe(3);
    expect(groupC.length).toBe(3);
  });

  it("uses pot seeding — top pair in each group is strongest", () => {
    const pairs = makePairs(6);
    const result = seedPairsIntoGroups(pairs, {
      numGroups: 2,
      groupSeeding: "rating",
    });

    const groupA = result.filter((p) => p.groupLabel === "A");
    const groupB = result.filter((p) => p.groupLabel === "B");

    // Pot 1 (pairs 1-2): A gets pair1 (2000), B gets pair2 (1900)
    // Pot 2 (pairs 3-4): snake — B gets pair3 (1800), A gets pair4 (1700)
    // Pot 3 (pairs 5-6): A gets pair5 (1600), B gets pair6 (1500)
    expect(groupA.map((p) => p.id)).toContain("pair1");
    expect(groupB.map((p) => p.id)).toContain("pair2");
  });

  it("handles uneven distribution (10 pairs, 3 groups → 4,3,3)", () => {
    const pairs = makePairs(10);
    const result = seedPairsIntoGroups(pairs, {
      numGroups: 3,
      groupSeeding: "rating",
    });

    const groups = new Map<string, number>();
    for (const p of result) {
      groups.set(p.groupLabel!, (groups.get(p.groupLabel!) || 0) + 1);
    }

    // Each group should have 3 or 4 pairs
    for (const count of groups.values()) {
      expect(count).toBeGreaterThanOrEqual(3);
      expect(count).toBeLessThanOrEqual(4);
    }
  });

  it("assigns every pair a unique seed", () => {
    const pairs = makePairs(9);
    const result = seedPairsIntoGroups(pairs, {
      numGroups: 3,
      groupSeeding: "rating",
    });

    const seeds = result.map((p) => p.seed);
    const uniqueSeeds = new Set(seeds);
    expect(uniqueSeeds.size).toBe(9);
  });

  it("random seeding still distributes evenly", () => {
    const pairs = makePairs(8);
    const result = seedPairsIntoGroups(pairs, {
      numGroups: 2,
      groupSeeding: "random",
    });

    const groupA = result.filter((p) => p.groupLabel === "A");
    const groupB = result.filter((p) => p.groupLabel === "B");
    expect(groupA.length).toBe(4);
    expect(groupB.length).toBe(4);
  });
});

describe("generateGroupMatchups", () => {
  it("generates correct number of matchups for 3 pairs (round-robin)", () => {
    const pairs = makePairs(3).map((p, i) => ({ ...p, groupLabel: "A" }));
    const matchups = generateGroupMatchups(pairs, 1);

    // 3 pairs, round-robin = 3 matchups (AB, AC, BC)
    expect(matchups.length).toBe(3);
  });

  it("generates correct number for 4 pairs (round-robin)", () => {
    const pairs = makePairs(4).map((p) => ({ ...p, groupLabel: "A" }));
    const matchups = generateGroupMatchups(pairs, 1);

    // 4 pairs = 6 matchups (4 choose 2)
    expect(matchups.length).toBe(6);
  });

  it("generates double the matchups with matchesPerMatchup=2", () => {
    const pairs = makePairs(3).map((p) => ({ ...p, groupLabel: "A" }));
    const matchups1 = generateGroupMatchups(pairs, 1);
    const matchups2 = generateGroupMatchups(pairs, 2);

    expect(matchups2.length).toBe(matchups1.length * 2);
  });

  it("every pair plays every other pair exactly once", () => {
    const pairs = makePairs(4).map((p) => ({ ...p, groupLabel: "A" }));
    const matchups = generateGroupMatchups(pairs, 1);

    // Check that every pair of teams appears exactly once
    const seen = new Set<string>();
    for (const m of matchups) {
      const key = [m.pair1Id, m.pair2Id].sort().join(":");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }

    // Check all combinations present
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        const key = [pairs[i].id, pairs[j].id].sort().join(":");
        expect(seen.has(key)).toBe(true);
      }
    }
  });

  it("assigns round numbers", () => {
    const pairs = makePairs(4).map((p) => ({ ...p, groupLabel: "A" }));
    const matchups = generateGroupMatchups(pairs, 1);

    // 4 teams round-robin = 3 rounds, 2 matches per round
    const rounds = new Set(matchups.map((m) => m.round));
    expect(rounds.size).toBe(3);
  });

  it("handles 5 pairs with bye (odd number)", () => {
    const pairs = makePairs(5).map((p) => ({ ...p, groupLabel: "A" }));
    const matchups = generateGroupMatchups(pairs, 1);

    // 5 pairs = 10 matchups (5 choose 2)
    expect(matchups.length).toBe(10);

    // Every pair should appear in 4 matchups
    const counts = new Map<string, number>();
    for (const m of matchups) {
      counts.set(m.pair1Id, (counts.get(m.pair1Id) || 0) + 1);
      counts.set(m.pair2Id, (counts.get(m.pair2Id) || 0) + 1);
    }
    for (const pair of pairs) {
      expect(counts.get(pair.id)).toBe(4);
    }
  });
});

describe("calculateGroupStandings", () => {
  it("calculates wins and losses correctly", () => {
    const pairs: CompetitionPair[] = [
      { id: "p1", player1Id: "a", player2Id: "b", combinedRating: 2000, groupLabel: "A" },
      { id: "p2", player1Id: "c", player2Id: "d", combinedRating: 1800, groupLabel: "A" },
      { id: "p3", player1Id: "e", player2Id: "f", combinedRating: 1600, groupLabel: "A" },
    ];

    const matches = [
      {
        id: "m1", status: "completed", groupLabel: "A",
        players: [
          { playerId: "a", team: 1, score: 11 },
          { playerId: "b", team: 1, score: 0 },
          { playerId: "c", team: 2, score: 5 },
          { playerId: "d", team: 2, score: 0 },
        ],
      },
      {
        id: "m2", status: "completed", groupLabel: "A",
        players: [
          { playerId: "a", team: 1, score: 11 },
          { playerId: "b", team: 1, score: 0 },
          { playerId: "e", team: 2, score: 7 },
          { playerId: "f", team: 2, score: 0 },
        ],
      },
      {
        id: "m3", status: "completed", groupLabel: "A",
        players: [
          { playerId: "c", team: 1, score: 11 },
          { playerId: "d", team: 1, score: 0 },
          { playerId: "e", team: 2, score: 9 },
          { playerId: "f", team: 2, score: 0 },
        ],
      },
    ];

    const standings = calculateGroupStandings(
      pairs, matches, "A",
      ["head_to_head", "point_diff", "total_points"]
    );

    expect(standings.length).toBe(3);
    expect(standings[0].pairId).toBe("p1"); // 2 wins
    expect(standings[0].wins).toBe(2);
    expect(standings[0].losses).toBe(0);

    expect(standings[1].pairId).toBe("p2"); // 1 win
    expect(standings[1].wins).toBe(1);
    expect(standings[1].losses).toBe(1);

    expect(standings[2].pairId).toBe("p3"); // 0 wins
    expect(standings[2].wins).toBe(0);
    expect(standings[2].losses).toBe(2);
  });

  it("uses point diff as tiebreaker when wins are equal", () => {
    const pairs: CompetitionPair[] = [
      { id: "p1", player1Id: "a", player2Id: "b", combinedRating: 2000, groupLabel: "A" },
      { id: "p2", player1Id: "c", player2Id: "d", combinedRating: 1800, groupLabel: "A" },
      { id: "p3", player1Id: "e", player2Id: "f", combinedRating: 1600, groupLabel: "A" },
    ];

    // Circular wins: p1 beats p2, p2 beats p3, p3 beats p1
    const matches = [
      {
        id: "m1", status: "completed", groupLabel: "A",
        players: [
          { playerId: "a", team: 1, score: 11 },
          { playerId: "b", team: 1, score: 0 },
          { playerId: "c", team: 2, score: 3 },
          { playerId: "d", team: 2, score: 0 },
        ],
      },
      {
        id: "m2", status: "completed", groupLabel: "A",
        players: [
          { playerId: "c", team: 1, score: 11 },
          { playerId: "d", team: 1, score: 0 },
          { playerId: "e", team: 2, score: 5 },
          { playerId: "f", team: 2, score: 0 },
        ],
      },
      {
        id: "m3", status: "completed", groupLabel: "A",
        players: [
          { playerId: "e", team: 1, score: 11 },
          { playerId: "f", team: 1, score: 0 },
          { playerId: "a", team: 2, score: 9 },
          { playerId: "b", team: 2, score: 0 },
        ],
      },
    ];

    const standings = calculateGroupStandings(
      pairs, matches, "A",
      ["head_to_head", "point_diff", "total_points"]
    );

    // All have 1 win, 1 loss
    expect(standings[0].wins).toBe(1);
    expect(standings[1].wins).toBe(1);
    expect(standings[2].wins).toBe(1);

    // Point diffs: p1: 11-3 + 9-11 = 6, p2: 3-11 + 11-5 = -2, p3: 5-11 + 11-9 = -4
    // Wait, let me recalculate:
    // p1: scored 11+9=20, conceded 3+11=14, diff=+6
    // p2: scored 3+11=14, conceded 11+5=16, diff=-2
    // p3: scored 5+11=16, conceded 11+9=20, diff=-4
    expect(standings[0].pairId).toBe("p1"); // best point diff +6
    expect(standings[0].pointDiff).toBe(6);
  });

  it("ignores pending matches", () => {
    const pairs: CompetitionPair[] = [
      { id: "p1", player1Id: "a", player2Id: "b", combinedRating: 2000, groupLabel: "A" },
      { id: "p2", player1Id: "c", player2Id: "d", combinedRating: 1800, groupLabel: "A" },
    ];

    const matches = [
      {
        id: "m1", status: "pending", groupLabel: "A",
        players: [
          { playerId: "a", team: 1, score: 0 },
          { playerId: "b", team: 1, score: 0 },
          { playerId: "c", team: 2, score: 0 },
          { playerId: "d", team: 2, score: 0 },
        ],
      },
    ];

    const standings = calculateGroupStandings(
      pairs, matches, "A",
      ["head_to_head", "point_diff", "total_points"]
    );

    expect(standings[0].played).toBe(0);
    expect(standings[1].played).toBe(0);
  });
});
