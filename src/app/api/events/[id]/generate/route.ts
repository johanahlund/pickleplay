import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

interface PlayerInfo {
  id: string;
  name: string;
  rating: number;
}

type MatchResult = { court: number; team1: PlayerInfo[]; team2: PlayerInfo[] };

/**
 * Generate round-robin singles matches.
 * Each match is 1v1. Balances opponent freshness and rating closeness.
 */
function generateSinglesRounds(
  players: PlayerInfo[],
  numCourts: number
): MatchResult[][] {
  const n = players.length;
  const matchesPerRound = Math.min(numCourts, Math.floor(n / 2));
  if (matchesPerRound === 0) return [];

  const sorted = [...players].sort((a, b) => b.rating - a.rating);
  const rounds: MatchResult[][] = [];
  const gamesPlayed = new Map<string, number>();
  const opponentCount = new Map<string, number>();
  players.forEach((p) => gamesPlayed.set(p.id, 0));
  const pairKey = (a: string, b: string) =>
    a < b ? `${a}:${b}` : `${b}:${a}`;

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
          const repeats =
            opponentCount.get(pairKey(pool[i].id, pool[j].id)) || 0;
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
      bestPair.forEach((p) =>
        gamesPlayed.set(p.id, (gamesPlayed.get(p.id) || 0) + 1)
      );
      opponentCount.set(
        pairKey(bestPair[0].id, bestPair[1].id),
        (opponentCount.get(pairKey(bestPair[0].id, bestPair[1].id)) || 0) + 1
      );

      roundMatches.push({
        court: court + 1,
        team1: [bestPair[0]],
        team2: [bestPair[1]],
      });
    }

    if (roundMatches.length > 0) {
      rounds.push(roundMatches);
    }
  }

  return rounds;
}

/**
 * Generate round-robin doubles matches.
 * Goal: every player partners with different people and plays against different people.
 * Uses a balanced rotation algorithm.
 */
function generateDoublesRounds(
  players: PlayerInfo[],
  numCourts: number
): MatchResult[][] {
  const n = players.length;
  const playersPerMatch = 4;
  const matchesPerRound = Math.min(numCourts, Math.floor(n / playersPerMatch));

  if (matchesPerRound === 0) return [];

  // Sort by rating for balanced matchmaking
  const sorted = [...players].sort((a, b) => b.rating - a.rating);

  // Track who has played together and against each other
  const partnerCount = new Map<string, number>();
  const opponentCount = new Map<string, number>();
  const pairKey = (a: string, b: string) =>
    a < b ? `${a}:${b}` : `${b}:${a}`;

  const rounds: { court: number; team1: PlayerInfo[]; team2: PlayerInfo[] }[][] = [];
  const gamesPlayed = new Map<string, number>();
  players.forEach((p) => gamesPlayed.set(p.id, 0));

  // Generate enough rounds so everyone plays ~equal games
  const targetRounds = Math.ceil((n - 1) / (matchesPerRound > 1 ? 2 : 1));
  const maxRounds = Math.min(targetRounds, 8); // cap at 8 rounds

  for (let r = 0; r < maxRounds; r++) {
    // Sort players by fewest games played, then shuffle within same count
    const available = [...sorted].sort((a, b) => {
      const diff = (gamesPlayed.get(a.id) || 0) - (gamesPlayed.get(b.id) || 0);
      if (diff !== 0) return diff;
      return Math.random() - 0.5; // shuffle ties
    });

    const roundMatches: {
      court: number;
      team1: PlayerInfo[];
      team2: PlayerInfo[];
    }[] = [];
    const usedThisRound = new Set<string>();

    for (let court = 0; court < matchesPerRound; court++) {
      // Pick 4 players who haven't played this round
      const pool = available.filter((p) => !usedThisRound.has(p.id));
      if (pool.length < 4) break;

      // Try to minimize repeat partnerships
      const fourPlayers = pool.slice(0, 4);

      // Find best team split: minimize difference AND avoid repeat partners
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

        // Rating balance: smaller difference = better
        const t1Rating = t1.reduce((s, p) => s + p.rating, 0);
        const t2Rating = t2.reduce((s, p) => s + p.rating, 0);
        const ratingDiff = Math.abs(t1Rating - t2Rating);

        // Partner freshness: fewer repeats = better
        const t1PartnerRepeats =
          partnerCount.get(pairKey(t1[0].id, t1[1].id)) || 0;
        const t2PartnerRepeats =
          partnerCount.get(pairKey(t2[0].id, t2[1].id)) || 0;

        const score = ratingDiff * 0.3 + (t1PartnerRepeats + t2PartnerRepeats) * 500;

        if (score < bestScore) {
          bestScore = score;
          bestSplit = split;
        }
      }

      const team1 = bestSplit.team1.map((i) => fourPlayers[i]);
      const team2 = bestSplit.team2.map((i) => fourPlayers[i]);

      // Update tracking
      partnerCount.set(
        pairKey(team1[0].id, team1[1].id),
        (partnerCount.get(pairKey(team1[0].id, team1[1].id)) || 0) + 1
      );
      partnerCount.set(
        pairKey(team2[0].id, team2[1].id),
        (partnerCount.get(pairKey(team2[0].id, team2[1].id)) || 0) + 1
      );
      for (const a of team1) {
        for (const b of team2) {
          opponentCount.set(
            pairKey(a.id, b.id),
            (opponentCount.get(pairKey(a.id, b.id)) || 0) + 1
          );
        }
      }

      fourPlayers.forEach((p) => {
        usedThisRound.add(p.id);
        gamesPlayed.set(p.id, (gamesPlayed.get(p.id) || 0) + 1);
      });

      roundMatches.push({ court: court + 1, team1, team2 });
    }

    if (roundMatches.length > 0) {
      rounds.push(roundMatches);
    }
  }

  return rounds;
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      players: { include: { player: true } },
    },
  });

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  // Delete existing matches for this event (regenerate)
  await prisma.match.deleteMany({ where: { eventId: id } });

  const playerInfos: PlayerInfo[] = event.players.map((ep) => ({
    id: ep.player.id,
    name: ep.player.name,
    rating: ep.player.rating,
  }));

  const minPlayers = event.format === "singles" ? 2 : 4;
  if (playerInfos.length < minPlayers) {
    return NextResponse.json(
      { error: `Need at least ${minPlayers} players for ${event.format}` },
      { status: 400 }
    );
  }

  const rounds =
    event.format === "singles"
      ? generateSinglesRounds(playerInfos, event.numCourts)
      : generateDoublesRounds(playerInfos, event.numCourts);

  // Save matches to DB
  for (let roundIdx = 0; roundIdx < rounds.length; roundIdx++) {
    for (const match of rounds[roundIdx]) {
      await prisma.match.create({
        data: {
          eventId: id,
          courtNum: match.court,
          round: roundIdx + 1,
          players: {
            create: [
              ...match.team1.map((p) => ({
                playerId: p.id,
                team: 1,
              })),
              ...match.team2.map((p) => ({
                playerId: p.id,
                team: 2,
              })),
            ],
          },
        },
      });
    }
  }

  // Update event status
  await prisma.event.update({
    where: { id },
    data: { status: "active" },
  });

  return NextResponse.json({
    rounds: rounds.length,
    matchesPerRound: rounds[0]?.length || 0,
    totalMatches: rounds.reduce((s, r) => s + r.length, 0),
  });
}
