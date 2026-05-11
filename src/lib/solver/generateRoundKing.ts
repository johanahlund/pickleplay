/**
 * King-of-the-Court round generator — fairness-driven ejection.
 *
 * The prime directive is EQUAL GAMES PLAYED (adjusted for late joiners via
 * matchCountOffset, which the route folds into SolverPlayer.matchCount).
 * Winners-up/losers-down logic is secondary: it only decides which court
 * the remaining (non-ejected) players play on.
 *
 * Round-by-round algorithm:
 *
 *   1. Determine bench size B = active players − courts × 4. If B = 0,
 *      no one sits out; skip ejection.
 *
 *   2. ROUND 1 (no history): seed by skill — top 4 → C1, next 4 → C2,
 *      etc. Bottom B players sit on the bench.
 *
 *   3. ROUND 2 SPECIAL CASE (all on-court players tied at matchCount=1):
 *      Send losers from the LOWEST court first, walking up until B picked.
 *      This honours the initial skill-tier seed: bench players (lowest
 *      skill) re-enter at the bottom court, and bottom-court losers go to
 *      bench. Players in the round-1 bench will not be ejected here
 *      because they are tied at matchCount=0, ranked below matchCount=1.
 *
 *   4. ROUND 3+ (general case): rank EVERYONE by matchCount DESC. Top B
 *      go to bench. Tiebreak ladder:
 *        a) Prefer losers from last round over winners.
 *        b) When two tied losers were a losing pair, send the pair
 *           together rather than splitting.
 *        c) Fall back to longest-consecutive-played, then random.
 *      Falling back to winners only happens when losers can't fill B.
 *
 *   5. SEAT REMAINING 8 (or N×4 generally): two modes:
 *
 *      a) NORMAL (settings.shake = false): winners-up, losers-down.
 *         Court 1 winners stay → C1. Court 1 losers fall → C2 (unless
 *         ejected). Court 2 winners climb → C1. Court 2 losers stay (or
 *         fall further if 3+ courts). Bench arrivals fill the LOWEST
 *         court first. If exactly the right number of slots are open at
 *         each tier, this is a clean placement.
 *
 *      b) SHAKE (settings.shake = true): the 8 remaining players are
 *         seated to MINIMIZE repeat partnerships and opponents across
 *         history. Skill tiering is ignored. Routes to the existing
 *         random+rotating generator via a parametrised settings object.
 *
 *   6. FORM TEAMS within each court: split the previous round's pairs so
 *      each player gets a fresh partner. Of the 4 players on a court,
 *      identify the two who were partners last round and put them on
 *      OPPOSITE teams; the other two go on opposite teams too. Falls
 *      back to a variety-scored split when there are no prior pairs.
 *
 * Doubles only for v1. Reads history.winningTeam to determine W/L for
 * both ejection tiebreaks and skill-tier movement.
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
import { buildRepeatCounts, scoreMatch } from "./score";

const PLAYERS_PER_MATCH = 4;

export function generateRoundKing(input: SolverInput): SolverResult {
  const { settings, numCourts, history, players, locks } = input;
  const active = players.filter((p) => !p.paused);
  const playerMap = new Map(active.map((p) => [p.id, p]));

  const courtsThisRound = Math.min(numCourts, Math.floor(active.length / PLAYERS_PER_MATCH));
  if (courtsThisRound === 0) {
    return {
      round: [],
      cost: 0,
      violations: [],
      sittingOut: active.map((p) => p.id),
    };
  }

  const seatsAvailable = courtsThisRound * PLAYERS_PER_MATCH;
  const benchSize = Math.max(0, active.length - seatsAvailable);
  const isFirstRound = history.length === 0;

  // ── Step 1 / 2: decide who sits out ────────────────────────────────────
  let benchIds: Set<string>;
  if (isFirstRound) {
    // No history. Seed by skill: top seats to C1, then C2, etc.; the
    // bottom B by skill sit out.
    const sortedBySkill = [...active].sort(skillDescTiebreak);
    benchIds = new Set(sortedBySkill.slice(seatsAvailable).map((p) => p.id));
  } else {
    benchIds = pickEjections(active, benchSize, history);
  }

  const onCourt = active.filter((p) => !benchIds.has(p.id));

  // ── Step 5: seat the on-court players ─────────────────────────────────
  // NOTE: `settings.activeMode === "random"` on this call shouldn't normally
  // happen — generateRound routes Random to its own path. But if shake/legacy
  // calls land here with the random override hint, run the variety seater.
  let seating: SolverPlayer[][];
  if (settings.activeMode === "random") {
    seating = seatByVariety(onCourt, courtsThisRound, history, settings, locks);
  } else if (isFirstRound) {
    // Round 1 — simple skill seed.
    const sortedBySkill = [...onCourt].sort(skillDescTiebreak);
    seating = chunkByCourt(sortedBySkill, courtsThisRound);
  } else {
    // Normal King flow: winners climb, losers fall.
    seating = seatByKingFlow(onCourt, courtsThisRound, history);
  }

  // ── Step 6: form teams within each court ──────────────────────────────
  const repeats = buildRepeatCounts(history);
  const localAvg = active.length > 0 ? active.reduce((s, p) => s + p.matchCount, 0) / active.length : 0;
  const avg = input.globalAvgMatchCount ?? localAvg;

  const matchesOut: Match[] = [];
  const allViolations: Violation[] = [];
  let totalCost = 0;

  for (let c = 0; c < seating.length; c++) {
    const four = seating[c];
    if (four.length < PLAYERS_PER_MATCH) continue;
    const best = bestSplitForCourt(four, c + 1, playerMap, settings, repeats, avg, locks, history);
    matchesOut.push(best.match);
    totalCost += best.cost;
    allViolations.push(...best.violations);
  }

  // ── Wait violation (bench overrun) ─────────────────────────────────────
  const sittingOut = [...benchIds];
  if (settings.maxWaitWindow !== undefined && Number.isFinite(settings.maxWaitWindow)) {
    for (const id of sittingOut) {
      const p = playerMap.get(id);
      if (!p) continue;
      const wait = (p.roundsSinceLastPlayed || 0) + 1; // sitting this round too
      const beyond = wait - settings.maxWaitWindow;
      if (beyond > 0) {
        const c = beyond * WEIGHTS.wait;
        totalCost += c;
        allViolations.push({
          type: "wait",
          cost: c,
          details: `${p.name} would sit out ${wait} round(s) (window ±${settings.maxWaitWindow})`,
        });
      }
    }
  }

  return {
    round: matchesOut,
    cost: totalCost,
    violations: allViolations,
    sittingOut,
  };
}

// ── Ejection: pick who sits out ────────────────────────────────────────────

function pickEjections(
  active: SolverPlayer[],
  benchSize: number,
  history: SolverInput["history"],
): Set<string> {
  const picked = new Set<string>();
  if (benchSize <= 0) return picked;

  // Was the previous (most recent) round the very first one? If so we are
  // in the "round 1 → round 2" special case where everyone on-court is
  // tied at matchCount=1: send LOSERS from the LOWEST court first.
  const prevRound = history.reduce((max, h) => Math.max(max, h.round), 0);
  const prevRoundLosers = history
    .filter((h) => h.round === prevRound && h.winningTeam !== null && h.winningTeam !== undefined)
    .flatMap((h) => {
      const losingIds = h.winningTeam === 1 ? h.team2Ids : h.team1Ids;
      return losingIds.map((id) => ({ id, courtNum: h.courtNum, partnerId: losingIds.find((q) => q !== id) || "" }));
    });

  if (prevRound === 1) {
    // Sort losers by court DESC (highest court number = lowest tier first).
    const sorted = [...prevRoundLosers].sort((a, b) => b.courtNum - a.courtNum);
    for (const l of sorted) {
      if (picked.size >= benchSize) break;
      picked.add(l.id);
    }
    if (picked.size >= benchSize) return picked;
  }

  // ── General case: rank by effective match count, with tiebreaks ───────
  // Build a sortable ranking. Players with the same matchCount fall into
  // the same tier; tiebreaks within a tier pick losers + pairs first.
  //
  // The challenge with "prefer losing pairs": after picking one member of
  // a losing pair we must remember to take the partner next, even if a
  // different individual loser ranks earlier. We handle this in two
  // phases:
  //   Phase A — group active players by matchCount tiers (DESC).
  //   Phase B — within each tier, walk losing pairs first, then
  //             individual losers, then winners; stop when picked = B.

  const tierMap = new Map<number, SolverPlayer[]>();
  for (const p of active) {
    if (picked.has(p.id)) continue; // already taken by round-1 special case
    const tier = tierMap.get(p.matchCount) || [];
    tier.push(p);
    tierMap.set(p.matchCount, tier);
  }
  const tiers = [...tierMap.keys()].sort((a, b) => b - a); // DESC

  for (const t of tiers) {
    if (picked.size >= benchSize) break;
    const inTier = tierMap.get(t)!;
    pickFromTier(inTier, benchSize - picked.size, picked);
  }

  return picked;
}

function pickFromTier(
  inTier: SolverPlayer[],
  remaining: number,
  picked: Set<string>,
): void {
  if (remaining <= 0) return;

  // Phase 1: losing pairs (both partners present in the tier).
  // We use lastRoundLosingPartnerId to identify pairs.
  const inTierIds = new Set(inTier.map((p) => p.id));
  const visited = new Set<string>();
  const losingPairs: [SolverPlayer, SolverPlayer][] = [];
  const individualLosers: SolverPlayer[] = [];
  const winners: SolverPlayer[] = [];

  for (const p of inTier) {
    if (visited.has(p.id)) continue;
    if (p.lostLastRound) {
      const partnerId = p.lastRoundLosingPartnerId;
      if (partnerId && inTierIds.has(partnerId) && !visited.has(partnerId)) {
        const partner = inTier.find((q) => q.id === partnerId)!;
        losingPairs.push([p, partner]);
        visited.add(p.id);
        visited.add(partner.id);
      } else {
        individualLosers.push(p);
        visited.add(p.id);
      }
    } else {
      winners.push(p);
      visited.add(p.id);
    }
  }

  // Stable tiebreak: longer consecutive-played first, then by name (deterministic).
  const playedTiebreak = (a: SolverPlayer, b: SolverPlayer): number => {
    const wA = a.roundsSinceLastPlayed ?? 0;
    const wB = b.roundsSinceLastPlayed ?? 0;
    // LESS-recently-rested = preferred for bench. roundsSinceLastPlayed
    // = 0 means just played; so smaller = more recently on court = higher
    // priority to bench. Sort ASC.
    if (wA !== wB) return wA - wB;
    return a.id.localeCompare(b.id);
  };
  losingPairs.sort((a, b) => playedTiebreak(a[0], b[0]));
  individualLosers.sort(playedTiebreak);
  winners.sort(playedTiebreak);

  for (const [a, b] of losingPairs) {
    if (remaining <= 0) return;
    if (remaining === 1) {
      // Only one slot left and we'd have to split the pair. Take the
      // first individual loser instead if any exists; otherwise take one
      // pair member.
      if (individualLosers.length > 0) {
        picked.add(individualLosers[0].id);
        return;
      }
      picked.add(a.id);
      return;
    }
    picked.add(a.id);
    picked.add(b.id);
    remaining -= 2;
  }

  for (const p of individualLosers) {
    if (remaining <= 0) return;
    picked.add(p.id);
    remaining--;
  }

  for (const p of winners) {
    if (remaining <= 0) return;
    picked.add(p.id);
    remaining--;
  }
}

// ── Seating: normal King flow (winners up, losers down) ──────────────────

function seatByKingFlow(
  onCourt: SolverPlayer[],
  numCourts: number,
  history: SolverInput["history"],
): SolverPlayer[][] {
  const onCourtIds = new Set(onCourt.map((p) => p.id));
  const slots: SolverPlayer[][] = Array.from({ length: numCourts }, () => []);
  const placed = new Set<string>();

  const prevRound = history.reduce((max, h) => Math.max(max, h.round), 0);
  const prevEntries = history.filter((h) => h.round === prevRound);

  // Place players who came from the previous round at their new tier.
  // Winners move UP (lower court index), losers move DOWN (higher index).
  // Court 1 has no above (winners stay), last court has no below (losers
  // stay).
  for (const entry of prevEntries) {
    const winners = entry.winningTeam === 1 ? entry.team1Ids : entry.team2Ids;
    const losers = entry.winningTeam === 1 ? entry.team2Ids : entry.team1Ids;
    const winnerDest = Math.max(0, entry.courtNum - 2); // 0-indexed
    const loserDest = Math.min(numCourts - 1, entry.courtNum); // 0-indexed: courtNum→same → falls 1

    for (const id of winners) {
      if (!onCourtIds.has(id) || placed.has(id)) continue;
      const p = onCourt.find((q) => q.id === id);
      if (!p) continue;
      slots[winnerDest].push(p);
      placed.add(id);
    }
    for (const id of losers) {
      if (!onCourtIds.has(id) || placed.has(id)) continue;
      const p = onCourt.find((q) => q.id === id);
      if (!p) continue;
      slots[loserDest].push(p);
      placed.add(id);
    }
  }

  // Bench arrivals (players in onCourt but not placed yet) fill the
  // LOWEST court first (bottom-up). These are players who sat out the
  // previous round.
  const arrivals = onCourt.filter((p) => !placed.has(p.id));
  arrivals.sort((a, b) => b.skillLevel - a.skillLevel); // skill DESC so the
  // most-skilled arrival lands at a higher court when there's room.

  // Walk from lowest court (numCourts - 1) upward, filling gaps.
  let ai = 0;
  for (let c = numCourts - 1; c >= 0 && ai < arrivals.length; c--) {
    while (slots[c].length < PLAYERS_PER_MATCH && ai < arrivals.length) {
      slots[c].push(arrivals[ai]);
      ai++;
    }
  }

  // Overflow handling: if a court ended up with >4 players (can happen
  // when prev-round movement piled up at one court), cascade overflow to
  // the next court down. If we hit the bottom, push to a phantom slot
  // (we'll just leave them out — but pickEjections should have prevented
  // this; we treat it as defensive).
  for (let c = 0; c < numCourts; c++) {
    while (slots[c].length > PLAYERS_PER_MATCH) {
      const overflow = slots[c].pop()!;
      if (c + 1 < numCourts) {
        slots[c + 1].push(overflow);
      }
      // else dropped; would be a bug, but don't crash.
    }
  }

  // If any court is UNDER-filled (e.g., when a previous round had
  // incomplete winningTeam data and movement broke down), pull from the
  // next court down to fill. This keeps the solver robust against
  // missing winningTeam values.
  for (let c = numCourts - 1; c >= 0; c--) {
    while (slots[c].length < PLAYERS_PER_MATCH) {
      // Try to pull from a court that has too few from somewhere, but in
      // practice this branch fires only if movement went sideways. Borrow
      // from the next court up.
      let donor = -1;
      for (let d = c - 1; d >= 0; d--) {
        if (slots[d].length > PLAYERS_PER_MATCH) {
          donor = d;
          break;
        }
      }
      if (donor === -1) break;
      slots[c].push(slots[donor].pop()!);
    }
  }

  return slots;
}

// ── Seating: shake mode (variety-driven) ──────────────────────────────────

function seatByVariety(
  onCourt: SolverPlayer[],
  numCourts: number,
  history: SolverInput["history"],
  settings: PairingSettings,
  locks: PairLock[],
): SolverPlayer[][] {
  // Greedy: pick the best foursome court-by-court, scoring each by the
  // variety component only (we already chose who sits out by fairness).
  // Reuse scoreMatch with skillWindow set to Infinity so only variety +
  // gender + matchCount-window affect cost; matchCount-window is benign
  // here because all on-court players are about to play.
  const repeats = buildRepeatCounts(history);
  const playerMap = new Map(onCourt.map((p) => [p.id, p]));
  const localAvg = onCourt.reduce((s, p) => s + p.matchCount, 0) / Math.max(1, onCourt.length);

  const remaining = new Set(onCourt.map((p) => p.id));
  const slots: SolverPlayer[][] = [];

  const inertSettings: PairingSettings = {
    ...settings,
    skillWindow: Infinity,
    matchCountWindow: Infinity,
    varietyWindow: 0,
  };

  for (let c = 0; c < numCourts; c++) {
    const pool = [...remaining].map((id) => playerMap.get(id)!);
    if (pool.length < PLAYERS_PER_MATCH) break;
    const best = pickBestFourForVariety(pool, c + 1, playerMap, inertSettings, repeats, localAvg, locks);
    if (!best) break;
    slots.push([best.four[0], best.four[1], best.four[2], best.four[3]]);
    for (const p of best.four) remaining.delete(p.id);
  }
  return slots;
}

function pickBestFourForVariety(
  pool: SolverPlayer[],
  courtNum: number,
  playerMap: Map<string, SolverPlayer>,
  settings: PairingSettings,
  repeats: ReturnType<typeof buildRepeatCounts>,
  avg: number,
  locks: PairLock[],
): { four: SolverPlayer[]; cost: number } | null {
  let best: { four: SolverPlayer[]; cost: number } | null = null;
  for (let i = 0; i < pool.length - 3; i++) {
    for (let j = i + 1; j < pool.length - 2; j++) {
      for (let k = j + 1; k < pool.length - 1; k++) {
        for (let l = k + 1; l < pool.length; l++) {
          const four = [pool[i], pool[j], pool[k], pool[l]];
          const splitCost = cheapestSplitCost(four, courtNum, playerMap, settings, repeats, avg, locks);
          if (!best || splitCost < best.cost) {
            best = { four, cost: splitCost };
          }
        }
      }
    }
  }
  return best;
}

function cheapestSplitCost(
  four: SolverPlayer[],
  courtNum: number,
  playerMap: Map<string, SolverPlayer>,
  settings: PairingSettings,
  repeats: ReturnType<typeof buildRepeatCounts>,
  avg: number,
  locks: PairLock[],
): number {
  let min = Infinity;
  for (const split of enumerateSplits(four, locks)) {
    const m: Match = {
      court: courtNum,
      team1: { player1Id: split.t1[0].id, player2Id: split.t1[1].id },
      team2: { player1Id: split.t2[0].id, player2Id: split.t2[1].id },
    };
    const { cost } = scoreMatch(m, playerMap, settings, repeats, avg);
    if (cost < min) min = cost;
  }
  return min === Infinity ? 0 : min;
}

// ── Team formation: split previous pairs within a court ───────────────────

interface ScoredSplit {
  match: Match;
  cost: number;
  violations: Violation[];
}

function bestSplitForCourt(
  four: SolverPlayer[],
  courtNum: number,
  playerMap: Map<string, SolverPlayer>,
  settings: PairingSettings,
  repeats: ReturnType<typeof buildRepeatCounts>,
  avg: number,
  locks: PairLock[],
  history: SolverInput["history"],
): ScoredSplit {
  // Generate the 3 possible 2-vs-2 splits, filtered by locks. Pick the
  // split that minimizes (a) repeat partner-pair, (b) repeat opponent-pair,
  // and (c) keeps locks intact.
  //
  // We weight repeat-partner heavier than the normal variety weight so
  // "split the pairs" is the dominant force: even when the variety window
  // is set to Infinity (don't care across history), we still split TODAY's
  // arrivals. Each candidate split is scored by scoreMatch and then bumped
  // with a per-split bias against repeating the most recent partnership.
  const splits = enumerateSplits(four, locks);
  if (splits.length === 0) {
    // No legal split (lock conflict). Fall back to the first ordering.
    const fallback: Match = {
      court: courtNum,
      team1: { player1Id: four[0].id, player2Id: four[1].id },
      team2: { player1Id: four[2].id, player2Id: four[3].id },
    };
    return { match: fallback, cost: 0, violations: [] };
  }

  // Identify the most-recent partner of each player among the four. Used
  // to compute the "fresh partner" bonus: a split that keeps two recent
  // partners on the same team is penalized vs one that splits them.
  const recentPartner = new Map<string, string | null>();
  const fourIds = new Set(four.map((p) => p.id));
  // Walk history newest-first; first hit wins per player.
  const sortedHistory = [...history].sort((a, b) => b.round - a.round);
  for (const p of four) {
    let partner: string | null = null;
    for (const h of sortedHistory) {
      const inT1 = h.team1Ids.includes(p.id);
      const inT2 = h.team2Ids.includes(p.id);
      if (!inT1 && !inT2) continue;
      const teammates = inT1
        ? h.team1Ids.filter((x) => x !== p.id)
        : h.team2Ids.filter((x) => x !== p.id);
      const onCourtPartner = teammates.find((x) => fourIds.has(x));
      if (onCourtPartner) {
        partner = onCourtPartner;
        break;
      }
    }
    recentPartner.set(p.id, partner);
  }

  let best: ScoredSplit | null = null;
  for (const split of splits) {
    const m: Match = {
      court: courtNum,
      team1: { player1Id: split.t1[0].id, player2Id: split.t1[1].id },
      team2: { player1Id: split.t2[0].id, player2Id: split.t2[1].id },
    };
    const { cost, violations } = scoreMatch(m, playerMap, settings, repeats, avg);

    // "Fresh partner" bias: add a penalty for each team where both
    // members were partners in the most recent shared match.
    let pairBias = 0;
    for (const team of [split.t1, split.t2]) {
      const [a, b] = team;
      if (recentPartner.get(a.id) === b.id) pairBias += 5;
    }
    const total = cost + pairBias;
    if (!best || total < best.cost) {
      best = { match: m, cost: total, violations };
    }
  }
  return best!;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function skillDescTiebreak(a: SolverPlayer, b: SolverPlayer): number {
  if (a.skillLevel !== b.skillLevel) return b.skillLevel - a.skillLevel;
  return a.id.localeCompare(b.id);
}

function chunkByCourt(players: SolverPlayer[], numCourts: number): SolverPlayer[][] {
  const out: SolverPlayer[][] = Array.from({ length: numCourts }, () => []);
  for (let i = 0; i < players.length && i < numCourts * PLAYERS_PER_MATCH; i++) {
    out[Math.floor(i / PLAYERS_PER_MATCH)].push(players[i]);
  }
  return out;
}

function enumerateSplits(
  four: SolverPlayer[],
  locks: PairLock[],
): { t1: SolverPlayer[]; t2: SolverPlayer[] }[] {
  const ids = new Set(four.map((p) => p.id));
  const relevant = locks.filter((l) => ids.has(l.playerAId) && ids.has(l.playerBId));
  const all: { t1: SolverPlayer[]; t2: SolverPlayer[] }[] = [
    { t1: [four[0], four[1]], t2: [four[2], four[3]] },
    { t1: [four[0], four[2]], t2: [four[1], four[3]] },
    { t1: [four[0], four[3]], t2: [four[1], four[2]] },
  ];
  if (relevant.length === 0) return all;
  return all.filter((split) => {
    for (const lock of relevant) {
      const aInT1 = split.t1[0].id === lock.playerAId || split.t1[1].id === lock.playerAId;
      const bInT1 = split.t1[0].id === lock.playerBId || split.t1[1].id === lock.playerBId;
      if (aInT1 !== bInT1) return false;
    }
    return true;
  });
}

