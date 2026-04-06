import { prisma } from "@/lib/db";
import { requireEventManager } from "@/lib/auth";
import { NextResponse } from "next/server";
import {
  CompetitionConfig,
  DEFAULT_COMPETITION_CONFIG,
  seedPairsIntoGroups,
  generateGroupMatchups,
  calculateGroupStandings,
  CompetitionPair,
} from "@/lib/competition";
import { getEventClass } from "@/lib/eventClass";

// GET: group standings
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      pairs: {
        include: {
          player1: { select: { id: true, name: true, emoji: true, rating: true, gender: true } },
          player2: { select: { id: true, name: true, emoji: true, rating: true, gender: true } },
        },
      },
      matches: {
        where: { groupLabel: { not: null } },
        include: { players: true },
      },
    },
  });

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const url = new URL(_req.url);
  const classId = url.searchParams.get("classId");
  const cls = await getEventClass(id, classId);
  if (!cls) {
    return NextResponse.json({ error: "No class found" }, { status: 404 });
  }

  const config = (cls.competitionConfig as unknown as CompetitionConfig) ?? DEFAULT_COMPETITION_CONFIG;

  // Build competition pairs (filter by classId if multi-class)
  const classPairs = classId ? event.pairs.filter((p) => p.classId === classId) : event.pairs;
  const competitionPairs: CompetitionPair[] = classPairs.map((p) => ({
    id: p.id,
    player1Id: p.player1Id,
    player2Id: p.player2Id,
    combinedRating: p.player1.rating + p.player2.rating,
    groupLabel: p.groupLabel,
    seed: p.seed,
  }));

  // Get unique group labels
  const groupLabels = [...new Set(competitionPairs.map((p) => p.groupLabel).filter(Boolean))] as string[];
  groupLabels.sort();

  // Calculate standings per group
  const standings: Record<string, ReturnType<typeof calculateGroupStandings>> = {};
  for (const label of groupLabels) {
    standings[label] = calculateGroupStandings(
      competitionPairs,
      event.matches,
      label,
      config.tiebreakers
    );
  }

  return NextResponse.json({ standings, groupLabels, config });
}

// POST: seed groups or generate group matches
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

  const body = await req.json();
  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      pairs: {
        include: {
          player1: { select: { id: true, rating: true, gender: true } },
          player2: { select: { id: true, rating: true, gender: true } },
        },
      },
      players: true,
    },
  });

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const cls = await getEventClass(id, body.classId);
  if (!cls) {
    return NextResponse.json({ error: "No class found" }, { status: 404 });
  }

  const config = (cls.competitionConfig as unknown as CompetitionConfig) ?? DEFAULT_COMPETITION_CONFIG;

  // Filter pairs by classId if multi-class
  const classPairs = body.classId ? event.pairs.filter((p: { classId?: string | null }) => p.classId === body.classId) : event.pairs;

  if (body.action === "seed") {
    // Seed pairs into groups
    if (classPairs.length < config.numGroups * 2) {
      return NextResponse.json(
        { error: `Need at least ${config.numGroups * 2} pairs for ${config.numGroups} groups` },
        { status: 400 }
      );
    }

    const competitionPairs: CompetitionPair[] = classPairs.map((p: typeof event.pairs[0]) => {
      const ep1 = event.players.find((ep) => ep.playerId === p.player1Id);
      const ep2 = event.players.find((ep) => ep.playerId === p.player2Id);
      // Pair skill level: both players should have the same level (set from pair row)
      // Use the average, fallback to 2 (mid)
      const lvl1 = ep1?.skillLevel ?? 2;
      const lvl2 = ep2?.skillLevel ?? 2;
      const pairLevel = Math.round((lvl1 + lvl2) / 2);

      let seed: number | undefined;
      if (config.groupSeeding === "skill_level") {
        seed = pairLevel;
      }

      return {
        id: p.id,
        player1Id: p.player1Id,
        player2Id: p.player2Id,
        combinedRating: p.player1.rating + p.player2.rating,
        seed,
      };
    });

    const seeded = seedPairsIntoGroups(competitionPairs, config);

    // Update pairs in DB
    for (const pair of seeded) {
      await prisma.eventPair.update({
        where: { id: pair.id },
        data: { groupLabel: pair.groupLabel, seed: pair.seed },
      });
    }

    return NextResponse.json({ ok: true, groups: seeded.map((p) => ({ id: p.id, group: p.groupLabel, seed: p.seed })) });
  }

  if (body.action === "generate_matches") {
    // Generate round-robin matches for all groups
    const competitionPairs: CompetitionPair[] = classPairs
      .filter((p: typeof event.pairs[0]) => p.groupLabel)
      .map((p) => ({
        id: p.id,
        player1Id: p.player1Id,
        player2Id: p.player2Id,
        combinedRating: p.player1.rating + p.player2.rating,
        groupLabel: p.groupLabel,
        seed: p.seed,
      }));

    // Get unique group labels
    const groupLabels = [...new Set(competitionPairs.map((p) => p.groupLabel).filter(Boolean))] as string[];

    if (groupLabels.length === 0) {
      return NextResponse.json({ error: "No groups assigned. Seed groups first." }, { status: 400 });
    }

    // Delete existing group matches
    await prisma.match.deleteMany({
      where: { eventId: id, groupLabel: { not: null } },
    });

    let totalCreated = 0;
    let globalRound = 0;

    for (const label of groupLabels) {
      const groupPairs = competitionPairs.filter((p) => p.groupLabel === label);
      const matchups = generateGroupMatchups(groupPairs, config.matchesPerMatchup);

      // Determine court assignment
      const assignedCourts = config.groupCourts?.[label];

      for (const matchup of matchups) {
        globalRound = Math.max(globalRound, matchup.round);
        const pair1 = event.pairs.find((p) => p.id === matchup.pair1Id)!;
        const pair2 = event.pairs.find((p) => p.id === matchup.pair2Id)!;

        // Auto-assign court (round-robin within assigned courts, or default)
        const courtNum = assignedCourts
          ? assignedCourts[(totalCreated % assignedCourts.length)]
          : ((totalCreated % event.numCourts) + 1);

        await prisma.match.create({
          data: {
            eventId: id,
            courtNum,
            round: matchup.round,
            groupLabel: label,
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
        totalCreated++;
      }
    }

    await prisma.event.update({
      where: { id },
      data: { status: "active" },
    });
    await prisma.eventClass.update({
      where: { id: cls.id },
      data: { competitionPhase: "groups" },
    });

    return NextResponse.json({ ok: true, matchesCreated: totalCreated });
  }

  if (body.action === "clear") {
    // Clear all group assignments
    await prisma.eventPair.updateMany({
      where: { eventId: id },
      data: { groupLabel: null, seed: null },
    });
    // Delete group matches
    await prisma.match.deleteMany({
      where: { eventId: id, groupLabel: { not: null } },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "move_pair") {
    // Move a pair to a different group
    const { pairId, targetGroup } = body;
    if (!pairId || !targetGroup) {
      return NextResponse.json({ error: "pairId and targetGroup required" }, { status: 400 });
    }
    await prisma.eventPair.update({
      where: { id: pairId },
      data: { groupLabel: targetGroup },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
