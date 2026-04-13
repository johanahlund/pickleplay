/**
 * Fixed-teams round generator.
 *
 * Teams are pre-formed at event creation (EventPair rows) and do not
 * change between rounds. The solver's job is to decide which teams face
 * each other on which court, not to form new teams.
 *
 * Scope: Random base mode (Swiss is a separate follow-up — same fixed
 * teams but ordered by W/L record). Works for doubles only; fixed singles
 * doesn't really exist as a concept.
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
import type { RepeatCounts } from "./score";

export function generateRoundFixed(input: SolverInput): SolverResult {
  const { settings, numCourts, history, fixedTeams } = input;
  if (!fixedTeams || fixedTeams.length === 0) {
    return {
      round: [],
      cost: 0,
      violations: [],
      sittingOut: input.players.filter((p) => !p.paused).map((p) => p.id),
    };
  }

  const playerMap = new Map(input.players.map((p) => [p.id, p]));
  const repeats = buildRepeatCounts(history);

  // Filter out teams containing paused players. A team is "active" only
  // if BOTH of its players are active.
  const activeTeams = fixedTeams.filter((t) => {
    const p1 = playerMap.get(t.player1Id);
    const p2 = playerMap.get(t.player2Id);
    return p1 && p2 && !p1.paused && !p2.paused;
  });

  // Compute team-level aggregates for scoring.
  const teamStats = activeTeams.map((t) => {
    const p1 = playerMap.get(t.player1Id)!;
    const p2 = playerMap.get(t.player2Id)!;
    return {
      team: t,
      key: pairKey(t.player1Id, t.player2Id),
      minLevel: Math.min(p1.skillLevel, p2.skillLevel),
      maxLevel: Math.max(p1.skillLevel, p2.skillLevel),
      sumLevel: p1.skillLevel + p2.skillLevel,
      matchCount: Math.max(p1.matchCount, p2.matchCount), // teams play together, should tie
      wait: Math.max(p1.roundsSinceLastPlayed || 0, p2.roundsSinceLastPlayed || 0),
      gender1: p1.gender,
      gender2: p2.gender,
      p1Name: p1.name,
      p2Name: p2.name,
    };
  });

  // Average team match count across active teams.
  const avg =
    teamStats.length > 0 ? teamStats.reduce((s, t) => s + t.matchCount, 0) / teamStats.length : 0;

  const courtsThisRound = Math.min(numCourts, Math.floor(teamStats.length / 2));
  if (courtsThisRound === 0) {
    return {
      round: [],
      cost: 0,
      violations: [],
      sittingOut: input.players.filter((p) => !p.paused).map((p) => p.id),
    };
  }

  // Sort teams by match count ASC, then longest-waiting, then random.
  const sortedTeams = [...teamStats].sort((a, b) => {
    const diff = a.matchCount - b.matchCount;
    if (diff !== 0) return diff;
    const waitDiff = b.wait - a.wait;
    if (waitDiff !== 0) return waitDiff;
    return Math.random() - 0.5;
  });

  // Greedy court-by-court: find the best pair of teams for each court and
  // remove them from the candidate pool.
  const remaining = new Set(sortedTeams.map((t) => t.key));
  const remainingByKey = new Map(sortedTeams.map((t) => [t.key, t]));
  const matchesOut: Match[] = [];
  const allViolations: Violation[] = [];
  let totalCost = 0;
  const workingRepeats = { partner: new Map(repeats.partner), opponent: new Map(repeats.opponent) };

  for (let courtIdx = 0; courtIdx < courtsThisRound; courtIdx++) {
    const candidates = [...remaining].map((k) => remainingByKey.get(k)!);
    if (candidates.length < 2) break;

    const K = Math.min(candidates.length, 12);
    const topK = candidates.slice(0, K);

    let best: { matchup: Match; cost: number; violations: Violation[] } | null = null;

    for (let i = 0; i < topK.length - 1; i++) {
      for (let j = i + 1; j < topK.length; j++) {
        const teamA = topK[i];
        const teamB = topK[j];
        const match: Match = {
          court: courtIdx + 1,
          team1: teamA.team,
          team2: teamB.team,
        };
        const { cost, violations } = scoreFixedMatchup(
          teamA,
          teamB,
          match,
          settings,
          workingRepeats,
          avg,
        );
        if (!best || cost < best.cost) {
          best = { matchup: match, cost, violations };
        }
      }
    }

    if (!best) break;

    matchesOut.push(best.matchup);
    totalCost += best.cost;
    allViolations.push(...best.violations);

    const keyA = pairKey(best.matchup.team1.player1Id, best.matchup.team1.player2Id);
    const keyB = pairKey(best.matchup.team2.player1Id, best.matchup.team2.player2Id);
    remaining.delete(keyA);
    remaining.delete(keyB);

    // Record the opponent pair (at team level, using player-level keys for
    // consistency with the existing variety tracking).
    for (const a of [best.matchup.team1.player1Id, best.matchup.team1.player2Id]) {
      for (const b of [best.matchup.team2.player1Id, best.matchup.team2.player2Id]) {
        const k = pairKey(a, b);
        workingRepeats.opponent.set(k, (workingRepeats.opponent.get(k) || 0) + 1);
      }
    }
  }

  // Sitting-out players = players on teams that didn't get scheduled.
  const usedPlayers = new Set<string>();
  for (const m of matchesOut) {
    usedPlayers.add(m.team1.player1Id);
    usedPlayers.add(m.team1.player2Id);
    usedPlayers.add(m.team2.player1Id);
    usedPlayers.add(m.team2.player2Id);
  }
  const sittingOut = input.players
    .filter((p) => !p.paused && !usedPlayers.has(p.id))
    .map((p) => p.id);

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

// ── Scoring for a fixed-teams matchup ─────────────────────────────────────

type TeamStats = {
  team: Team;
  key: string;
  minLevel: number;
  maxLevel: number;
  sumLevel: number;
  matchCount: number;
  wait: number;
  gender1: "M" | "F" | null;
  gender2: "M" | "F" | null;
  p1Name: string;
  p2Name: string;
};

function scoreFixedMatchup(
  a: TeamStats,
  b: TeamStats,
  match: Match,
  settings: PairingSettings,
  repeats: RepeatCounts,
  avg: number,
): { cost: number; violations: Violation[] } {
  const violations: Violation[] = [];
  let cost = 0;

  // Match count window (team-level — both team members move together).
  if (Number.isFinite(settings.matchCountWindow)) {
    const w = settings.matchCountWindow;
    for (const t of [a, b]) {
      const projected = t.matchCount + 1;
      const deviation = Math.abs(projected - avg);
      const beyond = deviation - w;
      if (beyond > 0) {
        const c = beyond * WEIGHTS.matchCount;
        cost += c;
        violations.push({
          type: "matchCount",
          cost: c,
          details: `${t.p1Name}+${t.p2Name} would be ${deviation.toFixed(1)} from average (window ±${w})`,
        });
      }
    }
  }

  // Skill window — full spread across all 4 players in the matchup.
  if (Number.isFinite(settings.skillWindow)) {
    const spread = Math.max(a.maxLevel, b.maxLevel) - Math.min(a.minLevel, b.minLevel);
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

  // Gender rule — the teams are already fixed, so "mixed" / "same" now
  // applies to the team composition: each pre-formed team should already
  // satisfy the rule. If it doesn't, penalize here as a stale-config hint.
  for (const t of [a, b]) {
    if (settings.gender === "mixed") {
      if (t.gender1 && t.gender2 && t.gender1 === t.gender2) {
        const c = WEIGHTS.genderRequire;
        cost += c;
        violations.push({
          type: "gender",
          cost: c,
          details: `Team ${t.p1Name}+${t.p2Name} is not mixed (both ${t.gender1})`,
        });
      }
    } else if (settings.gender === "same") {
      if (t.gender1 && t.gender2 && t.gender1 !== t.gender2) {
        const c = WEIGHTS.genderRequire;
        cost += c;
        violations.push({
          type: "gender",
          cost: c,
          details: `Team ${t.p1Name}+${t.p2Name} is not same-gender`,
        });
      }
    }
  }

  // Variety — opponent repeats (count at player level, summed for the team).
  if (Number.isFinite(settings.varietyWindow)) {
    const w = settings.varietyWindow;
    let repeatCount = 0;
    for (const ai of [a.team.player1Id, a.team.player2Id]) {
      for (const bi of [b.team.player1Id, b.team.player2Id]) {
        repeatCount += repeats.opponent.get(pairKey(ai, bi)) || 0;
      }
    }
    if (repeatCount > w) {
      const c = (repeatCount - w) * WEIGHTS.variety;
      cost += c;
      violations.push({
        type: "variety",
        cost: c,
        details: `${repeatCount} opponent repeat(s) between teams`,
      });
    }
  }

  void match;
  return { cost, violations };
}
