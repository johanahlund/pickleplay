/**
 * King-of-the-Court round generator for fixed teams.
 *
 * Same prime directive as the rotating King algorithm: every team plays
 * the same number of matches (within structural minimum). But the unit of
 * ejection and movement is the TEAM, not the individual player. Pairs
 * never split.
 *
 * Algorithm:
 *   1. Compute team-level match counts and team-level "lost last round".
 *   2. Determine bench size B = (active teams) - courts. If B > 0, eject
 *      the B teams with the highest match count. Tiebreak = losers first,
 *      then random.
 *   3. Round 1 seeds by team skill (sum of the two players' levels).
 *   4. Round 2+ moves the winning team UP a court, losing team DOWN.
 *      Mid-courts handle both directions; top/bottom edges clamp.
 *   5. Within each court, teams face each other 2 vs 2 in fixed pairings.
 *      (Activemode = "random" disables the skill-tier seating and instead
 *      pairs teams to minimise repeat-opponent variety.)
 */

import type {
  Match,
  PairingSettings,
  SolverInput,
  SolverPlayer,
  SolverResult,
  Team,
  Violation,
} from "./types";
import { WEIGHTS } from "./types";
import { buildRepeatCounts, pairKey } from "./score";

interface KingTeam {
  team: Team;
  /** Stable identity key — sorted player IDs joined by ":". */
  key: string;
  /** Both players' match counts (should be equal in fixed-teams events). */
  matchCount: number;
  /** Sum of skill levels — used for round-1 seeding only. */
  skillSum: number;
  /** Did this team lose its most recent completed match? */
  lostLastRound: boolean;
  /** Most recent court the team played on. */
  lastCourt: number | undefined;
  /** Whether either player is paused. Excluded if so. */
  paused: boolean;
}

