import { prisma } from "@/lib/db";
import { requireEventManager } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET: get competition results for an event
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const results = await prisma.competitionResult.findMany({
    where: { eventId: id },
    orderBy: [{ classId: "asc" }, { finalPlacement: "asc" }],
  });
  return NextResponse.json(results);
}

// POST: generate/update competition results from match data
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireEventManager(id); } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      classes: true,
      matches: {
        where: { status: "completed" },
        include: { players: true },
      },
      pairs: true,
    },
  });

  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  let resultsCreated = 0;

  for (const cls of event.classes) {
    if (!cls.competitionMode) continue;

    const classMatches = event.matches.filter((m) => m.classId === cls.id);
    const classPairs = event.pairs.filter((p) => p.classId === cls.id);

    // Build player-pair mapping
    const pairByPlayerId = new Map<string, string>();
    for (const pair of classPairs) {
      pairByPlayerId.set(pair.player1Id, pair.id);
      pairByPlayerId.set(pair.player2Id, pair.id);
    }

    // Track group results per player
    const playerStats = new Map<string, {
      groupLabel?: string;
      groupWins: number;
      groupLosses: number;
      groupPointDiff: number;
      bracketReached?: string;
      bracketLevel?: string;
    }>();

    // Process group matches
    const groupMatches = classMatches.filter((m) => m.groupLabel);
    for (const match of groupMatches) {
      const team1 = match.players.filter((p) => p.team === 1);
      const team2 = match.players.filter((p) => p.team === 2);
      const t1Score = team1.reduce((s, p) => s + p.score, 0);
      const t2Score = team2.reduce((s, p) => s + p.score, 0);
      const t1Won = t1Score > t2Score;

      for (const mp of team1) {
        const stats = playerStats.get(mp.playerId) || { groupWins: 0, groupLosses: 0, groupPointDiff: 0 };
        stats.groupLabel = match.groupLabel || undefined;
        if (t1Won) stats.groupWins++; else stats.groupLosses++;
        stats.groupPointDiff += t1Score - t2Score;
        playerStats.set(mp.playerId, stats);
      }
      for (const mp of team2) {
        const stats = playerStats.get(mp.playerId) || { groupWins: 0, groupLosses: 0, groupPointDiff: 0 };
        stats.groupLabel = match.groupLabel || undefined;
        if (!t1Won) stats.groupWins++; else stats.groupLosses++;
        stats.groupPointDiff += t2Score - t1Score;
        playerStats.set(mp.playerId, stats);
      }
    }

    // Process bracket matches — find how far each player got
    const bracketMatches = classMatches.filter((m) => m.bracketStage);
    const stageOrder = ["r32", "r16", "qf", "sf", "f", "3rd"];
    for (const match of bracketMatches) {
      const prefix = match.bracketStage?.startsWith("upper_") ? "upper" : "lower";
      const stage = match.bracketStage?.replace(`${prefix}_`, "") || "";

      for (const mp of match.players) {
        const stats = playerStats.get(mp.playerId) || { groupWins: 0, groupLosses: 0, groupPointDiff: 0 };
        stats.bracketLevel = prefix;
        const currentIdx = stageOrder.indexOf(stats.bracketReached || "");
        const newIdx = stageOrder.indexOf(stage);
        if (newIdx > currentIdx) stats.bracketReached = stage;
        playerStats.set(mp.playerId, stats);
      }

      // Winner of the final
      if (stage === "f") {
        const team1 = match.players.filter((p) => p.team === 1);
        const team2 = match.players.filter((p) => p.team === 2);
        const t1Score = team1.reduce((s, p) => s + p.score, 0);
        const t2Score = team2.reduce((s, p) => s + p.score, 0);
        const winners = t1Score > t2Score ? team1 : team2;
        for (const mp of winners) {
          const stats = playerStats.get(mp.playerId);
          if (stats) stats.bracketReached = "winner";
        }
      }
    }

    // Calculate group positions
    const groupLabels = [...new Set([...playerStats.values()].map((s) => s.groupLabel).filter(Boolean))];
    const groupPositions = new Map<string, number>();
    for (const label of groupLabels) {
      const groupPlayers = [...playerStats.entries()]
        .filter(([_, s]) => s.groupLabel === label)
        .sort((a, b) => b[1].groupWins - a[1].groupWins || b[1].groupPointDiff - a[1].groupPointDiff);
      groupPlayers.forEach(([pid], idx) => groupPositions.set(`${pid}_${label}`, idx + 1));
    }

    // Calculate final placements from bracket
    const placementMap: Record<string, number> = { winner: 1, f: 2, "3rd": 3, sf: 4, qf: 5, r16: 9, r32: 17 };

    // Upsert results
    for (const [playerId, stats] of playerStats) {
      const pairId = pairByPlayerId.get(playerId);
      const groupPos = stats.groupLabel ? groupPositions.get(`${playerId}_${stats.groupLabel}`) : undefined;
      const finalPlace = stats.bracketReached ? placementMap[stats.bracketReached] : undefined;

      await prisma.competitionResult.upsert({
        where: { eventId_classId_playerId: { eventId: id, classId: cls.id, playerId } },
        create: {
          eventId: id,
          classId: cls.id,
          playerId,
          pairId,
          groupLabel: stats.groupLabel,
          groupPosition: groupPos,
          groupWins: stats.groupWins,
          groupLosses: stats.groupLosses,
          groupPointDiff: stats.groupPointDiff,
          bracketLevel: stats.bracketLevel,
          bracketReached: stats.bracketReached,
          finalPlacement: finalPlace,
        },
        update: {
          pairId,
          groupLabel: stats.groupLabel,
          groupPosition: groupPos,
          groupWins: stats.groupWins,
          groupLosses: stats.groupLosses,
          groupPointDiff: stats.groupPointDiff,
          bracketLevel: stats.bracketLevel,
          bracketReached: stats.bracketReached,
          finalPlacement: finalPlace,
        },
      });
      resultsCreated++;
    }
  }

  return NextResponse.json({ ok: true, resultsCreated });
}
