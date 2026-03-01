import { PlayerInfo, MatchResult, CompletedMatch } from "./types";

const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

// ─── RANDOM (existing logic, moved here) ───

function randomSingles(players: PlayerInfo[], numCourts: number): MatchResult[][] {
  const n = players.length;
  const matchesPerRound = Math.min(numCourts, Math.floor(n / 2));
  if (matchesPerRound === 0) return [];

  const sorted = [...players].sort((a, b) => b.rating - a.rating);
  const rounds: MatchResult[][] = [];
  const gamesPlayed = new Map<string, number>();
  const opponentCount = new Map<string, number>();
  players.forEach((p) => gamesPlayed.set(p.id, 0));

  const targetRounds = Math.min(n - 1, 8);

  for (let r = 0; r < targetRounds; r++) {
    const available = [...sorted].sort((a, b) => {
      const diff = (gamesPlayed.get(a.id) || 0) - (gamesPlayed.get(b.id) || 0);
      if (diff !== 0) return diff;
      return Math.random() - 0.5;
    });

    const roundMatches: MatchResult[] = [];
    const usedThisRound = new Set<string>();

    for (let court = 0; court < matchesPerRound; court++) {
      const pool = available.filter((p) => !usedThisRound.has(p.id));
      if (pool.length < 2) break;

      let bestPair = [pool[0], pool[1]];
      let bestScore = Infinity;
      const limit = Math.min(pool.length, 6);

      for (let i = 0; i < limit; i++) {
        for (let j = i + 1; j < limit; j++) {
          const repeats = opponentCount.get(pairKey(pool[i].id, pool[j].id)) || 0;
          const ratingDiff = Math.abs(pool[i].rating - pool[j].rating);
          const score = repeats * 500 + ratingDiff * 0.3;
          if (score < bestScore) {
            bestScore = score;
            bestPair = [pool[i], pool[j]];
          }
        }
      }

      usedThisRound.add(bestPair[0].id);
      usedThisRound.add(bestPair[1].id);
      bestPair.forEach((p) => gamesPlayed.set(p.id, (gamesPlayed.get(p.id) || 0) + 1));
      opponentCount.set(
        pairKey(bestPair[0].id, bestPair[1].id),
        (opponentCount.get(pairKey(bestPair[0].id, bestPair[1].id)) || 0) + 1
      );

      roundMatches.push({ court: court + 1, team1: [bestPair[0]], team2: [bestPair[1]] });
    }

    if (roundMatches.length > 0) rounds.push(roundMatches);
  }

  return rounds;
}