export function generateRoundKingFixed(input: SolverInput): SolverResult {
  const { settings, numCourts, history, fixedTeams, players } = input;
  if (!fixedTeams || fixedTeams.length === 0) {
    return {
      round: [],
      cost: 0,
      violations: [],
      sittingOut: players.filter((p) => !p.paused).map((p) => p.id),
    };
  }

  const playerMap = new Map(players.map((p) => [p.id, p]));

  // Build team-level facts from history + player data.
  const teamHistoryByKey = new Map<
    string,
    { round: number; courtNum: number; lost: boolean }
  >();
  for (const h of history) {
    if (h.winningTeam === undefined || h.winningTeam === null) continue;
    const t1Key = pairKey(h.team1Ids[0], h.team1Ids[1]);
    const t2Key = pairKey(h.team2Ids[0], h.team2Ids[1]);
    const t1Lost = h.winningTeam === 2;
    const t2Lost = h.winningTeam === 1;
    const prev1 = teamHistoryByKey.get(t1Key);
    if (!prev1 || prev1.round < h.round) {
      teamHistoryByKey.set(t1Key, { round: h.round, courtNum: h.courtNum, lost: t1Lost });
    }
    const prev2 = teamHistoryByKey.get(t2Key);
    if (!prev2 || prev2.round < h.round) {
      teamHistoryByKey.set(t2Key, { round: h.round, courtNum: h.courtNum, lost: t2Lost });
    }
  }

  const teams: KingTeam[] = fixedTeams.map((t) => {
    const p1 = playerMap.get(t.player1Id);
    const p2 = playerMap.get(t.player2Id);
    const key = pairKey(t.player1Id, t.player2Id);
    const last = teamHistoryByKey.get(key);
    return {
      team: t,
      key,
      matchCount: p1?.matchCount ?? 0, // both players should have equal counts
      skillSum: (p1?.skillLevel ?? 3) + (p2?.skillLevel ?? 3),
      lostLastRound: last?.lost ?? false,
      lastCourt: last?.courtNum,
      paused: (p1?.paused ?? false) || (p2?.paused ?? false),
    };
  });

  const active = teams.filter((t) => !t.paused);
  const courtsThisRound = Math.min(numCourts, active.length); // 1 team per court fits up to N matches if there are N pairs; actually need 2 teams per court.
  // 2 teams per court (doubles fixed pairs).
  const matchesPerRound = Math.min(numCourts, Math.floor(active.length / 2));
  if (matchesPerRound === 0) {
    return {
      round: [],
      cost: 0,
      violations: [],
      sittingOut: active.flatMap((t) => [t.team.player1Id, t.team.player2Id]),
    };
  }
  void courtsThisRound;

  // ── Step 1: bench teams beyond capacity ────────────────────────────────
  const teamsNeeded = matchesPerRound * 2;
  const benchTeamCount = Math.max(0, active.length - teamsNeeded);

  const sortedForBench = [...active].sort((a, b) => {
    if (a.matchCount !== b.matchCount) return b.matchCount - a.matchCount; // higher count → bench first
    if (a.lostLastRound !== b.lostLastRound) return a.lostLastRound ? -1 : 1; // losers first
    return a.key.localeCompare(b.key); // stable
  });
  const benchedTeams = new Set(sortedForBench.slice(0, benchTeamCount).map((t) => t.key));
  const playingTeams = active.filter((t) => !benchedTeams.has(t.key));

  // ── Step 2: place teams on courts ───────────────────────────────────────
  // For round 1 (no history) seed by skill sum descending. For subsequent
  // rounds, winners climb / losers fall — the team's lastCourt + lostLastRound
  // determines its new court.
  const isFirstRound = history.length === 0;
  const isShake = settings.activeMode === "random";

  let courtAssignments: KingTeam[][];

  if (isShake) {
    courtAssignments = assignByVariety(playingTeams, matchesPerRound, history);
  } else if (isFirstRound) {
    const sortedBySkill = [...playingTeams].sort((a, b) => b.skillSum - a.skillSum);
    courtAssignments = Array.from({ length: matchesPerRound }, () => [] as KingTeam[]);
    for (let i = 0; i < sortedBySkill.length && i < matchesPerRound * 2; i++) {
      courtAssignments[Math.floor(i / 2)].push(sortedBySkill[i]);
    }
  } else {
    courtAssignments = assignByKingFlow(playingTeams, matchesPerRound);
  }

  // ── Step 3: form Match rows from the (court → [team, team]) layout ─────
  const repeats = buildRepeatCounts(history);
  const matchesOut: Match[] = [];
  const allViolations: Violation[] = [];
  let totalCost = 0;

  for (let c = 0; c < courtAssignments.length; c++) {
    const courtTeams = courtAssignments[c];
    if (courtTeams.length < 2) continue;
    const m: Match = { court: c + 1, team1: courtTeams[0].team, team2: courtTeams[1].team };
    matchesOut.push(m);

    // Score variety (repeat-opponent) penalty so the result.cost reports
    // how staleness is mounting. Doesn't change placement here.
    let opponentRepeats = 0;
    for (const a of [m.team1.player1Id, m.team1.player2Id]) {
      for (const b of [m.team2.player1Id, m.team2.player2Id]) {
        opponentRepeats += repeats.opponent.get(pairKey(a, b)) || 0;
      }
    }
    if (opponentRepeats > 0) {
      const cst = opponentRepeats * WEIGHTS.variety;
      totalCost += cst;
      allViolations.push({
        type: "variety",
        cost: cst,
        details: `Court ${c + 1}: ${opponentRepeats} prior opponent encounter(s)`,
      });
    }
  }

  const sittingOut: string[] = [];
  for (const t of active) {
    if (benchedTeams.has(t.key)) {
      sittingOut.push(t.team.player1Id, t.team.player2Id);
    }
  }

  return {
    round: matchesOut,
    cost: totalCost,
    violations: allViolations,
    sittingOut,
  };
}

