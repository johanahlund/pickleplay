/**
 * Group stage logic for competitions.
 * - Seeding pairs into groups
 * - Generating round-robin matches
 * - Calculating standings
 */

import { CompetitionPair, GroupStanding, CompetitionConfig } from "./types";

/**
 * Assign pairs to groups using pot-based seeding.
 *
 * Pot seeding (like Champions League):
 * - Sort pairs by strength (rating, skill level, or random)
 * - Put top N pairs in Pot 1, next N in Pot 2, etc. (N = numGroups)
 * - Each group gets one pair from each pot, assigned in snake order
 *
 * This ensures each group has a balanced mix of strong and weak pairs.
 *
 * Returns pairs with groupLabel assigned ("A", "B", "C", ...).
 */
export function seedPairsIntoGroups(
  pairs: CompetitionPair[],
  config: Pick<CompetitionConfig, "numGroups" | "groupSeeding">
): CompetitionPair[] {
  const { numGroups, groupSeeding } = config;

  if (pairs.length === 0 || numGroups < 1) return [];

  // Sort pairs based on seeding mode
  let sorted: CompetitionPair[];
  switch (groupSeeding) {
    case "rating":
      sorted = [...pairs].sort((a, b) => b.combinedRating - a.combinedRating);
      break;
    case "skill_level":
      // Pairs should already have seed assigned (from skill level)
      // Fall back to rating if no seed
      sorted = [...pairs].sort((a, b) => {
        const seedDiff = (b.seed ?? 0) - (a.seed ?? 0);
        return seedDiff !== 0 ? seedDiff : b.combinedRating - a.combinedRating;
      });
      break;
    case "random":
      sorted = [...pairs].sort(() => Math.random() - 0.5);
      break;
    default:
      sorted = [...pairs];
  }

  const groupLabels = Array.from({ length: numGroups }, (_, i) =>
    String.fromCharCode(65 + i)
  ); // "A", "B", "C", ...

  // Pot-based assignment with snake order
  const result: CompetitionPair[] = sorted.map((pair, index) => {
    const potIndex = Math.floor(index / numGroups);
    const positionInPot = index % numGroups;

    // Snake: even pots go left-to-right, odd pots go right-to-left
    const groupIndex =
      potIndex % 2 === 0 ? positionInPot : numGroups - 1 - positionInPot;

    return {
      ...pair,
      groupLabel: groupLabels[groupIndex],
      seed: index + 1,
    };
  });

  return result;
}

/**
 * Generate round-robin matches for a single group.
 *
 * Uses the "circle method" (rotating schedule) to ensure each pair
 * plays every other pair exactly `matchesPerMatchup` times.
 *
 * Returns array of { pair1Id, pair2Id } matchups in round order.
 */
export function generateGroupMatchups(
  groupPairs: CompetitionPair[],
  matchesPerMatchup: number
): { pair1Id: string; pair2Id: string; round: number }[] {
  const n = groupPairs.length;
  if (n < 2) return [];

  const matchups: { pair1Id: string; pair2Id: string; round: number }[] = [];

  // For each repetition of the round-robin
  for (let rep = 0; rep < matchesPerMatchup; rep++) {
    // Circle method: if n is odd, add a "bye" slot
    const teams = [...groupPairs];
    const hasOdd = n % 2 !== 0;
    if (hasOdd) {
      teams.push({ id: "BYE", player1Id: "", player2Id: "", combinedRating: 0 });
    }

    const numTeams = teams.length;
    const numRounds = numTeams - 1;

    // Fix first team, rotate the rest
    for (let round = 0; round < numRounds; round++) {
      const roundNum = rep * numRounds + round + 1;

      for (let i = 0; i < numTeams / 2; i++) {
        const home = i === 0 ? teams[0] : teams[numTeams - i];
        const away = teams[i === 0 ? numTeams - 1 : i];

        // Skip bye matchups
        if (home.id === "BYE" || away.id === "BYE") continue;

        matchups.push({
          pair1Id: home.id,
          pair2Id: away.id,
          round: roundNum,
        });
      }

      // Rotate: move last element to position 1
      const last = teams.pop()!;
      teams.splice(1, 0, last);
    }
  }

  return matchups;
}

