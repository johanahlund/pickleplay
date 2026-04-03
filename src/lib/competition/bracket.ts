/**
 * Bracket generation and management for elimination stages.
 */

import {
  CompetitionConfig,
  GroupStanding,
  getBracketStages,
  CompetitionPair,
} from "./types";

export interface BracketSlot {
  pairId: string | null; // null = TBD (winner of previous match)
  seed: number;
}

export interface BracketMatch {
  bracketStage: string; // "qf", "sf", "f", etc.
  position: number; // 1-based position within stage
  pair1Id: string | null;
  pair2Id: string | null;
  courtNum?: number;
}

/**
 * Determine which pairs advance from group standings.
 *
 * Returns:
 * - upperBracket: pairs advancing to upper bracket
 * - lowerBracket: pairs advancing to lower bracket
 * - eliminated: pairs that are out
 */
export function determineAdvancement(
  allStandings: GroupStanding[][],
  config: Pick<
    CompetitionConfig,
    "advanceToUpper" | "advanceToLower" | "wildcardCount" | "wildcardCriteria"
  >,
  pairs: CompetitionPair[]
): {
  upperBracket: { pairId: string; seed: number; fromGroup: string }[];
  lowerBracket: { pairId: string; seed: number; fromGroup: string }[];
  eliminated: string[];
} {
  const pairMap = new Map(pairs.map((p) => [p.id, p]));
  const upper: { pairId: string; seed: number; fromGroup: string; standing: GroupStanding }[] = [];
  const lower: { pairId: string; seed: number; fromGroup: string }[] = [];
  const eliminated: string[] = [];

  // Collect non-advancing pairs for wildcard consideration
  const wildcardCandidates: GroupStanding[] = [];

  for (const groupStandings of allStandings) {
    for (let i = 0; i < groupStandings.length; i++) {
      const standing = groupStandings[i];
      const rank = i + 1; // 1-based rank within group

      if (rank <= config.advanceToUpper) {
        upper.push({
          pairId: standing.pairId,
          seed: rank,
          fromGroup: standing.groupLabel,
          standing,
        });
      } else if (rank <= config.advanceToUpper + config.advanceToLower) {
        lower.push({
          pairId: standing.pairId,
          seed: rank,
          fromGroup: standing.groupLabel,
        });
      } else {
        // Potential wildcard or eliminated
        wildcardCandidates.push(standing);
        eliminated.push(standing.pairId);
      }
    }
  }

  // Add wildcards to upper bracket
  if (config.wildcardCount > 0 && wildcardCandidates.length > 0) {
    // Sort wildcard candidates by criteria
    const sorted = [...wildcardCandidates].sort((a, b) => {
      switch (config.wildcardCriteria) {
        case "point_diff":
          return b.pointDiff - a.pointDiff;
        case "wins":
          return b.wins - a.wins || b.pointDiff - a.pointDiff;
        case "total_points":
          return b.pointsFor - a.pointsFor;
        default:
          return b.pointDiff - a.pointDiff;
      }
    });

    const wildcards = sorted.slice(0, config.wildcardCount);
    for (const wc of wildcards) {
      upper.push({
        pairId: wc.pairId,
        seed: config.advanceToUpper + 1, // wildcard seed
        fromGroup: wc.groupLabel,
        standing: wc,
      });
      // Remove from eliminated
      const idx = eliminated.indexOf(wc.pairId);
      if (idx !== -1) eliminated.splice(idx, 1);
    }
  }

  // Sort upper bracket by seed (group winners first, then runners-up, then wildcards)
  upper.sort((a, b) => {
    if (a.seed !== b.seed) return a.seed - b.seed;
    return b.standing.pointDiff - a.standing.pointDiff;
  });

  return {
    upperBracket: upper.map((u, i) => ({
      pairId: u.pairId,
      seed: i + 1,
      fromGroup: u.fromGroup,
    })),
    lowerBracket: lower,
    eliminated,
  };
}

/**
 * Seed pairs into a bracket using cross-group seeding.
 *
 * Cross-group: Avoids teams from the same group meeting in the first round.
 * Winner of Group A plays runner-up of Group C (with 3 groups), etc.
 *
 * Snake: Rank all teams by performance and snake-seed into bracket.
 */