function randomDoubles(players: PlayerInfo[], numCourts: number): MatchResult[][] {
  const n = players.length;
  const matchesPerRound = Math.min(numCourts, Math.floor(n / 4));
  if (matchesPerRound === 0) return [];

  const sorted = [...players].sort((a, b) => b.rating - a.rating);
  const partnerCount = new Map<string, number>();
  const opponentCount = new Map<string, number>();
  const rounds: MatchResult[][] = [];
  const gamesPlayed = new Map<string, number>();
  players.forEach((p) => gamesPlayed.set(p.id, 0));

  const targetRounds = Math.ceil((n - 1) / (matchesPerRound > 1 ? 2 : 1));
  const maxRounds = Math.min(targetRounds, 8);

  for (let r = 0; r < maxRounds; r++) {
    const available = [...sorted].sort((a, b) => {
      const diff = (gamesPlayed.get(a.id) || 0) - (gamesPlayed.get(b.id) || 0);
      if (diff !== 0) return diff;
      return Math.random() - 0.5;
    });

    const roundMatches: MatchResult[] = [];
    const usedThisRound = new Set<string>();

    for (let court = 0; court < matchesPerRound; court++) {
      const pool = available.filter((p) => !usedThisRound.has(p.id));
      if (pool.length < 4) break;

      const fourPlayers = pool.slice(0, 4);
      let bestSplit = { team1: [0, 1], team2: [2, 3] };
      let bestScore = Infinity;

      const splits = [
        { team1: [0, 1], team2: [2, 3] },
        { team1: [0, 2], team2: [1, 3] },
        { team1: [0, 3], team2: [1, 2] },
      ];

      for (const split of splits) {
        const t1 = split.team1.map((i) => fourPlayers[i]);
        const t2 = split.team2.map((i) => fourPlayers[i]);
        const ratingDiff = Math.abs(
          t1.reduce((s, p) => s + p.rating, 0) - t2.reduce((s, p) => s + p.rating, 0)
        );
        const t1Repeats = partnerCount.get(pairKey(t1[0].id, t1[1].id)) || 0;
        const t2Repeats = partnerCount.get(pairKey(t2[0].id, t2[1].id)) || 0;
        const score = ratingDiff * 0.3 + (t1Repeats + t2Repeats) * 500;

        if (score < bestScore) {
          bestScore = score;
          bestSplit = split;
        }
      }

      const team1 = bestSplit.team1.map((i) => fourPlayers[i]);
      const team2 = bestSplit.team2.map((i) => fourPlayers[i]);

      partnerCount.set(pairKey(team1[0].id, team1[1].id), (partnerCount.get(pairKey(team1[0].id, team1[1].id)) || 0) + 1);
      partnerCount.set(pairKey(team2[0].id, team2[1].id), (partnerCount.get(pairKey(team2[0].id, team2[1].id)) || 0) + 1);
      for (const a of team1) {
        for (const b of team2) {
          opponentCount.set(pairKey(a.id, b.id), (opponentCount.get(pairKey(a.id, b.id)) || 0) + 1);
        }
      }
      fourPlayers.forEach((p) => {
        usedThisRound.add(p.id);
        gamesPlayed.set(p.id, (gamesPlayed.get(p.id) || 0) + 1);
      });

      roundMatches.push({ court: court + 1, team1, team2 });
    }

    if (roundMatches.length > 0) rounds.push(roundMatches);
  }

  return rounds;
}

// ─── SKILL BALANCED ───
// Same as random but with much higher weight on ratingDiff (2.0 instead of 0.3)

function skillSingles(players: PlayerInfo[], numCourts: number): MatchResult[][] {
  const n = players.length;
  const matchesPerRound = Math.min(numCourts, Math.floor(n / 2));
  if (matchesPerRound === 0) return [];

  const sorted = [...players].sort((a, b) => b.rating - a.rating);
  const rounds: MatchResult[][] = [];
  const gamesPlayed = new Map<string, number>();
  const opponentCount = new Map<string, number>();
  players.forEach((p) => gamesPlayed.set(p.id, 0));

  const targetRounds = Math.min(n - 1, 8);

  for (let r = 0; r < targetRounds; r++) {
    const available = [...sorted].sort((a, b) => {
      const diff = (gamesPlayed.get(a.id) || 0) - (gamesPlayed.get(b.id) || 0);
      if (diff !== 0) return diff;
      return Math.random() - 0.5;
    });

    const roundMatches: MatchResult[] = [];
    const usedThisRound = new Set<string>();

    for (let court = 0; court < matchesPerRound; court++) {
      const pool = available.filter((p) => !usedThisRound.has(p.id));
      if (pool.length < 2) break;

      let bestPair = [pool[0], pool[1]];
      let bestScore = Infinity;
      const limit = Math.min(pool.length, 8);

      for (let i = 0; i < limit; i++) {
        for (let j = i + 1; j < limit; j++) {
          const repeats = opponentCount.get(pairKey(pool[i].id, pool[j].id)) || 0;
          const ratingDiff = Math.abs(pool[i].rating - pool[j].rating);
          const score = repeats * 500 + ratingDiff * 2.0; // Much higher weight on skill
          if (score < bestScore) {
            bestScore = score;
            bestPair = [pool[i], pool[j]];
          }
        }
      }

      usedThisRound.add(bestPair[0].id);
      usedThisRound.add(bestPair[1].id);
      bestPair.forEach((p) => gamesPlayed.set(p.id, (gamesPlayed.get(p.id) || 0) + 1));
      opponentCount.set(pairKey(bestPair[0].id, bestPair[1].id), (opponentCount.get(pairKey(bestPair[0].id, bestPair[1].id)) || 0) + 1);

      roundMatches.push({ court: court + 1, team1: [bestPair[0]], team2: [bestPair[1]] });
    }

    if (roundMatches.length > 0) rounds.push(roundMatches);
  }

  return rounds;
}

