/**
 * Simulate the King-of-the-Court fairness-driven algorithm across a range
 * of pool sizes and report match-count distribution + bench rotation.
 *
 * Run with: npx tsx scripts/simulate-king.ts
 *
 * Tries 2/3/4/5 courts × 1/2/3/4 extra-per-court (i.e., 9/10/11/12,
 * 15/18/21/24, 20/24/28/32, 25/30/35/40 players). For each scenario we
 * play 12 rounds with random win/loss outcomes and tabulate:
 *
 *   • match-count spread across players (max - min) — should converge low
 *   • who played most / who played least
 *   • how often each player sat out
 *
 * The goal is to convince ourselves the fairness invariant holds across
 * pool shapes and that bench rotation is even.
 */

import { generateRound } from "../src/lib/solver/generateRound";
import type {
  MatchHistoryEntry,
  PairingSettings,
  SolverInput,
  SolverPlayer,
  SkillLevel,
} from "../src/lib/solver/types";

// Deterministic RNG so the report is reproducible.
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE_SETTINGS: PairingSettings = {
  base: "king",
  teams: "rotating",
  gender: "random",
  skillWindow: Infinity,
  matchCountWindow: Infinity,
  varietyWindow: Infinity,
  maxWaitWindow: Infinity,
};

interface ScenarioResult {
  numCourts: number;
  extraPerCourt: number;
  totalPlayers: number;
  rounds: number;
  matchCounts: number[];
  benchCounts: number[];
  playerNames: string[];
}

function simulate(
  numCourts: number,
  extraPerCourt: number,
  rounds: number,
  seed: number,
): ScenarioResult {
  const rng = mulberry32(seed);
  const totalPlayers = numCourts * 4 + extraPerCourt * numCourts;

  // Build a graded skill distribution: bottom = level 1, top = level 5,
  // roughly even split. This mirrors a realistic mixed-skill pool.
  const players: SolverPlayer[] = Array.from({ length: totalPlayers }, (_, i) => {
    // Map index 0..N-1 → skill levels 5..1 with roughly even buckets.
    const level = (5 - Math.floor((i * 5) / totalPlayers)) as SkillLevel;
    return {
      id: `P${i.toString().padStart(2, "0")}`,
      name: `P${i.toString().padStart(2, "0")}`,
      skillLevel: level,
      gender: null,
      matchCount: 0,
    };
  });
  const playerMap = new Map(players.map((p) => [p.id, p]));

  const history: MatchHistoryEntry[] = [];
  const matchCount = new Map<string, number>();
  const benchCount = new Map<string, number>();
  for (const p of players) {
    matchCount.set(p.id, 0);
    benchCount.set(p.id, 0);
  }

  let prevRoundLast = new Map<string, { courtNum: number; partnerId: string; lost: boolean }>();

  for (let r = 1; r <= rounds; r++) {
    // Build the solver input with fresh roundsSinceLastPlayed and the
    // tiebreak fields the route normally derives.
    const lastPlayedRound = new Map<string, number>();
    for (const h of history) {
      for (const id of [...h.team1Ids, ...h.team2Ids]) {
        lastPlayedRound.set(id, Math.max(lastPlayedRound.get(id) ?? 0, h.round));
      }
    }
    const maxRound = history.reduce((m, h) => Math.max(m, h.round), 0);

    const solverPlayers: SolverPlayer[] = players.map((p) => {
      const lp = lastPlayedRound.get(p.id) ?? 0;
      const last = prevRoundLast.get(p.id);
      return {
        ...p,
        matchCount: matchCount.get(p.id) ?? 0,
        roundsSinceLastPlayed: lp > 0 ? maxRound - lp : 0,
        lostLastRound: last?.lost,
        lastRoundLosingPartnerId: last?.lost ? last.partnerId : undefined,
        lastRoundCourt: last?.courtNum,
      };
    });

    const input: SolverInput = {
      players: solverPlayers,
      numCourts,
      settings: BASE_SETTINGS,
      history,
      locks: [],
    };
    const result = generateRound(input);

    // Track bench for this round.
    for (const id of result.sittingOut) {
      benchCount.set(id, (benchCount.get(id) ?? 0) + 1);
    }

    // Apply outcomes: synthesize a random winner for each match.
    const newLast = new Map<string, { courtNum: number; partnerId: string; lost: boolean }>();
    for (const m of result.round) {
      const team1Ids: [string, string] = [m.team1.player1Id, m.team1.player2Id];
      const team2Ids: [string, string] = [m.team2.player1Id, m.team2.player2Id];
      const team1Wins = rng() < 0.5;
      const winningTeam: 1 | 2 = team1Wins ? 1 : 2;
      history.push({
        round: r,
        courtNum: m.court,
        team1Ids,
        team2Ids,
        winningTeam,
      });
      for (const id of [...team1Ids, ...team2Ids]) {
        matchCount.set(id, (matchCount.get(id) ?? 0) + 1);
      }
      // Record for next round's tiebreak fields.
      const t1Lost = !team1Wins;
      const t2Lost = team1Wins;
      newLast.set(team1Ids[0], { courtNum: m.court, partnerId: team1Ids[1], lost: t1Lost });
      newLast.set(team1Ids[1], { courtNum: m.court, partnerId: team1Ids[0], lost: t1Lost });
      newLast.set(team2Ids[0], { courtNum: m.court, partnerId: team2Ids[1], lost: t2Lost });
      newLast.set(team2Ids[1], { courtNum: m.court, partnerId: team2Ids[0], lost: t2Lost });
    }
    prevRoundLast = newLast;
  }

  // Use playerMap to satisfy linter (verified it has every id).
  void playerMap;

  return {
    numCourts,
    extraPerCourt,
    totalPlayers,
    rounds,
    matchCounts: players.map((p) => matchCount.get(p.id) ?? 0),
    benchCounts: players.map((p) => benchCount.get(p.id) ?? 0),
    playerNames: players.map((p) => p.id),
  };
}