export function seedBracket(
  advancing: { pairId: string; seed: number; fromGroup: string }[],
  seeding: CompetitionConfig["bracketSeeding"],
  numGroups: number
): BracketSlot[] {
  const n = advancing.length;
  if (n === 0) return [];

  // Round up to next power of 2 for bracket size
  const bracketSize = Math.pow(2, Math.ceil(Math.log2(n)));
  const slots: BracketSlot[] = Array.from({ length: bracketSize }, (_, i) => ({
    pairId: null,
    seed: i + 1,
  }));

  let ordered: typeof advancing;

  switch (seeding) {
    case "cross_group": {
      // Group winners, then runners-up, etc.
      // Within each tier, rotate the group order to maximize cross-group matches
      const maxRank = Math.max(...advancing.map((a) => a.seed));
      ordered = [];
      for (let rank = 1; rank <= maxRank; rank++) {
        const tier = advancing.filter((a) => a.seed === rank);
        // Sort tier by group label
        tier.sort((a, b) => a.fromGroup.localeCompare(b.fromGroup));
        // Reverse every other tier for cross-group matchups
        if (rank % 2 === 0) tier.reverse();
        ordered.push(...tier);
      }
      break;
    }
    case "snake": {
      // Already sorted by overall performance
      ordered = [...advancing];
      break;
    }
    case "random": {
      ordered = [...advancing].sort(() => Math.random() - 0.5);
      break;
    }
    case "manual": {
      // Keep as-is, organizer will reorder
      ordered = [...advancing];
      break;
    }
    default:
      ordered = [...advancing];
  }

  // Place into bracket with standard seeding pattern
  // For proper bracket seeding: seed 1 vs seed N, seed 2 vs seed N-1, etc.
  // Using the standard bracket placement algorithm
  const positions = getBracketPositions(bracketSize);

  for (let i = 0; i < ordered.length; i++) {
    if (i < positions.length) {
      slots[positions[i]].pairId = ordered[i].pairId;
      slots[positions[i]].seed = i + 1;
    }
  }

  return slots;
}

/**
 * Standard bracket position mapping.
 * Returns array where index = seed-1, value = bracket slot index.
 * Ensures seed 1 is at top, seed 2 at bottom, and they can only meet in the final.
 */
function getBracketPositions(bracketSize: number): number[] {
  if (bracketSize === 1) return [0];
  if (bracketSize === 2) return [0, 1];

  const positions: number[] = [0, 1];

  let currentSize = 2;
  while (currentSize < bracketSize) {
    const newPositions: number[] = [];
    for (const pos of positions) {
      newPositions.push(pos * 2);
      newPositions.push(currentSize * 2 - 1 - pos * 2);
    }
    positions.length = 0;
    positions.push(...newPositions);
    currentSize *= 2;
  }

  return positions;
}

/**
 * Generate bracket matches from seeded slots.
 *
 * Returns matches for the first round (with known pair IDs).
 * Subsequent rounds have null pair IDs (filled as matches complete).
 */
export function generateBracketMatches(
  slots: BracketSlot[],
  prefix: "upper" | "lower",
  thirdPlace: boolean
): BracketMatch[] {
  const n = slots.length;
  if (n < 2) return [];

  const stages = getBracketStages(n);
  const matches: BracketMatch[] = [];

  // First round matches
  const firstStage = stages[0];
  const numFirstRoundMatches = n / 2;

  for (let i = 0; i < numFirstRoundMatches; i++) {
    const slot1 = slots[i * 2];
    const slot2 = slots[i * 2 + 1];

    // If one side is a bye (null), the other auto-advances
    // We still create the match entry so the bracket is complete
    matches.push({
      bracketStage: `${prefix}_${firstStage}`,
      position: i + 1,
      pair1Id: slot1.pairId,
      pair2Id: slot2.pairId,
    });
  }

  // Subsequent round placeholders
  let matchesInPrevRound = numFirstRoundMatches;
  for (let s = 1; s < stages.length; s++) {
    const matchesInThisRound = matchesInPrevRound / 2;
    for (let i = 0; i < matchesInThisRound; i++) {
      matches.push({
        bracketStage: `${prefix}_${stages[s]}`,
        position: i + 1,
        pair1Id: null,
        pair2Id: null,
      });
    }
    matchesInPrevRound = matchesInThisRound;
  }

  // 3rd place match
  if (thirdPlace && stages.length >= 2) {
    matches.push({
      bracketStage: `${prefix}_3rd`,
      position: 1,
      pair1Id: null,
      pair2Id: null,
    });
  }

  return matches;
}
