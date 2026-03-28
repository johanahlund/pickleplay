import { PlayerInfo, MatchResult, PairingMode, CompletedMatch } from "./types";
import {
  randomSingles,
  randomDoubles,
  skillSingles,
  skillDoubles,
  mixedGenderDoubles,
  skillMixedGenderDoubles,
  kingOfCourtRound,
  swissRound,
} from "./algorithms";

export type { PlayerInfo, MatchResult, PairingMode, CompletedMatch };

/**
 * Generate match rounds based on pairing mode.
 *
 * For most modes: returns multiple rounds (delete-and-regenerate pattern).
 * For king_of_court and swiss: returns a single round (incremental generation).
 */
export function generateRounds(
  players: PlayerInfo[],
  numCourts: number,
  format: "singles" | "doubles",
  pairingMode: PairingMode,
  completedMatches?: CompletedMatch[],
  numRounds?: number
): MatchResult[][] {
  const genBatch = (genFn: (p: PlayerInfo[], c: number) => MatchResult[][]) => {
    const all = genFn(players, numCourts);
    return numRounds ? all.slice(0, numRounds) : all;
  };

  switch (pairingMode) {
    case "random":
      return format === "singles"
        ? genBatch(randomSingles)
        : genBatch(randomDoubles);

    case "skill_balanced":
      return format === "singles"
        ? genBatch(skillSingles)
        : genBatch(skillDoubles);

    case "mixed_gender":
      if (format === "singles") return genBatch(randomSingles);
      return genBatch(mixedGenderDoubles);

    case "skill_mixed_gender":
      if (format === "singles") return genBatch(skillSingles);
      return genBatch(skillMixedGenderDoubles);

    case "king_of_court": {
      const round = kingOfCourtRound(players, numCourts, format, completedMatches || []);
      return round.length > 0 ? [round] : [];
    }

    case "swiss": {
      const round = swissRound(players, numCourts, format, completedMatches || []);
      return round.length > 0 ? [round] : [];
    }

    default:
      return format === "singles"
        ? genBatch(randomSingles)
        : genBatch(randomDoubles);
  }
}
