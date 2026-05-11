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
  /**
   * How many rounds since this player last played. 0 = just played or
   * playing now. Caller computes this from history (currentRound -
   * lastPlayedRound). Used by the maxWaitWindow fairness setting to keep
   * bench-stuck players from being forgotten.
   */
  roundsSinceLastPlayed?: number;
  /**
   * Did this player lose their most recent completed match? Used as a
   * tiebreak by the King solver when picking who sits out: among players
   * tied on effective match count, losers go to bench before winners, and
   * a losing pair is preferred over individual losers. Undefined for
   * players who haven't played yet (round 1) or who only have history of
   * cancelled/incomplete matches.
   */
  lostLastRound?: boolean;
  /**
   * The other player on the same team in the most recent completed match,
   * IF that team lost. Used by the King solver to recognise "losing
   * pairs" — when two tied players were teammates AND both lost, the
   * solver prefers to bench them together rather than splitting.
   */
  lastRoundLosingPartnerId?: string;
  /**
   * Court number of the player's most recent completed match. Used by
   * the King solver for the round-2 tiebreak ("send losers from the
   * lowest court first") when everyone is tied at matchCount = 1.
   */
  lastRoundCourt?: number;
  /** If true, excluded from the active pool for next round. */
  paused?: boolean;
}

// ── Settings ───────────────────────────────────────────────────────────────

/**
 * The four user-facing modes. Each is an atomic preset (the solver picks
 * the right algorithm + window defaults). Setup → user chooses base.
 * Mid-event → user can pick `activeMode` to run a different mode for
 * upcoming rounds without losing the configured base.
 *
 * - random: total variety, no skill care. Fairness ejection. Round or continuous.
 * - king:   winners climb / losers fall by court tier + fairness ejection. Round-based.
 * - skill:  same-level court + balanced teams + fairness. Round or continuous.
 * - manual: organizer composes; auto-generation off.
 *
 * `swiss` is retained for older events that already chose it, but isn't
 * exposed in the new UI. New events should pick from random/king/skill/manual.
 */
export type BaseMode = "random" | "swiss" | "king" | "manual" | "skill";
export type TeamsMode = "fixed" | "rotating";
export type GenderRule = "mixed" | "random" | "same";
export type Format = "doubles" | "singles";

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
  /**
   * Max number of rounds a player may sit out consecutively before the
   * solver treats it as a violation. Different from matchCountWindow in
   * that this catches the "bench forever" case when total counts happen
   * to be balanced. Round-based only; in continuous play the queue
   * naturally handles it.
   */
  maxWaitWindow?: number;
  /**
   * Runtime override for the base mode. When set, the solver runs this
   * mode for upcoming rounds instead of `base`. Lets organizers flip
   * mid-event (e.g., 5 rounds of king, then 3 rounds of random for
   * variety) without losing the configured default. Equal to base = no
   * override.
   *
   * Replaces the older `shake` boolean — shake=true was effectively
   * "king but seat by variety," which is the same as activeMode="random".
   */
  activeMode?: BaseMode;
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
  /**
   * Which team won this match. 1 | 2 | null. Required by Swiss (for W/L
   * standings) and King (for winners-up/losers-down movement). Optional for
   * Random / Manual where outcomes don't drive pairing.
   */
  winningTeam?: 1 | 2 | null;
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
  /** "doubles" (4 players per match) or "singles" (2 players per match). */
  format?: Format;
  settings: PairingSettings;
  history: MatchHistoryEntry[];
  locks: PairLock[];
  /**
   * When settings.teams === "fixed", these are the pre-formed teams for
   * the event. Each is an immutable pair of players. The solver schedules
   * matchups between them rather than forming teams from individual players.
   * Ignored when teams === "rotating".
   */
  fixedTeams?: Team[];
  /**
   * Average match count computed from ALL checked-in players in the class
   * (including busy ones), not just the idle solver pool. When set, the
   * solver uses this instead of the locally-computed average so that
   * fairness scoring isn't skewed by the subset of players who happen to
   * be idle.
   */
  globalAvgMatchCount?: number;
}

export type ViolationType = "matchCount" | "skill" | "gender" | "variety" | "wait";

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
  /** Beyond the match count window = HARD BLOCK. Within window = 0 cost. */
  matchCount: Infinity,
  /**
   * Beyond the wait window = HARD BLOCK. Within window = 0 cost.
   * These are absolute limits — the solver will never pick an arrangement
   * that violates them, unless ALL arrangements do (then picks least-bad).
   */
  wait: Infinity,
  /** Per step beyond the skill window. */
  skill: 100,
  /** Per non-compliant team when gender = "mixed" or "same" (require). */
  genderRequire: 1_000,
  /** Per non-compliant team when gender = "prefer" (currently unused — we only have require/random). */
  genderPrefer: 100,
  /** Per repeat partner-pair or opponent-pair beyond the variety window. */
  variety: 30,
} as const;
