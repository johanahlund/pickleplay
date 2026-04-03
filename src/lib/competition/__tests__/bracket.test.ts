import { describe, it, expect } from "vitest";
import {
  determineAdvancement,
  seedBracket,
  generateBracketMatches,
} from "../bracket";
import { GroupStanding, CompetitionPair } from "../types";

function makeStandings(
  groupLabel: string,
  count: number
): GroupStanding[] {
  return Array.from({ length: count }, (_, i) => ({
    pairId: `${groupLabel}${i + 1}`,
    player1Id: `p${groupLabel}${i * 2 + 1}`,
    player2Id: `p${groupLabel}${i * 2 + 2}`,
    groupLabel,
    played: count - 1,
    wins: count - 1 - i,
    losses: i,
    pointsFor: (count - i) * 11,
    pointsAgainst: i * 11 + 5,
    pointDiff: (count - i) * 11 - (i * 11 + 5),
  }));
}

function makePairs(groups: string[], pairsPerGroup: number): CompetitionPair[] {
  const pairs: CompetitionPair[] = [];
  for (const g of groups) {
    for (let i = 0; i < pairsPerGroup; i++) {
      pairs.push({
        id: `${g}${i + 1}`,
        player1Id: `p${g}${i * 2 + 1}`,
        player2Id: `p${g}${i * 2 + 2}`,
        combinedRating: 2000 - i * 100,
        groupLabel: g,
      });
    }
  }
  return pairs;
}

describe("determineAdvancement", () => {
  it("advances top N from each group to upper bracket", () => {
    const standingsA = makeStandings("A", 3);
    const standingsB = makeStandings("B", 3);
    const standingsC = makeStandings("C", 3);
    const pairs = makePairs(["A", "B", "C"], 3);

    const result = determineAdvancement(
      [standingsA, standingsB, standingsC],
      { advanceToUpper: 1, advanceToLower: 0, wildcardCount: 0, wildcardCriteria: "point_diff" },
      pairs
    );

    expect(result.upperBracket.length).toBe(3);
    expect(result.upperBracket.map((u) => u.pairId)).toContain("A1");
    expect(result.upperBracket.map((u) => u.pairId)).toContain("B1");
    expect(result.upperBracket.map((u) => u.pairId)).toContain("C1");
    expect(result.eliminated.length).toBe(6);
  });

  it("advances to lower bracket when configured", () => {
    const standingsA = makeStandings("A", 4);
    const standingsB = makeStandings("B", 4);
    const pairs = makePairs(["A", "B"], 4);

    const result = determineAdvancement(
      [standingsA, standingsB],
      { advanceToUpper: 2, advanceToLower: 1, wildcardCount: 0, wildcardCriteria: "point_diff" },
      pairs
    );

    expect(result.upperBracket.length).toBe(4);
    expect(result.lowerBracket.length).toBe(2);
    expect(result.eliminated.length).toBe(2); // 4th place in each group
  });

  it("adds wildcards based on criteria", () => {
    const standingsA = makeStandings("A", 3);
    const standingsB = makeStandings("B", 3);
    const standingsC = makeStandings("C", 3);
    const pairs = makePairs(["A", "B", "C"], 3);

    const result = determineAdvancement(
      [standingsA, standingsB, standingsC],
      { advanceToUpper: 1, advanceToLower: 0, wildcardCount: 1, wildcardCriteria: "point_diff" },
      pairs
    );

    // 3 group winners + 1 wildcard (best runner-up by point diff)
    expect(result.upperBracket.length).toBe(4);
    expect(result.eliminated.length).toBe(5); // 9 - 4 = 5
  });
});