function skillDoubles(players: PlayerInfo[], numCourts: number): MatchResult[][] {
  const n = players.length;
  const matchesPerRound = Math.min(numCourts, Math.floor(n / 4));
  if (matchesPerRound === 0) return [];

  const sorted = [...players].sort((a, b) => b.rating - a.rating);
  const partnerCount = new Map<string, number>();
  const rounds: MatchResult[][] = [];
  const gamesPlayed = new Map<string, number>();
  players.forEach((p) => gamesPlayed.set(p.id, 0));

  const maxRounds = Math.min(Math.ceil((n - 1) / (matchesPerRound > 1 ? 2 : 1)), 8);

  for (let r = 0; r < maxRounds; r++) {
    const available = [...sorted].sort((a, b) => {
      const diff = (gamesPlayed.get(a.id) || 0) - (gamesPlayed.get(b.id) || 0);
      if (diff !== 0) return diff;
      return Math.random() - 0.5;
    });

    const roundMatches: MatchResult[] = [];
    const usedThisRound = new Set<string>();

    for (let court = 0; court < matchesPerRound; court++) {
      const pool = available.filter((p) => !usedThisRound.has(p.id));
      if (pool.length < 4) break;

      const fourPlayers = pool.slice(0, 4);
      let bestSplit = { team1: [0, 1], team2: [2, 3] };
      let bestScore = Infinity;

      for (const split of [
        { team1: [0, 1], team2: [2, 3] },
        { team1: [0, 2], team2: [1, 3] },
        { team1: [0, 3], team2: [1, 2] },
      ]) {
        const t1 = split.team1.map((i) => fourPlayers[i]);
        const t2 = split.team2.map((i) => fourPlayers[i]);
        const ratingDiff = Math.abs(
          t1.reduce((s, p) => s + p.rating, 0) - t2.reduce((s, p) => s + p.rating, 0)
        );
        const t1Repeats = partnerCount.get(pairKey(t1[0].id, t1[1].id)) || 0;
        const t2Repeats = partnerCount.get(pairKey(t2[0].id, t2[1].id)) || 0;
        const score = ratingDiff * 2.0 + (t1Repeats + t2Repeats) * 500; // High weight on skill

        if (score < bestScore) {
          bestScore = score;
          bestSplit = split;
        }
      }

      const team1 = bestSplit.team1.map((i) => fourPlayers[i]);
      const team2 = bestSplit.team2.map((i) => fourPlayers[i]);

      partnerCount.set(pairKey(team1[0].id, team1[1].id), (partnerCount.get(pairKey(team1[0].id, team1[1].id)) || 0) + 1);
      partnerCount.set(pairKey(team2[0].id, team2[1].id), (partnerCount.get(pairKey(team2[0].id, team2[1].id)) || 0) + 1);
      fourPlayers.forEach((p) => {
        usedThisRound.add(p.id);
        gamesPlayed.set(p.id, (gamesPlayed.get(p.id) || 0) + 1);
      });

      roundMatches.push({ court: court + 1, team1, team2 });
    }

    if (roundMatches.length > 0) rounds.push(roundMatches);
  }

  return rounds;
}

// ─── MIXED GENDER ───
// Each doubles team = 1M + 1F. Null-gender players fill either slot. Falls back to random for singles.

