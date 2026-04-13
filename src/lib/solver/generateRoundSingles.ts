/**
 * Singles round generator — 2 players per match, 1 per "team".
 *
 * Structurally similar to the doubles solver but with only 2 players per
 * court. Teams in the output have player1Id set; player2Id is a sentinel
 * equal to player1Id so downstream type shape is uniform.
 *
 * Scope: Random + Rotating base mode only (same as doubles v1).
 */

import type {
  Match,
  PairLock,
  PairingSettings,
  SolverInput,
  SolverPlayer,
  SolverResult,
  Violation,
} from "./types";
import { WEIGHTS } from "./types";
import { buildRepeatCounts, pairKey } from "./score";
import type { RepeatCounts } from "./score";

const PLAYERS_PER_MATCH = 2;

export function generateRoundSingles(input: SolverInput): SolverResult {
  const { settings, numCourts, history, locks: _locks } = input;
  void _locks; // locks don't apply to singles (partners don't exist)
  const activePlayers = input.players.filter((p) => !p.paused);
  const playerMap = new Map(activePlayers.map((p) => [p.id, p]));
  const repeats = buildRepeatCounts(history);

  const avg =
    activePlayers.length > 0
      ? activePlayers.reduce((s, p) => s + p.matchCount, 0) / activePlayers.length
      : 0;

  const courtsThisRound = Math.min(
    numCourts,
    Math.floor(activePlayers.length / PLAYERS_PER_MATCH),
  );

  if (courtsThisRound === 0) {
    return { round: [], cost: 0, violations: [], sittingOut: activePlayers.map((p) => p.id) };
  }

  // Sort pool: match count ASC, then longest-waiting, then random.
  const sorted = [...activePlayers].sort((a, b) => {
    const countDiff = a.matchCount - b.matchCount;
    if (countDiff !== 0) return countDiff;
    const waitDiff = (b.roundsSinceLastPlayed || 0) - (a.roundsSinceLastPlayed || 0);
    if (waitDiff !== 0) return waitDiff;
    return Math.random() - 0.5;
  });

  // Greedy court-by-court: pick the best pairing for each court in order,
  // removing those players from the pool for the next court.
  const remaining = new Set(sorted.map((p) => p.id));
  const matchesOut: Match[] = [];
  const allViolations: Violation[] = [];
  let totalCost = 0;
  const workingRepeats = { partner: new Map(repeats.partner), opponent: new Map(repeats.opponent) };

  for (let courtIdx = 0; courtIdx < courtsThisRound; courtIdx++) {
    const pool = [...remaining].map((id) => playerMap.get(id)!);
    if (pool.length < PLAYERS_PER_MATCH) break;

    // Search over C(K,2) pairs to find the lowest-cost match.
    const K = Math.min(pool.length, 12);
    const topK = pool.slice(0, K);
    let best: { match: Match; cost: number; violations: Violation[] } | null = null;

    for (let i = 0; i < topK.length - 1; i++) {
      for (let j = i + 1; j < topK.length; j++) {
        const a = topK[i];
        const b = topK[j];
        const candidate: Match = {
          court: courtIdx + 1,
          team1: { player1Id: a.id, player2Id: a.id }, // sentinel: same player
          team2: { player1Id: b.id, player2Id: b.id },
        };
        const { cost, violations } = scoreSinglesMatch(
          a,
          b,
          candidate,
          settings,
          workingRepeats,
          avg,
        );
        if (!best || cost < best.cost) {
          best = { match: candidate, cost, violations };
        }
      }
    }

    if (!best) break;

    matchesOut.push(best.match);
    totalCost += best.cost;
    allViolations.push(...best.violations);
    remaining.delete(best.match.team1.player1Id);
    remaining.delete(best.match.team2.player1Id);

    // Record the opponent pair for variety tracking within this round.
    const key = pairKey(best.match.team1.player1Id, best.match.team2.player1Id);
    workingRepeats.opponent.set(key, (workingRepeats.opponent.get(key) || 0) + 1);
  }

  const sittingOut = [...remaining];

  // Round-level wait violation (same pattern as doubles).
  let extraCost = 0;
  const extraViolations: Violation[] = [];
  if (settings.maxWaitWindow !== undefined && Number.isFinite(settings.maxWaitWindow)) {
    for (const id of sittingOut) {
      const p = playerMap.get(id);
      if (!p) continue;
      const wait = p.roundsSinceLastPlayed || 0;
      const beyond = wait - settings.maxWaitWindow;
      if (beyond > 0) {
        const c = beyond * WEIGHTS.wait;
        extraCost += c;
        extraViolations.push({
          type: "wait",
          cost: c,
          details: `${p.name} sat out ${wait} round(s) (window ±${settings.maxWaitWindow})`,
        });
      }
    }
  }

  return {
    round: matchesOut,
    cost: totalCost + extraCost,
    violations: [...allViolations, ...extraViolations],
    sittingOut,
  };
}

// ── Scoring for a singles match ───────────────────────────────────────────

function scoreSinglesMatch(
  a: SolverPlayer,
  b: SolverPlayer,
  match: Match,
  settings: PairingSettings,
  repeats: RepeatCounts,
  avg: number,
): { cost: number; violations: Violation[] } {
  const violations: Violation[] = [];
  let cost = 0;

  // Match count window — both players would gain 1 match.
  if (Number.isFinite(settings.matchCountWindow)) {
    const w = settings.matchCountWindow;
    for (const p of [a, b]) {
      const projected = p.matchCount + 1;
      const deviation = Math.abs(projected - avg);
      const beyond = deviation - w;
      if (beyond > 0) {
        const c = beyond * WEIGHTS.matchCount;
        cost += c;
        violations.push({
          type: "matchCount",
          cost: c,
          details: `${p.name} would be ${deviation.toFixed(1)} from average (window ±${w})`,
        });
      }
    }
  }

  // Skill window — gap between the two players.
  if (Number.isFinite(settings.skillWindow)) {
    const gap = Math.abs(a.skillLevel - b.skillLevel);
    const beyond = gap - settings.skillWindow;
    if (beyond > 0) {
      const c = beyond * WEIGHTS.skill;
      cost += c;
      violations.push({
        type: "skill",
        cost: c,
        details: `Skill gap ${gap} (window ±${settings.skillWindow})`,
      });
    }
  }

  // Gender rule — in singles, "mixed" means one M and one F; "same" means
  // both same gender; "random" doesn't care.
  if (settings.gender === "mixed") {
    if (a.gender && b.gender && a.gender === b.gender) {
      cost += WEIGHTS.genderRequire;
      violations.push({
        type: "gender",
        cost: WEIGHTS.genderRequire,
        details: "Both players are the same gender (mixed required)",
      });
    }
  } else if (settings.gender === "same") {
    if (a.gender && b.gender && a.gender !== b.gender) {
      cost += WEIGHTS.genderRequire;
      violations.push({
        type: "gender",
        cost: WEIGHTS.genderRequire,
        details: "Players are different genders (same required)",
      });
    }
  }

  // Variety — opponent repeats.
  if (Number.isFinite(settings.varietyWindow)) {
    const w = settings.varietyWindow;
    const key = pairKey(a.id, b.id);
    const seen = repeats.opponent.get(key) || 0;
    if (seen > w) {
      const c = (seen - w) * WEIGHTS.variety;
      cost += c;
      violations.push({
        type: "variety",
        cost: c,
        details: `${seen} previous meeting(s)`,
      });
    }
  }

  void match;
  return { cost, violations };
}
