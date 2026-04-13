/**
 * Pool analyzer — "what's feasible given this pool and these settings?"
 *
 * Used on the event configuration screen to give organizers immediate
 * feedback as they tweak pair locks and the six settings. The analyzer is
 * deterministic and cheap: it derives structural facts from the pool
 * (gender counts, skill distribution, combinatorial partner ceiling) and
 * simulates the solver for N rounds to report when each constraint first
 * breaks.
 */

import { generateRound } from "./generateRound";
import type {
  MatchHistoryEntry,
  PairLock,
  PairingSettings,
  SolverInput,
  SolverPlayer,
  SkillLevel,
  ViolationType,
} from "./types";

export interface PoolAnalysis {
  /** Raw pool counts. */
  pool: {
    total: number;
    active: number; // non-paused
    paused: number;
    genderCounts: { M: number; F: number; unknown: number };
    skillDistribution: Record<SkillLevel, number>;
  };
  /**
   * For doubles on N courts, how many players fit per round; how many
   * sit out each round if numbers don't divide cleanly.
   */
  capacity: {
    playersPerRound: number;
    sitOutPerRound: number;
  };
  /**
   * Combinatorial ceiling: if everyone was equally available and no other
   * constraints applied, how many rounds before Variety starts forcing
   * repeats. Derived from (active - 1) for doubles partner variety.
   */
  varietyCeiling: number;
  /**
   * Simulated feasibility: walk the solver forward up to maxSimulated
   * rounds, report when each violation type first appears.
   */
  feasibility: {
    simulatedRounds: number;
    maxCleanRounds: number; // rounds with cost = 0
    firstViolation: Partial<Record<ViolationType, number>>; // round number
    note?: string;
  };
  /** Categorical warnings: structural problems that won't resolve. */
  warnings: string[];
}

export function analyzePool(
  players: SolverPlayer[],
  numCourts: number,
  settings: PairingSettings,
  locks: PairLock[] = [],
  maxSimulated = 12,
): PoolAnalysis {
  const active = players.filter((p) => !p.paused);
  const paused = players.length - active.length;

  const genderCounts = { M: 0, F: 0, unknown: 0 };
  for (const p of active) {
    if (p.gender === "M") genderCounts.M++;
    else if (p.gender === "F") genderCounts.F++;
    else genderCounts.unknown++;
  }

  const skillDistribution: Record<SkillLevel, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const p of active) skillDistribution[p.skillLevel]++;

  // Only full doubles matches fill a court. 7 players on 2 courts = 1 full
  // court = 4 players used, 3 sitting out. NOT 7 on 2 courts (half-empty).
  const fillableCourts = Math.min(numCourts, Math.floor(active.length / 4));
  const playersPerRound = fillableCourts * 4;
  const sitOutPerRound = Math.max(0, active.length - playersPerRound);

  const varietyCeiling = Math.max(0, active.length - 1);

  // Simulate up to maxSimulated rounds and track when each violation first
  // appears. This is the honest "how many clean rounds can we play?" number.
  const firstViolation: Partial<Record<ViolationType, number>> = {};
  let maxCleanRounds = 0;
  let working = active.map((p) => ({ ...p }));
  let history: MatchHistoryEntry[] = [];
  let roundsRun = 0;

  for (let r = 1; r <= maxSimulated; r++) {
    const input: SolverInput = {
      players: working,
      numCourts,
      settings,
      history,
      locks,
    };
    const result = generateRound(input);
    if (result.round.length === 0) break;
    roundsRun++;

    for (const v of result.violations) {
      if (firstViolation[v.type] === undefined) {
        firstViolation[v.type] = r;
      }
    }
    if (result.cost === 0) maxCleanRounds = r;

    // Apply the round back to the working pool.
    const playedIds = new Set<string>();
    for (const m of result.round) {
      history.push({
        round: r,
        courtNum: m.court,
        team1Ids: [m.team1.player1Id, m.team1.player2Id],
        team2Ids: [m.team2.player1Id, m.team2.player2Id],
      });
      playedIds.add(m.team1.player1Id);
      playedIds.add(m.team1.player2Id);
      playedIds.add(m.team2.player1Id);
      playedIds.add(m.team2.player2Id);
    }
    working = working.map((p) =>
      playedIds.has(p.id) ? { ...p, matchCount: p.matchCount + 1 } : p,
    );
  }

  // Structural warnings: catch impossible configurations early.
  const warnings: string[] = [];

  if (active.length < 4) {
    warnings.push(`Only ${active.length} active player(s) — need at least 4 for a doubles match`);
  }

  if (settings.gender === "mixed") {
    const pairs = Math.min(genderCounts.M, genderCounts.F);
    const mixedTeamsPossible = pairs; // each mixed team = 1M + 1F
    if (mixedTeamsPossible < numCourts * 2) {
      warnings.push(
        `Gender = Mixed, but only ${genderCounts.M}M / ${genderCounts.F}F — not all teams can be mixed`,
      );
    }
  }

  if (settings.gender === "same") {
    if (genderCounts.M === 1 || genderCounts.F === 1) {
      warnings.push(`Gender = Same, but 1 player of that gender has no partner at their gender`);
    }
  }

  // Skill window structural check: can any 4 players satisfy it?
  if (Number.isFinite(settings.skillWindow)) {
    const levels = Object.entries(skillDistribution)
      .filter(([, count]) => count > 0)
      .map(([l]) => Number(l) as SkillLevel);
    if (levels.length > 0) {
      const spread = Math.max(...levels) - Math.min(...levels);
      if (spread > settings.skillWindow) {
        // Check if any single-level bucket has 4+ players
        const richBucket = Object.values(skillDistribution).some((c) => c >= 4);
        if (!richBucket) {
          warnings.push(
            `Skill window ±${settings.skillWindow} is tight for this pool — no single level has ≥4 players and the spread is ${spread}`,
          );
        }
      }
    }
  }

  return {
    pool: {
      total: players.length,
      active: active.length,
      paused,
      genderCounts,
      skillDistribution,
    },
    capacity: {
      playersPerRound,
      sitOutPerRound,
    },
    varietyCeiling,
    feasibility: {
      simulatedRounds: roundsRun,
      maxCleanRounds,
      firstViolation,
    },
    warnings,
  };
}