// ── Winners-up / losers-down at the team level ────────────────────────────
function assignByKingFlow(playingTeams: KingTeam[], matchesPerRound: number): KingTeam[][] {
  const slots: KingTeam[][] = Array.from({ length: matchesPerRound }, () => []);
  const placed = new Set<string>();

  // For each team that played last round, place them in their new tier.
  // Tier index = (lastCourt - 1). Winners go to tier-1; losers to tier+1.
  for (const t of playingTeams) {
    if (t.lastCourt === undefined) continue;
    const lastIdx = t.lastCourt - 1;
    const dest = t.lostLastRound
      ? Math.min(matchesPerRound - 1, lastIdx + 1)
      : Math.max(0, lastIdx - 1);
    if (dest >= 0 && dest < matchesPerRound) {
      slots[dest].push(t);
      placed.add(t.key);
    }
  }

  // Bench-returners (no lastCourt or lastCourt out of range) fill the lowest
  // court first.
  const newArrivals = playingTeams.filter((t) => !placed.has(t.key));
  newArrivals.sort((a, b) => b.skillSum - a.skillSum);
  for (let c = matchesPerRound - 1; c >= 0 && newArrivals.length > 0; c--) {
    while (slots[c].length < 2 && newArrivals.length > 0) {
      slots[c].push(newArrivals.shift()!);
    }
  }

  // Overflow handling: cascade extras down. A court can pile up if many
  // teams want to move to the same tier (e.g., all of court 2 winners
  // climbed to court 1).
  for (let c = 0; c < matchesPerRound; c++) {
    while (slots[c].length > 2) {
      const overflow = slots[c].pop()!;
      if (c + 1 < matchesPerRound) slots[c + 1].push(overflow);
    }
  }
  // Underflow: pull from a neighbouring overfull court.
  for (let c = matchesPerRound - 1; c >= 0; c--) {
    while (slots[c].length < 2) {
      let donor = -1;
      for (let d = c - 1; d >= 0; d--) {
        if (slots[d].length > 2) { donor = d; break; }
      }
      if (donor === -1) break;
      slots[c].push(slots[donor].pop()!);
    }
  }

  return slots;
}

// ── Shake mode: minimise repeat-opponent encounters ───────────────────────
function assignByVariety(
  playingTeams: KingTeam[],
  matchesPerRound: number,
  history: SolverInput["history"],
): KingTeam[][] {
  // Count past opponent encounters per (teamA-key, teamB-key) pair.
  const oppMap = new Map<string, number>();
  for (const h of history) {
    const a = pairKey(h.team1Ids[0], h.team1Ids[1]);
    const b = pairKey(h.team2Ids[0], h.team2Ids[1]);
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    oppMap.set(key, (oppMap.get(key) ?? 0) + 1);
  }
  const cost = (a: KingTeam, b: KingTeam): number => {
    const k = a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`;
    return oppMap.get(k) ?? 0;
  };

  // Greedy: for each court, pick the unused pair with the lowest opponent
  // count. Tiebreak by team-skill closeness so the court is still
  // competitive even in shake mode.
  const used = new Set<string>();
  const slots: KingTeam[][] = [];
  for (let c = 0; c < matchesPerRound; c++) {
    const avail = playingTeams.filter((t) => !used.has(t.key));
    if (avail.length < 2) break;
    let bestA: KingTeam | null = null;
    let bestB: KingTeam | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < avail.length - 1; i++) {
      for (let j = i + 1; j < avail.length; j++) {
        const sc = cost(avail[i], avail[j]) * 10 + Math.abs(avail[i].skillSum - avail[j].skillSum);
        if (sc < bestScore) {
          bestScore = sc;
          bestA = avail[i];
          bestB = avail[j];
        }
      }
    }
    if (bestA && bestB) {
      slots.push([bestA, bestB]);
      used.add(bestA.key);
      used.add(bestB.key);
    }
  }
  return slots;
}