function mixedGenderDoubles(players: PlayerInfo[], numCourts: number): MatchResult[][] {
  const males = players.filter((p) => p.gender === "M");
  const females = players.filter((p) => p.gender === "F");
  const wildcards = players.filter((p) => !p.gender || (p.gender !== "M" && p.gender !== "F"));

  // Need 2M + 2F per match (wildcards fill gaps)
  const matchesPerRound = Math.min(numCourts, Math.floor(players.length / 4));
  if (matchesPerRound === 0) return [];

  const rounds: MatchResult[][] = [];
  const gamesPlayed = new Map<string, number>();
  players.forEach((p) => gamesPlayed.set(p.id, 0));

  const maxRounds = Math.min(8, Math.ceil(players.length / 2));

  for (let r = 0; r < maxRounds; r++) {
    const sortByGames = (arr: PlayerInfo[]) =>
      [...arr].sort((a, b) => {
        const diff = (gamesPlayed.get(a.id) || 0) - (gamesPlayed.get(b.id) || 0);
        return diff !== 0 ? diff : Math.random() - 0.5;
      });

    const availM = sortByGames(males);
    const availF = sortByGames(females);
    const availW = sortByGames(wildcards);
    const usedThisRound = new Set<string>();

    const roundMatches: MatchResult[] = [];

    for (let court = 0; court < matchesPerRound; court++) {
      const poolM = availM.filter((p) => !usedThisRound.has(p.id));
      const poolF = availF.filter((p) => !usedThisRound.has(p.id));
      const poolW = availW.filter((p) => !usedThisRound.has(p.id));

      // Need 2 males and 2 females (wildcards fill gaps)
      const team1M: PlayerInfo[] = [];
      const team1F: PlayerInfo[] = [];
      const team2M: PlayerInfo[] = [];
      const team2F: PlayerInfo[] = [];

      // Assign males
      if (poolM.length >= 2) {
        team1M.push(poolM[0]);
        team2M.push(poolM[1]);
      } else if (poolM.length === 1) {
        team1M.push(poolM[0]);
        // Need wildcard for team2 male slot
        if (poolW.length > 0) {
          team2M.push(poolW[0]);
          poolW.splice(0, 1);
        } else break;
      } else {
        // No males, use wildcards
        if (poolW.length >= 2) {
          team1M.push(poolW[0]);
          team2M.push(poolW[1]);
          poolW.splice(0, 2);
        } else break;
      }

      // Assign females
      if (poolF.length >= 2) {
        team1F.push(poolF[0]);
        team2F.push(poolF[1]);
      } else if (poolF.length === 1) {
        team1F.push(poolF[0]);
        if (poolW.length > 0) {
          team2F.push(poolW[0]);
        } else break;
      } else {
        if (poolW.length >= 2) {
          team1F.push(poolW[0]);
          team2F.push(poolW[1]);
        } else break;
      }

      if (team1M.length === 0 || team1F.length === 0 || team2M.length === 0 || team2F.length === 0) break;

      const team1 = [...team1M, ...team1F];
      const team2 = [...team2M, ...team2F];

      [...team1, ...team2].forEach((p) => {
        usedThisRound.add(p.id);
        gamesPlayed.set(p.id, (gamesPlayed.get(p.id) || 0) + 1);
      });

      roundMatches.push({ court: court + 1, team1, team2 });
    }

    if (roundMatches.length > 0) rounds.push(roundMatches);
    else break; // Can't make any more rounds
  }

  return rounds;
}

// ─── SKILL + MIXED GENDER ───
// Combine skill balance + mixed gender constraint

