/**
 * King-of-the-Court round generator.
 *
 * Courts are ranked by skill: Court 1 = top tier ("king court"), Court N
 * = bottom tier. Round 1 seeds players to courts by rating. Subsequent
 * rounds move winners UP (to a lower court number) and losers DOWN.
 * Teams within a court are formed fresh each round from the 4 players
 * currently assigned to that court.
 *
 * Doubles only for v1. Reads history.winningTeam to determine movement.
 */

import type {
  Match,
  PairingSettings,
  SolverInput,
  SolverPlayer,
  SolverResult,
  Violation,
} from "./types";
import { WEIGHTS } from "./types";

export function generateRoundKing(input: SolverInput): SolverResult {
  const { settings, numCourts, history, players } = input;
  const active = players.filter((p) => !p.paused);
  const playerMap = new Map(active.map((p) => [p.id, p]));

  const courtsThisRound = Math.min(numCourts, Math.floor(active.length / 4));
  if (courtsThisRound === 0) {
    return { round: [], cost: 0, violations: [], sittingOut: active.map((p) => p.id) };
  }

  // Determine each player's court assignment for this round.
  const courtSlots: string[][] = Array.from({ length: courtsThisRound }, () => []);

  const lastRound = history.reduce((max, h) => Math.max(max, h.round), 0);
  const lastRoundEntries = history.filter((h) => h.round === lastRound);

  if (lastRoundEntries.length === 0) {
    // Round 1: seed by skill level (desc), top players to court 1.
    const sorted = [...active].sort((a, b) => b.skillLevel - a.skillLevel);
    for (let i = 0; i < courtsThisRound * 4 && i < sorted.length; i++) {
      courtSlots[Math.floor(i / 4)].push(sorted[i].id);
    }
  } else {
    // Subsequent rounds: move winners up, losers down.
    const placed = new Set<string>();

    for (const entry of lastRoundEntries) {
      const winnerIds = entry.winningTeam === 1 ? entry.team1Ids : entry.team2Ids;
      const loserIds = entry.winningTeam === 1 ? entry.team2Ids : entry.team1Ids;

      // Winners move up (lower court number), except court 1 stays.
      const winnerDest = Math.max(0, entry.courtNum - 2); // 0-indexed
      // Losers move down, except last court stays.
      const loserDest = Math.min(courtsThisRound - 1, entry.courtNum);

      for (const id of winnerIds) {
        if (playerMap.has(id) && !placed.has(id)) {
          courtSlots[winnerDest].push(id);
          placed.add(id);
        }
      }
      for (const id of loserIds) {
        if (playerMap.has(id) && !placed.has(id)) {
          courtSlots[loserDest].push(id);
          placed.add(id);
        }
      }
    }

    // Fill any gaps with leftover active players (players who sat out the
    // last round or just joined). Put them in the lowest courts first.
    const leftover = active.filter((p) => !placed.has(p.id));
    leftover.sort((a, b) => a.matchCount - b.matchCount); // under-played first
    let li = 0;
    for (let c = courtsThisRound - 1; c >= 0 && li < leftover.length; c--) {
      while (courtSlots[c].length < 4 && li < leftover.length) {
        courtSlots[c].push(leftover[li].id);
        li++;
      }
    }

    // If any court is overfull, overflow to the next court down.
    for (let c = 0; c < courtsThisRound; c++) {
      while (courtSlots[c].length > 4) {
        const overflow = courtSlots[c].pop()!;
        if (c + 1 < courtsThisRound) courtSlots[c + 1].push(overflow);
      }
    }
  }

  // For each court, form teams from its 4 players. King doesn't optimize
  // within the court (skill stratification is already handled by court
  // tier); just split them 2-2. Simple: first 2 ids vs last 2 ids.
  const matchesOut: Match[] = [];
  const usedPlayers = new Set<string>();
  for (let c = 0; c < courtsThisRound; c++) {
    const slot = courtSlots[c];
    if (slot.length < 4) continue;
    const four = slot.slice(0, 4);
    matchesOut.push({
      court: c + 1,
      team1: { player1Id: four[0], player2Id: four[1] },
      team2: { player1Id: four[2], player2Id: four[3] },
    });
    for (const id of four) usedPlayers.add(id);
  }

  const sittingOut = active.filter((p) => !usedPlayers.has(p.id)).map((p) => p.id);

  // Wait violation (same pattern).
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
    cost: extraCost,
    violations: extraViolations,
    sittingOut,
  };
}
