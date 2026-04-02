import { prisma } from "@/lib/db";
import { requireEventManager } from "@/lib/auth";
import { NextResponse } from "next/server";

// Event manager adds a player to the event
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
  const { playerId, status: requestedStatus } = await req.json();

  if (!playerId) {
    return NextResponse.json({ error: "playerId required" }, { status: 400 });
  }

  const existing = await prisma.eventPlayer.findUnique({
    where: { eventId_playerId: { eventId: id, playerId } },
  });
  if (existing) {
    return NextResponse.json({ error: "Player already in event" }, { status: 400 });
  }

  // Managers can force a status, otherwise auto-determine
  let status = requestedStatus || "registered";
  if (!requestedStatus) {
    const event = await prisma.event.findUnique({
      where: { id },
      include: { players: { select: { status: true } } },
    });
    if (event?.maxPlayers) {
      const activeCount = event.players.filter(
        (p) => p.status === "registered" || p.status === "checked_in"
      ).length;
      if (activeCount >= event.maxPlayers) {
        status = "waitlisted";
      }
    }
  }

  await prisma.eventPlayer.create({
    data: { eventId: id, playerId, status },
  });

  return NextResponse.json({ ok: true, status });
}
