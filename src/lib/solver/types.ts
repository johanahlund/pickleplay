/**
 * Pairing solver — types and interfaces.
 *
 * This is the unified replacement for the legacy pairgen.ts and matchgen/
 * algorithms. Instead of 7 hardcoded pairing modes, there is ONE scoring
 * function that evaluates candidate arrangements against 6 configurable
 * settings. See project_pairing_modes.md memory note for the full model.
 *
 * V1 scope: Random base mode + Rotating teams + doubles.
 */

export type SkillLevel = 1 | 2 | 3 | 4 | 5;

/** A player in the context of the solver. Lives per-event. */
export interface SolverPlayer {
  id: string;
  name: string;
  /** L1-L5 bucket. Assigned from DUPR/rating with admin override. */
  skillLevel: SkillLevel;
  /** "M" | "F" | null (not specified) */
  gender: "M" | "F" | null;
  /** Total matches played in this event so far. Frozen while paused. */
  matchCount: number;
  /** If true, excluded from the active pool for next round. */
  paused?: boolean;
}

// ── Settings ───────────────────────────────────────────────────────────────

export type BaseMode = "random" | "swiss" | "king" | "manual";
export type TeamsMode = "fixed" | "rotating";
export type GenderRule = "mixed" | "random" | "same";

/**
 * All the "tolerance window" settings use the same shape: a max distance
 * from a target, with `Infinity` meaning "don't care".
 */
export type SkillWindow = 0 | 1 | 2 | number; // use Infinity for "any"
export type MatchCountWindow = 0 | 1 | 2 | number;
export type VarietyWindow = 0 | 1 | number;

export interface PairingSettings {
  base: BaseMode;
  teams: TeamsMode;
  gender: GenderRule;
  /** Max skill gap allowed across the 4 players in a match. */
  skillWindow: SkillWindow;
  /** Max distance from the average match count a player is allowed to be. */
  matchCountWindow: MatchCountWindow;
  /** Max number of repeats per partner-pair (or opponent-pair) across rounds. */
  varietyWindow: VarietyWindow;
}

/** Two players who MUST partner together (e.g., tournament practice). */
export interface PairLock {
  playerAId: string;
  playerBId: string;
}

// ── History ────────────────────────────────────────────────────────────────

export interface MatchHistoryEntry {
  round: number;
  courtNum: number;
  team1Ids: [string, string];
  team2Ids: [string, string];
}

// ── Output shapes ──────────────────────────────────────────────────────────

export interface Team {
  player1Id: string;
  player2Id: string;
}

export interface Match {
  court: number;
  team1: Team;
  team2: Team;
}

export type Round = Match[];

export interface SolverInput {
  players: SolverPlayer[];
  numCourts: number;
  settings: PairingSettings;
  history: MatchHistoryEntry[];
  locks: PairLock[];
}

export type ViolationType = "matchCount" | "skill" | "gender" | "variety";

export interface Violation {
  type: ViolationType;
  cost: number;
  details: string;
}

export interface SolverResult {
  round: Round;
  cost: number;
  violations: Violation[];
  /** Player IDs who sit out this round. */
  sittingOut: string[];
}

// ── Scoring weights ────────────────────────────────────────────────────────

/**
 * Per-step weight for each kind of violation. These are the numeric
 * priorities that enforce the "match count > gender/skill > variety" ladder
 * discussed in the design conversation. Tuned so a single step outside the
 * match count window outweighs any combination of other violations.
 */
export const WEIGHTS = {
  /** Per step beyond the match count window. Huge — effectively hard. */
  matchCount: 10_000,
  /** Per step beyond the skill window. */
  skill: 100,
  /** Per non-compliant team when gender = "mixed" or "same" (require). */
  genderRequire: 1_000,
  /** Per non-compliant team when gender = "prefer" (currently unused — we only have require/random). */
  genderPrefer: 100,
  /** Per repeat partner-pair or opponent-pair beyond the variety window. */
  variety: 30,
} as const;