function skillMixedGenderDoubles(players: PlayerInfo[], numCourts: number): MatchResult[][] {
  const males = players.filter((p) => p.gender === "M");
  const females = players.filter((p) => p.gender === "F");
  const wildcards = players.filter((p) => !p.gender || (p.gender !== "M" && p.gender !== "F"));

  const matchesPerRound = Math.min(numCourts, Math.floor(players.length / 4));
  if (matchesPerRound === 0) return [];

  // Sort all by rating
  const sortByRating = (arr: PlayerInfo[]) => [...arr].sort((a, b) => b.rating - a.rating);

  const rounds: MatchResult[][] = [];
  const gamesPlayed = new Map<string, number>();
  players.forEach((p) => gamesPlayed.set(p.id, 0));

  const maxRounds = Math.min(8, Math.ceil(players.length / 2));

  for (let r = 0; r < maxRounds; r++) {
    const sortByGames = (arr: PlayerInfo[]) =>
      sortByRating(arr).sort((a, b) => {
        const diff = (gamesPlayed.get(a.id) || 0) - (gamesPlayed.get(b.id) || 0);
        return diff !== 0 ? diff : 0; // Keep rating order for ties
      });

    const availM = sortByGames(males);
    const availF = sortByGames(females);
    const availW = sortByGames(wildcards);
    const usedThisRound = new Set<string>();
    const roundMatches: MatchResult[] = [];

    for (let court = 0; court < matchesPerRound; court++) {
      const poolM = availM.filter((p) => !usedThisRound.has(p.id));
      const poolF = availF.filter((p) => !usedThisRound.has(p.id));
      const poolW = availW.filter((p) => !usedThisRound.has(p.id));

      // Get available males (real + wildcards) and females (real + wildcards)
      const mSlots = [...poolM, ...poolW];
      const fSlots = [...poolF, ...poolW.filter((w) => !mSlots.slice(0, 2).includes(w))];

      if (mSlots.length < 2 || fSlots.length < 2) break;

      // Pick top 2 males and top 2 females by rating
      const pickedM = mSlots.slice(0, 2);
      const pickedF = fSlots.filter((f) => !pickedM.includes(f)).slice(0, 2);

      if (pickedM.length < 2 || pickedF.length < 2) break;

      // Best split: try both pairings for skill balance
      // Option A: M0+F0 vs M1+F1, Option B: M0+F1 vs M1+F0
      const ratingA = Math.abs((pickedM[0].rating + pickedF[0].rating) - (pickedM[1].rating + pickedF[1].rating));
      const ratingB = Math.abs((pickedM[0].rating + pickedF[1].rating) - (pickedM[1].rating + pickedF[0].rating));

      let team1: PlayerInfo[], team2: PlayerInfo[];
      if (ratingA <= ratingB) {
        team1 = [pickedM[0], pickedF[0]];
        team2 = [pickedM[1], pickedF[1]];
      } else {
        team1 = [pickedM[0], pickedF[1]];
        team2 = [pickedM[1], pickedF[0]];
      }

      [...team1, ...team2].forEach((p) => {
        usedThisRound.add(p.id);
        gamesPlayed.set(p.id, (gamesPlayed.get(p.id) || 0) + 1);
      });

      roundMatches.push({ court: court + 1, team1, team2 });
    }

    if (roundMatches.length > 0) rounds.push(roundMatches);
    else break;
  }

  return rounds;
}

// ─── KING OF COURT ───
// Ranked courts: Court 1 = experts, Court 2 = intermediate, ..., Court N = beginners.
// Round 1: sort by rating (best on Court 1). Next rounds: winners move up, losers move down.
// Generates ONE round at a time based on completed matches.

