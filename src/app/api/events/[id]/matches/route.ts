import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }

  const { id } = await params;
  const { team1PlayerIds, team2PlayerIds, courtNum } = await req.json();

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

  // Find the current max round, place manual matches in it (or round 1)
  const maxRound = event.matches.length > 0
    ? Math.max(...event.matches.map((m) => m.round))
    : 0;
  const round = Math.max(maxRound, 1);

  const match = await prisma.match.create({
    data: {
      eventId: id,
      courtNum: courtNum || 1,
      round,
      status: "pending",
      players: {
        create: [
          ...team1PlayerIds.map((pid: string) => ({ playerId: pid, team: 1 })),
          ...team2PlayerIds.map((pid: string) => ({ playerId: pid, team: 2 })),
        ],
      },
    },
    include: { players: { include: { player: true } } },
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
