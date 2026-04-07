/**
 * Competition configuration stored as JSON on Event.competitionConfig
 */
export interface CompetitionConfig {
  // Group stage
  numGroups: number; // 2, 3, 4
  matchesPerMatchup: number; // 1 or 2 (how many times each pair plays each other in group)
  groupSeeding: "rating" | "dupr" | "skill_level" | "random";

  // Advancement
  advanceToUpper: number; // how many from each group go to upper bracket
  advanceToLower: number; // how many from each group go to lower bracket (0 = no lower bracket)
  wildcardCount: number; // extra teams advancing to upper bracket based on criteria
  wildcardCriteria: "point_diff" | "wins" | "total_points";

  // Tiebreaker order (for group standings)
  tiebreakers: ("head_to_head" | "point_diff" | "total_points")[];

  // Bracket seeding
  bracketSeeding: "cross_group" | "snake" | "random" | "manual";

  // Upper bracket
  upperBracketFormats: Record<string, string>; // e.g. { "qf": "to_11", "sf": "bo3_11", "f": "bo3_15" }
  upperThirdPlace: boolean;

  // Lower bracket (only if advanceToLower > 0)
  lowerBracketFormats: Record<string, string>;
  lowerThirdPlace: boolean;

  // Court assignment
  groupCourts: Record<string, number[]>; // e.g. { "A": [1, 2], "B": [3, 4] }
  bracketCourts: Record<string, number[]>; // e.g. { "upper": [1, 2], "lower": [3] }
}

export const DEFAULT_COMPETITION_CONFIG: CompetitionConfig = {
  numGroups: 3,
  matchesPerMatchup: 1,
  groupSeeding: "rating",
  advanceToUpper: 1,
  advanceToLower: 0,
  wildcardCount: 0,
  wildcardCriteria: "point_diff",
  tiebreakers: ["head_to_head", "point_diff", "total_points"],
  bracketSeeding: "cross_group",
  upperBracketFormats: {},
  upperThirdPlace: true,
  lowerBracketFormats: {},
  lowerThirdPlace: false,
  groupCourts: {},
  bracketCourts: {},
};

/**
 * Match format options
 */
export const MATCH_FORMATS = [
  { value: "to_11", label: "To 11" },
  { value: "to_15", label: "To 15" },
  { value: "to_21", label: "To 21" },
  { value: "bo3_11", label: "Best of 3 to 11" },
  { value: "bo3_15", label: "Best of 3 to 15" },
  { value: "bo3_21", label: "Best of 3 to 21" },
] as const;

/**
 * Bracket stage labels in order
 */
export function getBracketStages(numTeams: number): string[] {
  if (numTeams <= 1) return [];
  if (numTeams === 2) return ["f"];
  if (numTeams <= 4) return ["sf", "f"];
  if (numTeams <= 8) return ["qf", "sf", "f"];
  if (numTeams <= 16) return ["r16", "qf", "sf", "f"];
  return ["r32", "r16", "qf", "sf", "f"];
}

export const BRACKET_STAGE_LABELS: Record<string, string> = {
  r32: "Round of 32",
  r16: "Round of 16",
  qf: "Quarterfinals",
  sf: "Semifinals",
  f: "Final",
};

export const BRACKET_STAGE_SHORT: Record<string, string> = {
  r32: "32",
  r16: "16",
  qf: "Quarter",
  sf: "Semi",
  f: "Final",
};

/**
 * Group standing entry
 */
export interface GroupStanding {
  pairId: string;
  player1Id: string;
  player2Id: string;
  groupLabel: string;
  played: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
}

/**
 * Pair info for algorithms
 */
export interface CompetitionPair {
  id: string;
  player1Id: string;
  player2Id: string;
  combinedRating: number;
  groupLabel?: string | null;
  seed?: number | null;
}
