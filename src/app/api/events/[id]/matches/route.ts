import { prisma } from "@/lib/db";
import { requireEventManager } from "@/lib/auth";
import { safePlayerSelect } from "@/lib/playerSelect";
import { NextResponse } from "next/server";
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
  const { team1PlayerIds, team2PlayerIds, courtNum, matchFormat, rankingMode: matchRankingMode } = await req.json();

  if (!team1PlayerIds?.length || !team2PlayerIds?.length) {
    return NextResponse.json({ error: "Both teams need players" }, { status: 400 });
  }

  const event = await prisma.event.findUnique({
    where: { id },
    include: { matches: { select: { round: true } } },
  });

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const cls = await getEventClass(id);
  if (!cls) {
    return NextResponse.json({ error: "No class found" }, { status: 404 });
  }

  // Manual matches are not part of any round (round = 0 = "Individual")
  const round = 0;

  const match = await prisma.match.create({
    data: {
      eventId: id,
      classId: cls.id,
      courtNum: courtNum || 1,
      round,
      status: "pending",
      rankingMode: matchRankingMode || cls.rankingMode,
      ...(matchFormat ? { matchFormat } : {}),
      players: {
        create: [
          ...team1PlayerIds.map((pid: string) => ({ playerId: pid, team: 1 })),
          ...team2PlayerIds.map((pid: string) => ({ playerId: pid, team: 2 })),
        ],
      },
    },
    include: { players: { include: { player: { select: safePlayerSelect } } } },
  });

  // Set event to active if it was in setup
  if (event.status === "setup") {
    await prisma.event.update({
      where: { id },
      data: { status: "active" },
    });
  }

  return NextResponse.json(match);
}

// PATCH: update an existing match (court, players, format)
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireEventManager(id);
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { matchId, team1PlayerIds, team2PlayerIds, courtNum, matchFormat, rankingMode: matchRankingMode } = await req.json();
  if (!matchId) return NextResponse.json({ error: "matchId required" }, { status: 400 });

  const match = await prisma.match.findUnique({ where: { id: matchId }, include: { players: true } });
  if (!match || match.eventId !== id) return NextResponse.json({ error: "Match not found" }, { status: 404 });

  // Update match fields
  const data: Record<string, unknown> = {};
  if (courtNum !== undefined) data.courtNum = courtNum;
  if (matchFormat !== undefined) data.matchFormat = matchFormat || null;
  if (matchRankingMode !== undefined) data.rankingMode = matchRankingMode;

  if (Object.keys(data).length > 0) {
    await prisma.match.update({ where: { id: matchId }, data });
  }

  // Update players if changed
  if (team1PlayerIds && team2PlayerIds) {
    // Delete existing players and recreate
    await prisma.matchPlayer.deleteMany({ where: { matchId } });
    await prisma.matchPlayer.createMany({
      data: [
        ...team1PlayerIds.map((pid: string) => ({ matchId, playerId: pid, team: 1 })),
        ...team2PlayerIds.map((pid: string) => ({ matchId, playerId: pid, team: 2 })),
      ],
    });
  }

  const updated = await prisma.match.findUnique({
    where: { id: matchId },
    include: { players: { include: { player: { select: safePlayerSelect } } } },
  });

  return NextResponse.json(updated);
}
