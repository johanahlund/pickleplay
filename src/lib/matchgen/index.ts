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
  completedMatches?: CompletedMatch[]
): MatchResult[][] {
  switch (pairingMode) {
    case "random":
      return format === "singles"
        ? randomSingles(players, numCourts)
        : randomDoubles(players, numCourts);

    case "skill_balanced":
      return format === "singles"
        ? skillSingles(players, numCourts)
        : skillDoubles(players, numCourts);

    case "mixed_gender":
      // Mixed gender only makes sense for doubles; fall back to random for singles
      if (format === "singles") return randomSingles(players, numCourts);
      return mixedGenderDoubles(players, numCourts);

    case "skill_mixed_gender":
      if (format === "singles") return skillSingles(players, numCourts);
      return skillMixedGenderDoubles(players, numCourts);

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
        ? randomSingles(players, numCourts)
        : randomDoubles(players, numCourts);
  }
}
