/**
 * Round generator for Random base mode + Rotating teams + doubles.
 *
 * Picks the lowest-cost round arrangement given the pool, settings, history,
 * and manual pair locks. Replaces the legacy randomDoubles / skillDoubles /
 * mixedGenderDoubles / skillMixedGenderDoubles branches with one unified
 * scoring-based picker.
 *
 * Strategy depends on court count:
 *   - 1 court: exhaustive search over all C(top,4) × 3 splits
 *   - 2 courts: exhaustive with one level of lookahead — for each court 1
 *     choice, evaluate the best court 2 choice from the remaining players,
 *     pick the combination that minimizes total cost. This fixes the greedy
 *     pathology where court 1 picks the most homogeneous foursome and leaves
 *     an impossible remainder for court 2.
 *   - 3+ courts: greedy court-by-court (tolerable because large-court events
 *     usually have richer pools where greedy matches optimal in practice).
 *     Can be upgraded to full search later if real events expose pathologies.
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
import { buildRepeatCounts, pairKey, scoreMatch } from "./score";
import type { RepeatCounts } from "./score";

const PLAYERS_PER_MATCH = 4; // doubles

interface ScoredMatch {
  match: Match;
  cost: number;
  violations: Violation[];
}

export function generateRound(input: SolverInput): SolverResult {
  const { settings, numCourts, history, locks } = input;
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

  let raw: { round: Match[]; cost: number; violations: Violation[] } | null = null;

  if (courtsThisRound === 1) {
    const best = findBestMatch(activePlayers, 1, playerMap, settings, repeats, avg, locks);
    if (best) raw = { round: [best.match], cost: best.cost, violations: best.violations };
  } else if (courtsThisRound === 2) {
    const best = findBestTwoCourtArrangement(activePlayers, playerMap, settings, repeats, avg, locks);
    if (best) raw = { round: best.matches, cost: best.cost, violations: best.violations };
  } else {
    const result = greedyMultiCourt(activePlayers, courtsThisRound, playerMap, settings, repeats, avg, locks);
    raw = { round: result.round, cost: result.cost, violations: result.violations };
  }

  if (!raw) {
    return { round: [], cost: 0, violations: [], sittingOut: activePlayers.map((p) => p.id) };
  }

  const sittingOut = sittingOutFor(activePlayers, raw.round);

  // ── Round-level sit-out wait penalty ────────────────────────────────────
  // After the solver picks its matches, check whether it left any player
  // sitting out who has a wait count beyond the window. This catches the
  // rare case where the match-count sort + wait tiebreaker still chose a
  // bench-stuck player to sit out (possible when they're paired into an
  // impossible lock or excluded by other constraints).
  const extraViolations: Violation[] = [];
  let extraCost = 0;
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
    round: raw.round,
    cost: raw.cost + extraCost,
    violations: [...raw.violations, ...extraViolations],
    sittingOut,
  };
}

// ── Single-court best-match finder ────────────────────────────────────────

function findBestMatch(
  pool: SolverPlayer[],
  courtNum: number,
  playerMap: Map<string, SolverPlayer>,
  settings: PairingSettings,
  repeats: RepeatCounts,
  avg: number,
  locks: PairLock[],
): ScoredMatch | null {
  // Sort by match count ASC (under-played first), then longest-waiting
  // first, then random tiebreaker. The wait tiebreaker ensures bench-stuck
  // players are prioritized when totals are tied — the core of the
  // maxWaitWindow fairness story.
  const sorted = [...pool].sort((a, b) => {
    const diff = a.matchCount - b.matchCount;
    if (diff !== 0) return diff;
    const waitDiff = (b.roundsSinceLastPlayed || 0) - (a.roundsSinceLastPlayed || 0);
    if (waitDiff !== 0) return waitDiff;
    return Math.random() - 0.5;
  });

  // Bound the search to the top K under-played players to keep cost low.
  // For 1-court doubles that's usually all the players.
  const K = Math.min(sorted.length, 12);
  const topK = sorted.slice(0, K);

  let best: ScoredMatch | null = null;

  for (let i = 0; i < topK.length - 3; i++) {
    for (let j = i + 1; j < topK.length - 2; j++) {
      for (let k = j + 1; k < topK.length - 1; k++) {
        for (let l = k + 1; l < topK.length; l++) {
          const four = [topK[i], topK[j], topK[k], topK[l]];
          for (const split of enumerateSplits(four, locks)) {
            const match: Match = {
              court: courtNum,
              team1: { player1Id: split.t1[0].id, player2Id: split.t1[1].id },
              team2: { player1Id: split.t2[0].id, player2Id: split.t2[1].id },
            };
            const { cost, violations } = scoreMatch(
              match,
              playerMap,
              settings,
              repeats,
              avg,
            );
            if (!best || cost < best.cost) {
              best = { match, cost, violations };
            }
          }
        }
      }
    }
  }

  return best;
}

// ── Two-court exhaustive search with lookahead ────────────────────────────

function findBestTwoCourtArrangement(
  pool: SolverPlayer[],
  playerMap: Map<string, SolverPlayer>,
  settings: PairingSettings,
  repeats: RepeatCounts,
  avg: number,
  locks: PairLock[],
): { matches: Match[]; cost: number; violations: Violation[] } | null {
  // Sort by match count ASC to prioritize under-played players in the top K.
  const sorted = [...pool].sort((a, b) => {
    const diff = a.matchCount - b.matchCount;
    return diff !== 0 ? diff : Math.random() - 0.5;
  });

  // Take the top K (at least 8, at most 12) to constrain the search space.
  // For a typical 2-court doubles event with 8 active players, this is all 8.
  const K = Math.min(sorted.length, 12);
  const topK = sorted.slice(0, K);

  // Enumerate all disjoint foursome pairs (court 1 + court 2). To avoid
  // double-counting symmetric (A,B) vs (B,A) court assignments, fix that the
  // lowest-index player is always in court 1.
  let best: { matches: Match[]; cost: number; violations: Violation[] } | null = null;

  // Court 1: must contain topK[0]. Choose 3 more from topK[1..].
  for (let i = 1; i < topK.length - 2; i++) {
    for (let j = i + 1; j < topK.length - 1; j++) {
      for (let k = j + 1; k < topK.length; k++) {
        const court1Indices = new Set([0, i, j, k]);
        const court1Four = [topK[0], topK[i], topK[j], topK[k]];
        const court2Pool = topK.filter((_, idx) => !court1Indices.has(idx));

        // Best split for court 1.
        let court1Best: ScoredMatch | null = null;
        for (const split of enumerateSplits(court1Four, locks)) {
          const match: Match = {
            court: 1,
            team1: { player1Id: split.t1[0].id, player2Id: split.t1[1].id },
            team2: { player1Id: split.t2[0].id, player2Id: split.t2[1].id },
          };
          const { cost, violations } = scoreMatch(
            match,
            playerMap,
            settings,
            repeats,
            avg,
          );
          if (!court1Best || cost < court1Best.cost) {
            court1Best = { match, cost, violations };
          }
        }
        if (!court1Best) continue;

        // Best court 2 from the remaining pool (need exactly 4 players).
        // Pick 4 players from court2Pool (could be >4 if topK was larger than 8).
        const court2Best = pickBestFourAndSplit(
          court2Pool,
          2,
          playerMap,
          settings,
          withCourt1Committed(repeats, court1Best.match),
          avg,
          locks,
        );
        if (!court2Best) continue;

        const totalCost = court1Best.cost + court2Best.cost;
        if (!best || totalCost < best.cost) {
          best = {
            matches: [court1Best.match, court2Best.match],
            cost: totalCost,
            violations: [...court1Best.violations, ...court2Best.violations],
          };
        }
      }
    }
  }

  return best;
}

// ── Helper: pick best 4-player foursome from a pool and return best match ─

function pickBestFourAndSplit(
  pool: SolverPlayer[],
  courtNum: number,
  playerMap: Map<string, SolverPlayer>,
  settings: PairingSettings,
  repeats: RepeatCounts,
  avg: number,
  locks: PairLock[],
): ScoredMatch | null {
  if (pool.length < PLAYERS_PER_MATCH) return null;

  let best: ScoredMatch | null = null;
  for (let i = 0; i < pool.length - 3; i++) {
    for (let j = i + 1; j < pool.length - 2; j++) {
      for (let k = j + 1; k < pool.length - 1; k++) {
        for (let l = k + 1; l < pool.length; l++) {
          const four = [pool[i], pool[j], pool[k], pool[l]];
          for (const split of enumerateSplits(four, locks)) {
            const match: Match = {
              court: courtNum,
              team1: { player1Id: split.t1[0].id, player2Id: split.t1[1].id },
              team2: { player1Id: split.t2[0].id, player2Id: split.t2[1].id },
            };
            const { cost, violations } = scoreMatch(
              match,
              playerMap,
              settings,
              repeats,
              avg,
            );
            if (!best || cost < best.cost) {
              best = { match, cost, violations };
            }
          }
        }
      }
    }
  }
  return best;
}

// ── Greedy multi-court fallback (3+ courts) ────────────────────────────────

function greedyMultiCourt(
  activePlayers: SolverPlayer[],
  courtsThisRound: number,
  playerMap: Map<string, SolverPlayer>,
  settings: PairingSettings,
  repeats: RepeatCounts,
  avg: number,
  locks: PairLock[],
): SolverResult {
  const remaining = new Set(activePlayers.map((p) => p.id));
  const matchesOut: Match[] = [];
  const allViolations: Violation[] = [];
  let totalCost = 0;
  const workingRepeats = cloneRepeats(repeats);

  for (let courtIdx = 0; courtIdx < courtsThisRound; courtIdx++) {
    const pool = [...remaining].map((id) => playerMap.get(id)!);
    const best = pickBestFourAndSplit(
      pool,
      courtIdx + 1,
      playerMap,
      settings,
      workingRepeats,
      avg,
      locks,
    );
    if (!best) break;

    matchesOut.push(best.match);
    totalCost += best.cost;
    allViolations.push(...best.violations);
    remaining.delete(best.match.team1.player1Id);
    remaining.delete(best.match.team1.player2Id);
    remaining.delete(best.match.team2.player1Id);
    remaining.delete(best.match.team2.player2Id);
    bumpRepeats(workingRepeats, best.match);
  }

  return {
    round: matchesOut,
    cost: totalCost,
    violations: allViolations,
    sittingOut: [...remaining],
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function enumerateSplits(
  four: SolverPlayer[],
  locks: PairLock[],
): { t1: SolverPlayer[]; t2: SolverPlayer[] }[] {
  const ids = new Set(four.map((p) => p.id));
  const relevant = locks.filter(
    (l) => ids.has(l.playerAId) && ids.has(l.playerBId),
  );

  const allSplits: { t1: SolverPlayer[]; t2: SolverPlayer[] }[] = [
    { t1: [four[0], four[1]], t2: [four[2], four[3]] },
    { t1: [four[0], four[2]], t2: [four[1], four[3]] },
    { t1: [four[0], four[3]], t2: [four[1], four[2]] },
  ];

  if (relevant.length === 0) return allSplits;

  return allSplits.filter((split) => {
    for (const lock of relevant) {
      const aInT1 =
        split.t1[0].id === lock.playerAId || split.t1[1].id === lock.playerAId;
      const bInT1 =
        split.t1[0].id === lock.playerBId || split.t1[1].id === lock.playerBId;
      if (aInT1 !== bInT1) return false;
    }
    return true;
  });
}

function sittingOutFor(activePlayers: SolverPlayer[], matches: Match[]): string[] {
  const used = new Set<string>();
  for (const m of matches) {
    used.add(m.team1.player1Id);
    used.add(m.team1.player2Id);
    used.add(m.team2.player1Id);
    used.add(m.team2.player2Id);
  }
  return activePlayers.map((p) => p.id).filter((id) => !used.has(id));
}

function cloneRepeats(repeats: RepeatCounts): RepeatCounts {
  return {
    partner: new Map(repeats.partner),
    opponent: new Map(repeats.opponent),
  };
}

/**
 * Return a new RepeatCounts with the given court-1 match's partnerships and
 * opponent pairings already recorded. Used for lookahead so court 2 correctly
 * sees court 1's placements as "already used" this round.
 */
function withCourt1Committed(repeats: RepeatCounts, court1: Match): RepeatCounts {
  const next = cloneRepeats(repeats);
  bumpRepeats(next, court1);
  return next;
}

function bumpRepeats(repeats: RepeatCounts, match: Match): void {
  const t1 = match.team1;
  const t2 = match.team2;
  repeats.partner.set(
    pairKey(t1.player1Id, t1.player2Id),
    (repeats.partner.get(pairKey(t1.player1Id, t1.player2Id)) || 0) + 1,
  );
  repeats.partner.set(
    pairKey(t2.player1Id, t2.player2Id),
    (repeats.partner.get(pairKey(t2.player1Id, t2.player2Id)) || 0) + 1,
  );
  for (const a of [t1.player1Id, t1.player2Id]) {
    for (const b of [t2.player1Id, t2.player2Id]) {
      repeats.opponent.set(
        pairKey(a, b),
        (repeats.opponent.get(pairKey(a, b)) || 0) + 1,
      );
    }
  }
}
