/**
 * Unified scoring function for the pairing solver.
 *
 * Every candidate arrangement (a proposed match, i.e., team1 vs team2 on a
 * specific court) gets a total cost made of weighted violations. The solver
 * picks the arrangement with the lowest cost.
 */

import type {
  Match,
  MatchHistoryEntry,
  PairingSettings,
  SolverPlayer,
  Violation,
} from "./types";
import { WEIGHTS } from "./types";

/** Stable key for an unordered pair of player IDs. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Precomputed counts for repeat-avoidance scoring. Build this once per round
 * and reuse across all candidate arrangements to avoid re-scanning history.
 */
export interface RepeatCounts {
  partner: Map<string, number>;  // pairKey → times partnered
  opponent: Map<string, number>; // pairKey → times faced as opponents
}

export function buildRepeatCounts(history: MatchHistoryEntry[]): RepeatCounts {
  const partner = new Map<string, number>();
  const opponent = new Map<string, number>();

  for (const h of history) {
    const t1 = h.team1Ids;
    const t2 = h.team2Ids;
    // Partners
    bump(partner, pairKey(t1[0], t1[1]));
    bump(partner, pairKey(t2[0], t2[1]));
    // Opponents (every player on team 1 vs every player on team 2)
    for (const a of t1) {
      for (const b of t2) {
        bump(opponent, pairKey(a, b));
      }
    }
  }

  return { partner, opponent };
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) || 0) + 1);
}

/**
 * Score a single candidate match (team1 vs team2 on a court).
 *
 * Returns the list of violations (for explainability) and the total cost.
 * The caller sums costs across the round to pick the overall best arrangement.
 */
export function scoreMatch(
  match: Match,
  players: Map<string, SolverPlayer>,
  settings: PairingSettings,
  repeats: RepeatCounts,
  averageMatchCount: number,
): { cost: number; violations: Violation[] } {
  const violations: Violation[] = [];
  let cost = 0;

  const t1p1 = players.get(match.team1.player1Id)!;
  const t1p2 = players.get(match.team1.player2Id)!;
  const t2p1 = players.get(match.team2.player1Id)!;
  const t2p2 = players.get(match.team2.player2Id)!;
  const four = [t1p1, t1p2, t2p1, t2p2];

  // ── Match count window ────────────────────────────────────────────────
  // Adding this match would bring each player's count to matchCount+1.
  // Compare the new counts against the average; any player outside the
  // window incurs cost per step beyond.
  if (Number.isFinite(settings.matchCountWindow)) {
    const window = settings.matchCountWindow;
    for (const p of four) {
      const projected = p.matchCount + 1;
      const deviation = Math.abs(projected - averageMatchCount);
      const beyond = deviation - window;
      if (beyond > 0) {
        const c = beyond * WEIGHTS.matchCount;
        cost += c;
        violations.push({
          type: "matchCount",
          cost: c,
          details: `${p.name} would be ${deviation.toFixed(1)} from average (window ±${window})`,
        });
      }
    }
  }

  // ── Skill window ──────────────────────────────────────────────────────
  // Spread across all 4 players in the match. If max-min > window, add cost
  // per step beyond.
  if (Number.isFinite(settings.skillWindow)) {
    const levels = four.map((p) => p.skillLevel);
    const spread = Math.max(...levels) - Math.min(...levels);
    const beyond = spread - settings.skillWindow;
    if (beyond > 0) {
      const c = beyond * WEIGHTS.skill;
      cost += c;
      violations.push({
        type: "skill",
        cost: c,
        details: `Skill spread ${spread} (window ±${settings.skillWindow})`,
      });
    }
  }

  // ── Gender rule ───────────────────────────────────────────────────────
  if (settings.gender === "mixed") {
    // Each team must be 1M + 1F. Null gender acts as wildcard.
    const teamViolations = countNonMixedTeams(match, players);
    if (teamViolations > 0) {
      const c = teamViolations * WEIGHTS.genderRequire;
      cost += c;
      violations.push({
        type: "gender",
        cost: c,
        details: `${teamViolations} team(s) not mixed M+F`,
      });
    }
  } else if (settings.gender === "same") {
    // Each team must be 2M or 2F. Null gender acts as wildcard.
    const teamViolations = countNonSameGenderTeams(match, players);
    if (teamViolations > 0) {
      const c = teamViolations * WEIGHTS.genderRequire;
      cost += c;
      violations.push({
        type: "gender",
        cost: c,
        details: `${teamViolations} team(s) not same-gender`,
      });
    }
  }

  // ── Variety window ────────────────────────────────────────────────────
  // Partner repeats (within each team) + opponent repeats (across teams).
  if (Number.isFinite(settings.varietyWindow)) {
    const window = settings.varietyWindow;
    const t1Key = pairKey(t1p1.id, t1p2.id);
    const t2Key = pairKey(t2p1.id, t2p2.id);
    const partnerRepeats =
      (repeats.partner.get(t1Key) || 0) + (repeats.partner.get(t2Key) || 0);
    if (partnerRepeats > window) {
      const c = (partnerRepeats - window) * WEIGHTS.variety;
      cost += c;
      violations.push({
        type: "variety",
        cost: c,
        details: `${partnerRepeats} partner repeat(s)`,
      });
    }

    let opponentRepeats = 0;
    for (const a of [t1p1, t1p2]) {
      for (const b of [t2p1, t2p2]) {
        opponentRepeats += repeats.opponent.get(pairKey(a.id, b.id)) || 0;
      }
    }
    if (opponentRepeats > window) {
      const c = (opponentRepeats - window) * WEIGHTS.variety;
      cost += c;
      violations.push({
        type: "variety",
        cost: c,
        details: `${opponentRepeats} opponent repeat(s)`,
      });
    }
  }

  return { cost, violations };
}

function countNonMixedTeams(
  match: Match,
  players: Map<string, SolverPlayer>,
): number {
  let count = 0;
  for (const team of [match.team1, match.team2]) {
    const p1 = players.get(team.player1Id)!;
    const p2 = players.get(team.player2Id)!;
    if (!isMixedTeam(p1.gender, p2.gender)) count++;
  }
  return count;
}

function countNonSameGenderTeams(
  match: Match,
  players: Map<string, SolverPlayer>,
): number {
  let count = 0;
  for (const team of [match.team1, match.team2]) {
    const p1 = players.get(team.player1Id)!;
    const p2 = players.get(team.player2Id)!;
    if (!isSameGenderTeam(p1.gender, p2.gender)) count++;
  }
  return count;
}

/** A team is "mixed" if it has exactly one M and one F (nulls act as wildcard). */
function isMixedTeam(a: "M" | "F" | null, b: "M" | "F" | null): boolean {
  if (a === null || b === null) return true; // wildcard tolerance
  return a !== b;
}

/** A team is "same" gender if both players match (nulls act as wildcard). */
function isSameGenderTeam(a: "M" | "F" | null, b: "M" | "F" | null): boolean {
  if (a === null || b === null) return true; // wildcard tolerance
  return a === b;
}