function summarize(r: ScenarioResult): string {
  const sortedMc = [...r.matchCounts].sort((a, b) => a - b);
  const sortedBn = [...r.benchCounts].sort((a, b) => a - b);
  const min = sortedMc[0];
  const max = sortedMc[sortedMc.length - 1];
  const spread = max - min;
  const avg = sortedMc.reduce((s, n) => s + n, 0) / r.matchCounts.length;

  const expectedMatchesPerPlayer =
    r.rounds * (r.numCourts * 4) / r.totalPlayers;

  const lines: string[] = [];
  lines.push(`╭─ ${r.numCourts} courts × ${r.totalPlayers} players (+${r.extraPerCourt}/court bench), ${r.rounds} rounds`);
  lines.push(`│  Match count: min=${min}  max=${max}  spread=${spread}  avg=${avg.toFixed(2)}  (expected ${expectedMatchesPerPlayer.toFixed(2)})`);
  lines.push(`│  Bench: min=${sortedBn[0]}  max=${sortedBn[sortedBn.length - 1]}  spread=${sortedBn[sortedBn.length - 1] - sortedBn[0]}`);

  // Show distribution histogram of match counts.
  const histo = new Map<number, number>();
  for (const c of r.matchCounts) histo.set(c, (histo.get(c) ?? 0) + 1);
  const keys = [...histo.keys()].sort((a, b) => a - b);
  const bars = keys.map((k) => `  ${k}m × ${histo.get(k)}`).join("");
  lines.push(`│  Distribution: ${bars}`);

  // Worst offenders (spread > 1 → flag).
  if (spread > 1) {
    const top = r.playerNames
      .map((name, i) => ({ name, mc: r.matchCounts[i] }))
      .sort((a, b) => b.mc - a.mc)
      .slice(0, 3);
    const bot = r.playerNames
      .map((name, i) => ({ name, mc: r.matchCounts[i] }))
      .sort((a, b) => a.mc - b.mc)
      .slice(0, 3);
    lines.push(`│  ⚠ Most: ${top.map((t) => `${t.name}=${t.mc}`).join(", ")}`);
    lines.push(`│  ⚠ Least: ${bot.map((t) => `${t.name}=${t.mc}`).join(", ")}`);
  }
  lines.push(`╰─`);
  return lines.join("\n");
}

// ───────────────────────────────────────────────────────────────────────────
// Test 2 helper: skewed-skill pool. By default `simulate` builds a graded
// L1..L5 pool. This builds a pool where most players cluster at one level
// and a few outliers anchor the extremes. Used to confirm the fairness
// ejector ignores skill entirely (it should not bias bench to outliers).
function simulateSkewedSkill(
  numCourts: number,
  extraPerCourt: number,
  rounds: number,
  seed: number,
): ScenarioResult {
  const rng = mulberry32(seed);
  const totalPlayers = numCourts * 4 + extraPerCourt * numCourts;
  // Two extremes + bulk at L3: a real "mixed-skill drop-in" shape.
  const players: SolverPlayer[] = Array.from({ length: totalPlayers }, (_, i) => {
    let level: SkillLevel;
    if (i === 0) level = 5;
    else if (i === 1) level = 5;
    else if (i === totalPlayers - 1) level = 1;
    else if (i === totalPlayers - 2) level = 1;
    else level = 3;
    return {
      id: `P${i.toString().padStart(2, "0")}`,
      name: `P${i.toString().padStart(2, "0")}`,
      skillLevel: level,
      gender: null,
      matchCount: 0,
    };
  });
  return runRounds(players, numCourts, extraPerCourt, rounds, rng);
}