/**
 * Calculate group standings from completed matches.
 */
export function calculateGroupStandings(
  groupPairs: CompetitionPair[],
  matches: {
    id: string;
    status: string;
    groupLabel: string | null;
    players: { playerId: string; team: number; score: number }[];
  }[],
  groupLabel: string,
  tiebreakers: CompetitionConfig["tiebreakers"]
): GroupStanding[] {
  // Initialize standings
  const standings = new Map<string, GroupStanding>();
  for (const pair of groupPairs) {
    if (pair.groupLabel !== groupLabel) continue;
    standings.set(pair.id, {
      pairId: pair.id,
      player1Id: pair.player1Id,
      player2Id: pair.player2Id,
      groupLabel,
      played: 0,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDiff: 0,
    });
  }

  // Build a set of player IDs per pair for lookup
  const pairByPlayerId = new Map<string, string>();
  for (const pair of groupPairs) {
    pairByPlayerId.set(pair.player1Id, pair.id);
    pairByPlayerId.set(pair.player2Id, pair.id);
  }

  // Process completed group matches
  const groupMatches = matches.filter(
    (m) => m.groupLabel === groupLabel && m.status === "completed"
  );

  // Head-to-head records for tiebreaking
  const headToHead = new Map<string, number>(); // "pairA:pairB" -> +1 if A beat B

  for (const match of groupMatches) {
    const team1Players = match.players.filter((p) => p.team === 1);
    const team2Players = match.players.filter((p) => p.team === 2);

    const team1Score = team1Players.reduce((s, p) => s + p.score, 0);
    const team2Score = team2Players.reduce((s, p) => s + p.score, 0);

    // Find which pairs are playing
    const pair1Id = team1Players.length > 0 ? pairByPlayerId.get(team1Players[0].playerId) : undefined;
    const pair2Id = team2Players.length > 0 ? pairByPlayerId.get(team2Players[0].playerId) : undefined;

    if (!pair1Id || !pair2Id) continue;

    const s1 = standings.get(pair1Id);
    const s2 = standings.get(pair2Id);
    if (!s1 || !s2) continue;

    s1.played++;
    s2.played++;
    s1.pointsFor += team1Score;
    s1.pointsAgainst += team2Score;
    s2.pointsFor += team2Score;
    s2.pointsAgainst += team1Score;

    if (team1Score > team2Score) {
      s1.wins++;
      s2.losses++;
      headToHead.set(`${pair1Id}:${pair2Id}`, (headToHead.get(`${pair1Id}:${pair2Id}`) || 0) + 1);
      headToHead.set(`${pair2Id}:${pair1Id}`, (headToHead.get(`${pair2Id}:${pair1Id}`) || 0) - 1);
    } else if (team2Score > team1Score) {
      s2.wins++;
      s1.losses++;
      headToHead.set(`${pair2Id}:${pair1Id}`, (headToHead.get(`${pair2Id}:${pair1Id}`) || 0) + 1);
      headToHead.set(`${pair1Id}:${pair2Id}`, (headToHead.get(`${pair1Id}:${pair2Id}`) || 0) - 1);
    }
  }

  // Update point diffs
  for (const s of standings.values()) {
    s.pointDiff = s.pointsFor - s.pointsAgainst;
  }

  // Sort by tiebreaker rules
  const result = [...standings.values()];
  result.sort((a, b) => {
    // Primary: wins
    const winDiff = b.wins - a.wins;
    if (winDiff !== 0) return winDiff;

    // Apply tiebreakers in order
    for (const tb of tiebreakers) {
      switch (tb) {
        case "head_to_head": {
          const h2h = headToHead.get(`${a.pairId}:${b.pairId}`) || 0;
          if (h2h !== 0) return -h2h; // positive = a beat b, so a should rank higher (lower index)
          break;
        }
        case "point_diff": {
          const pdDiff = b.pointDiff - a.pointDiff;
          if (pdDiff !== 0) return pdDiff;
          break;
        }
        case "total_points": {
          const tpDiff = b.pointsFor - a.pointsFor;
          if (tpDiff !== 0) return tpDiff;
          break;
        }
      }
    }

    return 0;
  });

  return result;
}