function kingOfCourtRound(
  players: PlayerInfo[],
  numCourts: number,
  format: "singles" | "doubles",
  completedMatches: CompletedMatch[]
): MatchResult[] {
  const playersPerMatch = format === "singles" ? 2 : 4;
  const matchesPerRound = Math.min(numCourts, Math.floor(players.length / playersPerMatch));
  if (matchesPerRound === 0) return [];

  const playerMap = new Map(players.map((p) => [p.id, p]));

  if (completedMatches.length === 0) {
    // Round 1: sort by rating — best players on Court 1 (experts), worst on highest court (beginners)
    const sorted = [...players].sort((a, b) => b.rating - a.rating);
    const matches: MatchResult[] = [];

    for (let court = 0; court < matchesPerRound; court++) {
      const start = court * playersPerMatch;
      if (start + playersPerMatch > sorted.length) break;

      if (format === "singles") {
        matches.push({
          court: court + 1,
          team1: [sorted[start]],
          team2: [sorted[start + 1]],
        });
      } else {
        matches.push({
          court: court + 1,
          team1: [sorted[start], sorted[start + 1]],
          team2: [sorted[start + 2], sorted[start + 3]],
        });
      }
    }

    return matches;
  }

  // Find latest round's matches
  const maxRound = Math.max(...completedMatches.map((m) => m.round));
  const lastRoundMatches = completedMatches.filter((m) => m.round === maxRound);

  // Determine winners and losers per court
  const courtResults: { courtNum: number; winnerIds: string[]; loserIds: string[] }[] = [];
  const playersInLastRound = new Set<string>();

  for (const match of lastRoundMatches) {
    const team1 = match.players.filter((p) => p.team === 1);
    const team2 = match.players.filter((p) => p.team === 2);
    const team1Score = team1.reduce((s, p) => s + p.score, 0) / (team1.length || 1);
    const team2Score = team2.reduce((s, p) => s + p.score, 0) / (team2.length || 1);

    match.players.forEach((p) => playersInLastRound.add(p.playerId));

    if (team1Score >= team2Score) {
      courtResults.push({
        courtNum: match.courtNum,
        winnerIds: team1.map((p) => p.playerId),
        loserIds: team2.map((p) => p.playerId),
      });
    } else {
      courtResults.push({
        courtNum: match.courtNum,
        winnerIds: team2.map((p) => p.playerId),
        loserIds: team1.map((p) => p.playerId),
      });
    }
  }

  // Build new court assignments
  // courtSlots[courtNum] = list of player IDs assigned to that court
  const courtSlots = new Map<number, string[]>();
  for (let c = 1; c <= matchesPerRound; c++) {
    courtSlots.set(c, []);
  }

  for (const result of courtResults) {
    const court = result.courtNum;

    // Winners move up (lower court number = better), except Court 1 stays
    const winnerDest = court === 1 ? 1 : court - 1;
    // Losers move down (higher court number = worse), except last court stays
    const loserDest = court === matchesPerRound ? matchesPerRound : court + 1;

    for (const id of result.winnerIds) {
      if (winnerDest >= 1 && winnerDest <= matchesPerRound) {
        courtSlots.get(winnerDest)!.push(id);
      }
    }
    for (const id of result.loserIds) {
      if (loserDest >= 1 && loserDest <= matchesPerRound) {
        courtSlots.get(loserDest)!.push(id);
      }
    }
  }

  // Sat-out players fill remaining spots, starting from lowest courts (beginners)
  const satOut = players
    .filter((p) => !playersInLastRound.has(p.id))
    .sort(() => Math.random() - 0.5);
  let satIdx = 0;

  // Fill courts from highest number (beginners) to lowest (experts)
  for (let c = matchesPerRound; c >= 1; c--) {
    const slots = courtSlots.get(c)!;
    while (slots.length < playersPerMatch && satIdx < satOut.length) {
      slots.push(satOut[satIdx++].id);
    }
  }

  // If any court is overfull, move overflow players down
  for (let c = 1; c <= matchesPerRound; c++) {
    const slots = courtSlots.get(c)!;
    while (slots.length > playersPerMatch) {
      const overflow = slots.pop()!;
      // Push to next court down
      if (c < matchesPerRound) {
        courtSlots.get(c + 1)!.push(overflow);
      }
    }
  }

  // Build matches
  const matches: MatchResult[] = [];
  for (let c = 1; c <= matchesPerRound; c++) {
    const ids = courtSlots.get(c)!;
    if (ids.length < playersPerMatch) continue;

    const courtPlayers = ids.slice(0, playersPerMatch).map((id) => playerMap.get(id)!).filter(Boolean);
    if (courtPlayers.length < playersPerMatch) continue;

    if (format === "singles") {
      matches.push({ court: c, team1: [courtPlayers[0]], team2: [courtPlayers[1]] });
    } else {
      matches.push({
        court: c,
        team1: [courtPlayers[0], courtPlayers[1]],
        team2: [courtPlayers[2], courtPlayers[3]],
      });
    }
  }

  return matches;
}

