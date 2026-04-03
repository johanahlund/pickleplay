/**
 * Pair generation for doubles events.
 * Builds teams of 2 that stay together across matches.
 */

export interface PairPlayer {
  id: string;
  name: string;
  rating: number;
  gender?: string | null; // "M" | "F" | null
  skillLevel?: number | null; // 1, 2, 3 (per-event)
}

export interface GeneratedPair {
  player1Id: string;
  player2Id: string;
}

export type PairMode = "rating" | "level" | "random";

interface PairOptions {
  mode: PairMode;
  preferMixed?: boolean; // try to pair M+F
}

/**
 * Generate balanced pairs from a list of players.
 */
export function generatePairs(
  players: PairPlayer[],
  options: PairOptions
): GeneratedPair[] {
  const { mode, preferMixed = false } = options;

  if (players.length < 2) return [];

  if (preferMixed) {
    return generateMixedPairs(players, mode);
  }

  switch (mode) {
    case "rating":
      return pairByRating(players);
    case "level":
      return pairByLevel(players);
    case "random":
      return pairRandom(players);
    default:
      return pairRandom(players);
  }
}

/**
 * Pair by rating: strongest with weakest to equalize pair strength.
 * Sort by rating desc, then pair #1 with #last, #2 with #second-to-last, etc.
 */
function pairByRating(players: PairPlayer[]): GeneratedPair[] {
  const sorted = [...players].sort((a, b) => b.rating - a.rating);
  const pairs: GeneratedPair[] = [];
  let lo = 0;
  let hi = sorted.length - 1;

  while (lo < hi) {
    pairs.push({ player1Id: sorted[lo].id, player2Id: sorted[hi].id });
    lo++;
    hi--;
  }

  return pairs;
}

/**
 * Pair by skill level: avoid pairing two level-1 or two level-3 players.
 * Prefer pairing level 1 with level 2/3, level 3 with level 1/2.
 * Players without a level are treated as level 2.
 */
function pairByLevel(players: PairPlayer[]): GeneratedPair[] {
  const withLevel = players.map((p) => ({
    ...p,
    level: p.skillLevel ?? 2,
  }));

  // Sort: level 3 first, then 2, then 1 (strongest first)
  const sorted = [...withLevel].sort((a, b) => b.level - a.level);
  const pairs: GeneratedPair[] = [];
  const used = new Set<string>();

  // First pass: pair extremes (3 with 1)
  const level3 = sorted.filter((p) => p.level === 3 && !used.has(p.id));
  const level1 = sorted.filter((p) => p.level === 1 && !used.has(p.id));

  const crossPairs = Math.min(level3.length, level1.length);
  for (let i = 0; i < crossPairs; i++) {
    pairs.push({ player1Id: level3[i].id, player2Id: level1[i].id });
    used.add(level3[i].id);
    used.add(level1[i].id);
  }

  // Second pass: remaining players, pair by rating balance
  const remaining = sorted.filter((p) => !used.has(p.id));
  const ratingPairs = pairByRating(remaining);
  pairs.push(...ratingPairs);

  return pairs;
}

/** Random shuffle pairs */
function pairRandom(players: PairPlayer[]): GeneratedPair[] {
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  const pairs: GeneratedPair[] = [];

  for (let i = 0; i + 1 < shuffled.length; i += 2) {
    pairs.push({ player1Id: shuffled[i].id, player2Id: shuffled[i + 1].id });
  }

  return pairs;
}

/**
 * Mixed gender pairing: try to pair M+F, then apply the chosen balance mode
 * to decide which M goes with which F.
 */
function generateMixedPairs(
  players: PairPlayer[],
  mode: PairMode
): GeneratedPair[] {
  const males = players.filter((p) => p.gender === "M");
  const females = players.filter((p) => p.gender === "F");
  const others = players.filter(
    (p) => !p.gender || (p.gender !== "M" && p.gender !== "F")
  );

  const pairs: GeneratedPair[] = [];
  const used = new Set<string>();

  // Sort both groups by the chosen mode's key
  const sortFn =
    mode === "level"
      ? (a: PairPlayer, b: PairPlayer) =>
          (b.skillLevel ?? 2) - (a.skillLevel ?? 2)
      : (a: PairPlayer, b: PairPlayer) => b.rating - a.rating;

  const sortedM = [...males].sort(sortFn);
  const sortedF = [...females].sort(sortFn);

  // Pair strongest M with weakest F (or by level cross) for balance
  let mIdx = 0;
  let fIdx = sortedF.length - 1;

  while (mIdx < sortedM.length && fIdx >= 0) {
    pairs.push({
      player1Id: sortedM[mIdx].id,
      player2Id: sortedF[fIdx].id,
    });
    used.add(sortedM[mIdx].id);
    used.add(sortedF[fIdx].id);
    mIdx++;
    fIdx--;
  }

  // Remaining unpaired players (unmatched M, F, or others)
  const remaining = players.filter((p) => !used.has(p.id));

  if (remaining.length >= 2) {
    // Fall back to the base mode for remaining players
    let remainingPairs: GeneratedPair[];
    switch (mode) {
      case "rating":
        remainingPairs = pairByRating(remaining);
        break;
      case "level":
        remainingPairs = pairByLevel(remaining);
        break;
      default:
        remainingPairs = pairRandom(remaining);
    }
    pairs.push(...remainingPairs);
  }

  return pairs;
}