describe("seedBracket", () => {
  it("creates correct bracket size (power of 2)", () => {
    const advancing = [
      { pairId: "A1", seed: 1, fromGroup: "A" },
      { pairId: "B1", seed: 1, fromGroup: "B" },
      { pairId: "C1", seed: 1, fromGroup: "C" },
    ];

    const slots = seedBracket(advancing, "cross_group", 3);
    expect(slots.length).toBe(4); // rounded up to power of 2
  });

  it("creates 8-slot bracket for 5-8 teams", () => {
    const advancing = Array.from({ length: 6 }, (_, i) => ({
      pairId: `team${i}`,
      seed: i + 1,
      fromGroup: String.fromCharCode(65 + (i % 3)),
    }));

    const slots = seedBracket(advancing, "snake", 3);
    expect(slots.length).toBe(8);

    // 6 slots filled, 2 null (byes)
    const filled = slots.filter((s) => s.pairId !== null);
    expect(filled.length).toBe(6);
  });

  it("places all teams with cross-group seeding", () => {
    const advancing = [
      { pairId: "A1", seed: 1, fromGroup: "A" },
      { pairId: "B1", seed: 1, fromGroup: "B" },
      { pairId: "A2", seed: 2, fromGroup: "A" },
      { pairId: "B2", seed: 2, fromGroup: "B" },
    ];

    const slots = seedBracket(advancing, "cross_group", 2);
    expect(slots.length).toBe(4);

    const pairIds = slots.map((s) => s.pairId).filter(Boolean);
    expect(pairIds.length).toBe(4);
    expect(new Set(pairIds).size).toBe(4); // all unique
  });
});

describe("generateBracketMatches", () => {
  it("generates correct number of matches for 4-team bracket", () => {
    const slots = [
      { pairId: "A1", seed: 1 },
      { pairId: "B2", seed: 4 },
      { pairId: "B1", seed: 2 },
      { pairId: "A2", seed: 3 },
    ];

    const matches = generateBracketMatches(slots, "upper", true);

    // 2 semis + 1 final + 1 third place = 4
    expect(matches.length).toBe(4);

    const semis = matches.filter((m) => m.bracketStage === "upper_sf");
    const finals = matches.filter((m) => m.bracketStage === "upper_f");
    const third = matches.filter((m) => m.bracketStage === "upper_3rd");

    expect(semis.length).toBe(2);
    expect(finals.length).toBe(1);
    expect(third.length).toBe(1);

    // First round (semis) should have known pair IDs
    expect(semis[0].pair1Id).toBe("A1");
    expect(semis[0].pair2Id).toBe("B2");
    expect(semis[1].pair1Id).toBe("B1");
    expect(semis[1].pair2Id).toBe("A2");

    // Final should have null pair IDs (TBD)
    expect(finals[0].pair1Id).toBeNull();
    expect(finals[0].pair2Id).toBeNull();
  });

  it("generates correct structure for 8-team bracket", () => {
    const slots = Array.from({ length: 8 }, (_, i) => ({
      pairId: `team${i + 1}`,
      seed: i + 1,
    }));

    const matches = generateBracketMatches(slots, "upper", false);

    // 4 QF + 2 SF + 1 F = 7 (no 3rd place)
    expect(matches.length).toBe(7);

    const qf = matches.filter((m) => m.bracketStage === "upper_qf");
    const sf = matches.filter((m) => m.bracketStage === "upper_sf");
    const f = matches.filter((m) => m.bracketStage === "upper_f");

    expect(qf.length).toBe(4);
    expect(sf.length).toBe(2);
    expect(f.length).toBe(1);
  });

  it("skips 3rd place match when disabled", () => {
    const slots = [
      { pairId: "A", seed: 1 },
      { pairId: "B", seed: 2 },
      { pairId: "C", seed: 3 },
      { pairId: "D", seed: 4 },
    ];

    const withThird = generateBracketMatches(slots, "upper", true);
    const withoutThird = generateBracketMatches(slots, "upper", false);

    expect(withThird.length).toBe(4); // 2 SF + 1 F + 1 3rd
    expect(withoutThird.length).toBe(3); // 2 SF + 1 F
  });

  it("handles 2-team bracket (just a final)", () => {
    const slots = [
      { pairId: "A1", seed: 1 },
      { pairId: "B1", seed: 2 },
    ];

    const matches = generateBracketMatches(slots, "upper", false);
    expect(matches.length).toBe(1);
    expect(matches[0].bracketStage).toBe("upper_f");
    expect(matches[0].pair1Id).toBe("A1");
    expect(matches[0].pair2Id).toBe("B1");
  });
});
