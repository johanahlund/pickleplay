/**
 * Swiss-style round generator for fixed teams.
 *
 * Teams are pre-formed and persist across the event. Each round, the
 * system ranks teams by W/L record and pairs adjacent teams. Round 1 is
 * seeded by team strength (sum of skill levels).
 *
 * Unlike Random mode, Swiss does not minimize cost — it executes a
 * pairing rule deterministically. Skill windows and variety are not
 * enforced (by design — Swiss is about ranking integrity, not skill
 * clustering).
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

interface TeamRecord {
  team: Team;
  wins: number;
  losses: number;
  sumLevel: number;
  matchCount: number;
  wait: number;
}

export function generateRoundSwiss(input: SolverInput): SolverResult {
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

  // Filter out teams with any paused player.
  const activeTeams = fixedTeams.filter((t) => {
    const p1 = playerMap.get(t.player1Id);
    const p2 = playerMap.get(t.player2Id);
    return p1 && p2 && !p1.paused && !p2.paused;
  });

  // Compute W/L records from history.
  const records: TeamRecord[] = activeTeams.map((t) => {
    let wins = 0;
    let losses = 0;
    for (const h of history) {
      if (h.winningTeam == null) continue;
      const t1Match = isSameTeam(h.team1Ids, t);
      const t2Match = isSameTeam(h.team2Ids, t);
      if (!t1Match && !t2Match) continue;
      if ((t1Match && h.winningTeam === 1) || (t2Match && h.winningTeam === 2)) wins++;
      else losses++;
    }
    const p1 = playerMap.get(t.player1Id)!;
    const p2 = playerMap.get(t.player2Id)!;
    return {
      team: t,
      wins,
      losses,
      sumLevel: p1.skillLevel + p2.skillLevel,
      matchCount: Math.max(p1.matchCount, p2.matchCount),
      wait: Math.max(p1.roundsSinceLastPlayed || 0, p2.roundsSinceLastPlayed || 0),
    };
  });

  // Sort: wins DESC (main), losses ASC (tiebreaker), seed DESC (round 1
  // fallback). This matches how Swiss tournaments pair — similar records
  // play each other.
  records.sort((a, b) => {
    if (a.wins !== b.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return b.sumLevel - a.sumLevel;
  });

  const courtsThisRound = Math.min(numCourts, Math.floor(records.length / 2));
  if (courtsThisRound === 0) {
    return {
      round: [],
      cost: 0,
      violations: [],
      sittingOut: players.filter((p) => !p.paused).map((p) => p.id),
    };
  }

  // Pair adjacent teams (1 vs 2, 3 vs 4, ...). Execute the rule.
  const matchesOut: Match[] = [];
  const usedPlayers = new Set<string>();
  for (let i = 0; i + 1 < records.length && matchesOut.length < courtsThisRound; i += 2) {
    const a = records[i];
    const b = records[i + 1];
    matchesOut.push({
      court: matchesOut.length + 1,
      team1: a.team,
      team2: b.team,
    });
    usedPlayers.add(a.team.player1Id);
    usedPlayers.add(a.team.player2Id);
    usedPlayers.add(b.team.player1Id);
    usedPlayers.add(b.team.player2Id);
  }

  const sittingOut = players
    .filter((p) => !p.paused && !usedPlayers.has(p.id))
    .map((p) => p.id);

  // Round-level wait violation.
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

function isSameTeam(ids: [string, string], t: Team): boolean {
  return (
    (ids[0] === t.player1Id && ids[1] === t.player2Id) ||
    (ids[0] === t.player2Id && ids[1] === t.player1Id)
  );
}