// Refactored core loop so we can drive it with different player setups.
function runRounds(
  players: SolverPlayer[],
  numCourts: number,
  extraPerCourt: number,
  rounds: number,
  rng: () => number,
  // Optional: a function that mutates the player array between rounds (e.g.,
  // adding a late-joiner). Called BEFORE each round's solver call. Receives
  // current round number (1-indexed), the player array, the count map, and
  // the offsets map. Mutate in place.
  perRoundHook?: (
    round: number,
    players: SolverPlayer[],
    matchCount: Map<string, number>,
    offsets: Map<string, number>,
  ) => void,
): ScenarioResult {
  const totalPlayers = players.length;
  const history: MatchHistoryEntry[] = [];
  const matchCount = new Map<string, number>();
  const benchCount = new Map<string, number>();
  const offsets = new Map<string, number>(); // matchCountOffset, only used by late-join
  for (const p of players) {
    matchCount.set(p.id, 0);
    benchCount.set(p.id, 0);
  }

  let prevRoundLast = new Map<string, { courtNum: number; partnerId: string; lost: boolean }>();

  for (let r = 1; r <= rounds; r++) {
    if (perRoundHook) perRoundHook(r, players, matchCount, offsets);

    const lastPlayedRound = new Map<string, number>();
    for (const h of history) {
      for (const id of [...h.team1Ids, ...h.team2Ids]) {
        lastPlayedRound.set(id, Math.max(lastPlayedRound.get(id) ?? 0, h.round));
      }
    }
    const maxRound = history.reduce((m, h) => Math.max(m, h.round), 0);

    const solverPlayers: SolverPlayer[] = players.map((p) => {
      const lp = lastPlayedRound.get(p.id) ?? 0;
      const last = prevRoundLast.get(p.id);
      const off = offsets.get(p.id) ?? 0;
      return {
        ...p,
        matchCount: (matchCount.get(p.id) ?? 0) + off,
        roundsSinceLastPlayed: lp > 0 ? maxRound - lp : 0,
        lostLastRound: last?.lost,
        lastRoundLosingPartnerId: last?.lost ? last.partnerId : undefined,
        lastRoundCourt: last?.courtNum,
      };
    });

    const input: SolverInput = {
      players: solverPlayers,
      numCourts,
      settings: BASE_SETTINGS,
      history,
      locks: [],
    };
    const result = generateRound(input);

    for (const id of result.sittingOut) {
      benchCount.set(id, (benchCount.get(id) ?? 0) + 1);
    }

    const newLast = new Map<string, { courtNum: number; partnerId: string; lost: boolean }>();
    for (const m of result.round) {
      const team1Ids: [string, string] = [m.team1.player1Id, m.team1.player2Id];
      const team2Ids: [string, string] = [m.team2.player1Id, m.team2.player2Id];
      const team1Wins = rng() < 0.5;
      const winningTeam: 1 | 2 = team1Wins ? 1 : 2;
      history.push({ round: r, courtNum: m.court, team1Ids, team2Ids, winningTeam });
      for (const id of [...team1Ids, ...team2Ids]) {
        matchCount.set(id, (matchCount.get(id) ?? 0) + 1);
      }
      const t1Lost = !team1Wins;
      const t2Lost = team1Wins;
      newLast.set(team1Ids[0], { courtNum: m.court, partnerId: team1Ids[1], lost: t1Lost });
      newLast.set(team1Ids[1], { courtNum: m.court, partnerId: team1Ids[0], lost: t1Lost });
      newLast.set(team2Ids[0], { courtNum: m.court, partnerId: team2Ids[1], lost: t2Lost });
      newLast.set(team2Ids[1], { courtNum: m.court, partnerId: team2Ids[0], lost: t2Lost });
    }
    prevRoundLast = newLast;
  }

  // Effective counts include matchCountOffset (for late joiners).
  const effective = players.map((p) => (matchCount.get(p.id) ?? 0) + (offsets.get(p.id) ?? 0));

  return {
    numCourts,
    extraPerCourt,
    totalPlayers,
    rounds,
    matchCounts: effective,
    benchCounts: players.map((p) => benchCount.get(p.id) ?? 0),
    playerNames: players.map((p) => p.id),
  };
}