// ─── SWISS ───
// Round 1: seeded by rating. Next rounds: group by W-L record, pair within groups.
// Generates ONE round at a time.

function swissRound(
  players: PlayerInfo[],
  numCourts: number,
  format: "singles" | "doubles",
  completedMatches: CompletedMatch[]
): MatchResult[] {
  const playersPerMatch = format === "singles" ? 2 : 4;
  const matchesPerRound = Math.min(numCourts, Math.floor(players.length / playersPerMatch));
  if (matchesPerRound === 0) return [];

  if (completedMatches.length === 0) {
    // Round 1: seed by rating
    const sorted = [...players].sort((a, b) => b.rating - a.rating);
    const matches: MatchResult[] = [];

    for (let court = 0; court < matchesPerRound; court++) {
      const start = court * playersPerMatch;
      if (start + playersPerMatch > sorted.length) break;

      if (format === "singles") {
        matches.push({ court: court + 1, team1: [sorted[start]], team2: [sorted[start + 1]] });
      } else {
        matches.push({
          court: court + 1,
          team1: [sorted[start], sorted[start + 1]],
          team2: [sorted[start + 2], sorted[start + 3]],
        });
      }
    }

    return matches;
  }

  // Calculate W-L record for each player in this event
  const record = new Map<string, { wins: number; losses: number }>();
  players.forEach((p) => record.set(p.id, { wins: 0, losses: 0 }));

  for (const match of completedMatches) {
    const team1 = match.players.filter((p) => p.team === 1);
    const team2 = match.players.filter((p) => p.team === 2);
    const team1Score = team1.reduce((s, p) => s + p.score, 0) / (team1.length || 1);
    const team2Score = team2.reduce((s, p) => s + p.score, 0) / (team2.length || 1);

    const winnerTeam = team1Score >= team2Score ? team1 : team2;
    const loserTeam = team1Score >= team2Score ? team2 : team1;

    winnerTeam.forEach((p) => {
      const r = record.get(p.playerId);
      if (r) r.wins++;
    });
    loserTeam.forEach((p) => {
      const r = record.get(p.playerId);
      if (r) r.losses++;
    });
  }

  // Sort by record: wins DESC, then losses ASC, then rating DESC
  const sorted = [...players].sort((a, b) => {
    const ra = record.get(a.id)!;
    const rb = record.get(b.id)!;
    const winDiff = rb.wins - ra.wins;
    if (winDiff !== 0) return winDiff;
    const lossDiff = ra.losses - rb.losses;
    if (lossDiff !== 0) return lossDiff;
    return b.rating - a.rating;
  });

  // Pair adjacent players (Swiss pairing)
  const matches: MatchResult[] = [];

  for (let court = 0; court < matchesPerRound; court++) {
    const start = court * playersPerMatch;
    if (start + playersPerMatch > sorted.length) break;

    if (format === "singles") {
      matches.push({ court: court + 1, team1: [sorted[start]], team2: [sorted[start + 1]] });
    } else {
      // For doubles: pair 1st+4th vs 2nd+3rd for balance
      matches.push({
        court: court + 1,
        team1: [sorted[start], sorted[start + 3]],
        team2: [sorted[start + 1], sorted[start + 2]],
      });
    }
  }

  return matches;
}

// ─── EXPORTS ───

export {
  randomSingles,
  randomDoubles,
  skillSingles,
  skillDoubles,
  mixedGenderDoubles,
  skillMixedGenderDoubles,
  kingOfCourtRound,
  swissRound,
};
