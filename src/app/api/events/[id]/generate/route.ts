import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { generateRounds, PlayerInfo, CompletedMatch } from "@/lib/matchgen";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const numRounds = Math.max(1, Math.min(20, parseInt(body.numRounds) || 1));

  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      players: { include: { player: true } },
      matches: {
        include: { players: true },
        orderBy: [{ round: "asc" }, { courtNum: "asc" }],
      },
    },
  });

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const format = event.format as "singles" | "doubles";
  const pairingMode = event.pairingMode as
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
    .filter((ep) => ep.checkedIn)
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
    // For non-incremental modes, delete existing matches and start fresh
    await prisma.match.deleteMany({ where: { eventId: id } });
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
          courtNum: match.court,
          round: isIncremental ? nextRound + roundIdx : roundIdx + 1,
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
