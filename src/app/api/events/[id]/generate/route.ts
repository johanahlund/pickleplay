import { prisma } from "@/lib/db";
import { requireEventManager } from "@/lib/auth";
import { NextResponse } from "next/server";
import { generateRounds, PlayerInfo, CompletedMatch } from "@/lib/matchgen";
import { getEventClass } from "@/lib/eventClass";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireEventManager(id);
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const numRounds = Math.max(1, Math.min(20, parseInt(body.numRounds) || 1));

  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      players: { include: { player: true } },
      pairs: true,
      matches: {
        include: { players: true },
        orderBy: [{ round: "asc" }, { courtNum: "asc" }],
      },
    },
  });

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const cls = await getEventClass(id);
  if (!cls) {
    return NextResponse.json({ error: "No class found" }, { status: 404 });
  }

  const format = cls.format as "singles" | "doubles";
  const pairingMode = cls.pairingMode as
    | "random"
    | "skill_balanced"
    | "mixed_gender"
    | "skill_mixed_gender"
    | "king_of_court"
    | "swiss"
    | "manual";

  if (pairingMode === "manual") {
    return NextResponse.json(
      { error: "Manual mode: add matches individually using the + button" },
      { status: 400 }
    );
  }

  const playerInfos: PlayerInfo[] = event.players
    .filter((ep) => ep.status === "registered" || ep.status === "checked_in")
    .map((ep) => ({
      id: ep.player.id,
      name: ep.player.name,
      rating: ep.player.rating,
      gender: ep.player.gender,
    }));

  const minPlayers = format === "singles" ? 2 : 4;
  if (playerInfos.length < minPlayers) {
    return NextResponse.json(
      { error: `Need at least ${minPlayers} players for ${format}` },
      { status: 400 }
    );
  }

  // ── Pair-based generation for doubles ──
  if (format === "doubles" && event.pairs.length >= 2) {
    const playerMap = new Map(playerInfos.map((p) => [p.id, p]));
    const activePairs = event.pairs.filter(
      (pair) => playerMap.has(pair.player1Id) && playerMap.has(pair.player2Id)
    );

    if (activePairs.length >= 2) {
      // Keep all existing matches — new rounds are added on top

      // Shuffle pairs, then pit them against each other
      const matchesPerRound = Math.min(event.numCourts, Math.floor(activePairs.length / 2));
      const pairGamesPlayed = new Map<string, number>();
      const pairOpponentCount = new Map<string, number>();
      activePairs.forEach((p) => pairGamesPlayed.set(p.id, 0));

      const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);
      const allRounds: { court: number; pair1Id: string; pair2Id: string }[][] = [];

      for (let r = 0; r < numRounds; r++) {
        // Sort pairs by games played (fairness), then shuffle ties
        const available = [...activePairs].sort((a, b) => {
          const diff = (pairGamesPlayed.get(a.id) || 0) - (pairGamesPlayed.get(b.id) || 0);
          return diff !== 0 ? diff : Math.random() - 0.5;
        });

        const roundMatches: { court: number; pair1Id: string; pair2Id: string }[] = [];
        const usedThisRound = new Set<string>();

        for (let court = 0; court < matchesPerRound; court++) {
          const pool = available.filter((p) => !usedThisRound.has(p.id));
          if (pool.length < 2) break;

          // Pick best matchup (minimize repeat opponents)
          let best = [pool[0], pool[1]];
          let bestScore = Infinity;
          const limit = Math.min(pool.length, 6);

          for (let i = 0; i < limit; i++) {
            for (let j = i + 1; j < limit; j++) {
              const repeats = pairOpponentCount.get(pairKey(pool[i].id, pool[j].id)) || 0;
              // Also try to balance pair strength
              const p1Strength = (playerMap.get(pool[i].player1Id)?.rating || 1000) + (playerMap.get(pool[i].player2Id)?.rating || 1000);
              const p2Strength = (playerMap.get(pool[j].player1Id)?.rating || 1000) + (playerMap.get(pool[j].player2Id)?.rating || 1000);
              const strengthDiff = Math.abs(p1Strength - p2Strength);
              const score = repeats * 1000 + strengthDiff * 0.5;
              if (score < bestScore) {
                bestScore = score;
                best = [pool[i], pool[j]];
              }
            }
          }

          usedThisRound.add(best[0].id);
          usedThisRound.add(best[1].id);
          pairGamesPlayed.set(best[0].id, (pairGamesPlayed.get(best[0].id) || 0) + 1);
          pairGamesPlayed.set(best[1].id, (pairGamesPlayed.get(best[1].id) || 0) + 1);
          pairOpponentCount.set(pairKey(best[0].id, best[1].id), (pairOpponentCount.get(pairKey(best[0].id, best[1].id)) || 0) + 1);

          roundMatches.push({ court: court + 1, pair1Id: best[0].id, pair2Id: best[1].id });
        }

        if (roundMatches.length > 0) allRounds.push(roundMatches);
      }

      // Save matches
      const pairMap = new Map(activePairs.map((p) => [p.id, p]));
      for (let roundIdx = 0; roundIdx < allRounds.length; roundIdx++) {
        for (const match of allRounds[roundIdx]) {
          const pair1 = pairMap.get(match.pair1Id)!;
          const pair2 = pairMap.get(match.pair2Id)!;
          await prisma.match.create({
            data: {
              eventId: id,
              classId: cls.id,
              courtNum: match.court,
              round: roundIdx + 1,
              rankingMode: cls.rankingMode,
              players: {
                create: [
                  { playerId: pair1.player1Id, team: 1 },
                  { playerId: pair1.player2Id, team: 1 },
                  { playerId: pair2.player1Id, team: 2 },
                  { playerId: pair2.player2Id, team: 2 },
                ],
              },
            },
          });
        }
      }

      await prisma.event.update({ where: { id }, data: { status: "active" } });

      return NextResponse.json({
        rounds: allRounds.length,
        matchesPerRound: allRounds[0]?.length || 0,
        totalMatches: allRounds.reduce((s, r) => s + r.length, 0),
        usedPairs: true,
      });
    }
  }

  const isIncremental = pairingMode === "king_of_court" || pairingMode === "swiss";

  // For incremental modes, get completed matches for algorithm input
  let completedMatches: CompletedMatch[] = [];
  let nextRound = 1;

  if (isIncremental) {
    completedMatches = event.matches
      .filter((m) => m.status === "completed")
      .map((m) => ({
        id: m.id,
        round: m.round,
        courtNum: m.courtNum,
        players: m.players.map((p) => ({
          playerId: p.playerId,
          team: p.team,
          score: p.score,
        })),
      }));

    // Find the next round number
    const maxRound = event.matches.length > 0
      ? Math.max(...event.matches.map((m) => m.round))
      : 0;

    // If there are pending/active matches in the current max round, don't generate
    const hasUnfinished = event.matches.some(
      (m) => m.round === maxRound && m.status !== "completed"
    );
    if (hasUnfinished && maxRound > 0) {
      return NextResponse.json(
        { error: "Complete all current matches before generating next round" },
        { status: 400 }
      );
    }

    nextRound = maxRound + 1;
  } else {
    // Keep all existing matches — new rounds are added on top
    const maxRound = event.matches.length > 0
      ? Math.max(...event.matches.map((m) => m.round))
      : 0;
    nextRound = maxRound + 1;
  }

  const rounds = generateRounds(
    playerInfos,
    event.numCourts,
    format,
    pairingMode,
    completedMatches,
    numRounds
  );

  if (rounds.length === 0) {
    return NextResponse.json(
      { error: "Could not generate any matches with current players" },
      { status: 400 }
    );
  }

  // Save matches to DB
  for (let roundIdx = 0; roundIdx < rounds.length; roundIdx++) {
    for (const match of rounds[roundIdx]) {
      await prisma.match.create({
        data: {
          eventId: id,
          classId: cls.id,
          courtNum: match.court,
          round: nextRound + roundIdx,
          rankingMode: cls.rankingMode,
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