// Test 3: late joiner. Pool starts smaller; mid-event, a new player joins
// with matchCountOffset = round(avg-of-others) so they don't get hammered
// with catch-up games. We verify they're integrated cleanly and the
// effective-count spread stays ±1.
function simulateLateJoiner(
  numCourts: number,
  extraPerCourt: number,
  rounds: number,
  seed: number,
  joinAtRound: number,
): ScenarioResult {
  const rng = mulberry32(seed);
  const totalPlayers = numCourts * 4 + extraPerCourt * numCourts;
  // Start with one fewer player; the joiner appears at joinAtRound with a
  // fresh ID and offset computed from running average.
  const players: SolverPlayer[] = Array.from({ length: totalPlayers - 1 }, (_, i) => ({
    id: `P${i.toString().padStart(2, "0")}`,
    name: `P${i.toString().padStart(2, "0")}`,
    skillLevel: ((5 - Math.floor((i * 5) / totalPlayers)) || 1) as SkillLevel,
    gender: null,
    matchCount: 0,
  }));

  let joined = false;
  return runRounds(players, numCourts, extraPerCourt, rounds, rng, (round, ps, mc, offs) => {
    if (round === joinAtRound && !joined) {
      joined = true;
      // Compute avg of others' effective count at this moment.
      const sum = [...mc.entries()].reduce((s, [pid, c]) => s + c + (offs.get(pid) ?? 0), 0);
      const avg = ps.length > 0 ? Math.round(sum / ps.length) : 0;
      const newPlayer: SolverPlayer = {
        id: `LATE`,
        name: `LATE`,
        skillLevel: 3 as SkillLevel,
        gender: null,
        matchCount: 0,
      };
      ps.push(newPlayer);
      mc.set("LATE", 0);
      offs.set("LATE", avg);
    }
  });
}

function main(): void {
  const seed = 42;

  // ── Test 1: more rounds, sweep across (courts × extra) ─────────────────
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Test 1: convergence at higher round counts`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  for (const rounds of [12, 24, 50]) {
    let totalOk = 0;
    let totalZero = 0;
    let totalScen = 0;
    for (const courts of [2, 3, 4, 5]) {
      for (const extra of [1, 2, 3, 4]) {
        const r = simulate(courts, extra, rounds, seed);
        const spread = Math.max(...r.matchCounts) - Math.min(...r.matchCounts);
        totalScen++;
        if (spread <= 1) totalOk++;
        if (spread === 0) totalZero++;
      }
    }
    console.log(`  ${rounds.toString().padStart(2)} rounds: ${totalOk}/${totalScen} within ±1, ${totalZero}/${totalScen} at exact parity (spread 0)`);
  }

  // ── Test 2: lopsided skill distribution ─────────────────────────────────
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Test 2: lopsided skill (2× L5 + bulk L3 + 2× L1) — should NOT bias bench by skill`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  const rounds = 24;
  for (const courts of [2, 3, 4, 5]) {
    for (const extra of [1, 2, 3, 4]) {
      const r = simulateSkewedSkill(courts, extra, rounds, seed);
      const mc = r.matchCounts;
      const spread = Math.max(...mc) - Math.min(...mc);
      // Compare top-2 (L5) and bottom-2 (L1) bench rates against the median.
      const top2Bench = r.benchCounts[0] + r.benchCounts[1];
      const bot2Bench = r.benchCounts[r.benchCounts.length - 1] + r.benchCounts[r.benchCounts.length - 2];
      const bulkBench = r.benchCounts.slice(2, -2).reduce((s, n) => s + n, 0) / Math.max(1, r.benchCounts.length - 4);
      console.log(`  ${courts}c · ${r.totalPlayers}p · +${extra}/court · spread=${spread}  L5-avg-bench=${(top2Bench/2).toFixed(1)}  bulk-avg-bench=${bulkBench.toFixed(1)}  L1-avg-bench=${(bot2Bench/2).toFixed(1)}`);
    }
  }

  // ── Test 3: late joiner with matchCountOffset ───────────────────────────
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Test 3: late joiner arrives mid-event with offset = round(avg of others)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  for (const courts of [2, 3, 4, 5]) {
    for (const extra of [1, 2, 3, 4]) {
      const joinAt = 8;
      const r = simulateLateJoiner(courts, extra, 20, seed, joinAt);
      const lateIdx = r.playerNames.findIndex((n) => n === "LATE");
      const lateMc = r.matchCounts[lateIdx];
      const others = r.matchCounts.filter((_, i) => i !== lateIdx);
      const spread = Math.max(...r.matchCounts) - Math.min(...r.matchCounts);
      const otherMin = Math.min(...others);
      const otherMax = Math.max(...others);
      console.log(`  ${courts}c · ${r.totalPlayers}p · +${extra}/court · late joined R${joinAt} → effective=${lateMc} | others ${otherMin}-${otherMax} | overall spread=${spread}`);
    }
  }

  console.log();
}

main();
