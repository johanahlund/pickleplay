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

  const config = (event.competitionConfig as unknown as CompetitionConfig) ?? DEFAULT_COMPETITION_CONFIG;

  // Build competition pairs
  const competitionPairs: CompetitionPair[] = event.pairs.map((p) => ({
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

  const config = (event.competitionConfig as unknown as CompetitionConfig) ?? DEFAULT_COMPETITION_CONFIG;

  if (body.action === "seed") {
    // Seed pairs into groups
    if (event.pairs.length < config.numGroups * 2) {
      return NextResponse.json(
        { error: `Need at least ${config.numGroups * 2} pairs for ${config.numGroups} groups` },
        { status: 400 }
      );
    }

    const competitionPairs: CompetitionPair[] = event.pairs.map((p) => {
      // For skill_level seeding, use the event player skill levels
      let seed: number | undefined;
      if (config.groupSeeding === "skill_level") {
        const ep1 = event.players.find((ep) => ep.playerId === p.player1Id);
        const ep2 = event.players.find((ep) => ep.playerId === p.player2Id);
        seed = ((ep1?.skillLevel ?? 2) + (ep2?.skillLevel ?? 2));
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
    const competitionPairs: CompetitionPair[] = event.pairs
      .filter((p) => p.groupLabel)
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
            rankingMode: event.rankingMode,
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
      data: { status: "active", competitionPhase: "groups" },
    });

    return NextResponse.json({ ok: true, matchesCreated: totalCreated });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
