import { prisma } from "@/lib/db";
import { requireEventManager } from "@/lib/auth";
import { NextResponse } from "next/server";
import {
  CompetitionConfig,
  DEFAULT_COMPETITION_CONFIG,
  CompetitionPair,
  calculateGroupStandings,
  determineAdvancement,
  seedBracket,
  generateBracketMatches,
} from "@/lib/competition";
import { getEventClass } from "@/lib/eventClass";

// POST: advance from groups to bracket
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
          player1: { select: { id: true, name: true, emoji: true, rating: true, gender: true } },
          player2: { select: { id: true, name: true, emoji: true, rating: true, gender: true } },
        },
      },
      matches: {
        include: { players: true },
      },
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

  // Filter by classId if multi-class
  const classPairs = body.classId ? event.pairs.filter((p: { classId?: string | null }) => p.classId === body.classId) : event.pairs;
  const classMatches = body.classId ? event.matches.filter((m: { classId?: string | null }) => m.classId === body.classId) : event.matches;

  if (body.action === "advance") {
    // Check all group matches are completed
    const groupMatches = classMatches.filter((m: typeof event.matches[0]) => m.groupLabel);
    const incomplete = groupMatches.filter((m) => m.status !== "completed");
    if (incomplete.length > 0) {
      return NextResponse.json(
        { error: `${incomplete.length} group match${incomplete.length !== 1 ? "es" : ""} not yet completed` },
        { status: 400 }
      );
    }

    // Build competition pairs
    const competitionPairs: CompetitionPair[] = classPairs.map((p: typeof event.pairs[0]) => ({
      id: p.id,
      player1Id: p.player1Id,
      player2Id: p.player2Id,
      combinedRating: p.player1.rating + p.player2.rating,
      groupLabel: p.groupLabel,
      seed: p.seed,
    }));

    // Calculate standings per group
    const groupLabels = [...new Set(competitionPairs.map((p) => p.groupLabel).filter(Boolean))] as string[];
    groupLabels.sort();

    const allStandings = groupLabels.map((label) =>
      calculateGroupStandings(competitionPairs, classMatches, label, config.tiebreakers)
    );

    // Determine advancement
    const { upperBracket, lowerBracket } = determineAdvancement(
      allStandings,
      config,
      competitionPairs
    );

    // Seed upper bracket
    const upperSlots = seedBracket(upperBracket, config.bracketSeeding, config.numGroups);
    const upperMatches = generateBracketMatches(upperSlots, "upper", config.upperThirdPlace);

    // Delete existing bracket matches
    await prisma.match.deleteMany({
      where: { eventId: id, bracketStage: { not: null } },
    });

    // Create upper bracket matches
    for (const match of upperMatches) {
      const pair1 = match.pair1Id ? event.pairs.find((p) => p.id === match.pair1Id) : null;
      const pair2 = match.pair2Id ? event.pairs.find((p) => p.id === match.pair2Id) : null;

      const format = config.upperBracketFormats[match.bracketStage.replace("upper_", "")] || null;

      await prisma.match.create({
        data: {
          eventId: id,
          courtNum: 1, // default court, can be reassigned
          round: 0, // bracket matches don't use round numbers
          bracketStage: match.bracketStage,
          bracketPosition: match.position,
          matchFormat: format,
          rankingMode: cls.rankingMode,
          // Only create player entries for matches with known pairs
          ...(pair1 && pair2
            ? {
                players: {
                  create: [
                    { playerId: pair1.player1Id, team: 1 },
                    { playerId: pair1.player2Id, team: 1 },
                    { playerId: pair2.player1Id, team: 2 },
                    { playerId: pair2.player2Id, team: 2 },
                  ],
                },
              }
            : {}),
        },
      });
    }

    // Create lower bracket matches if configured
    if (config.advanceToLower > 0 && lowerBracket.length >= 2) {
      const lowerSlots = seedBracket(lowerBracket, config.bracketSeeding, config.numGroups);
      const lowerMatches = generateBracketMatches(lowerSlots, "lower", config.lowerThirdPlace);

      for (const match of lowerMatches) {
        const pair1 = match.pair1Id ? event.pairs.find((p) => p.id === match.pair1Id) : null;
        const pair2 = match.pair2Id ? event.pairs.find((p) => p.id === match.pair2Id) : null;

        const format = config.lowerBracketFormats[match.bracketStage.replace("lower_", "")] || null;

        await prisma.match.create({
          data: {
            eventId: id,
            courtNum: 1,
            round: 0,
            bracketStage: match.bracketStage,
            bracketPosition: match.position,
            matchFormat: format,
            rankingMode: cls.rankingMode,
            ...(pair1 && pair2
              ? {
                  players: {
                    create: [
                      { playerId: pair1.player1Id, team: 1 },
                      { playerId: pair1.player2Id, team: 1 },
                      { playerId: pair2.player1Id, team: 2 },
                      { playerId: pair2.player2Id, team: 2 },
                    ],
                  },
                }
              : {}),
          },
        });
      }
    }

    await prisma.eventClass.update({
      where: { id: cls.id },
      data: { competitionPhase: "bracket_upper" },
    });

    return NextResponse.json({
      ok: true,
      upperBracket: upperBracket.length,
      lowerBracket: lowerBracket.length,
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
