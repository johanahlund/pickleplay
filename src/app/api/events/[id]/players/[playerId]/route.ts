import { prisma } from "@/lib/db";
import { requireEventManager } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; playerId: string }> }
) {
  const { id, playerId } = await params;
  try {
    await requireEventManager(id);
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const eventPlayer = await prisma.eventPlayer.findFirst({
    where: { eventId: id, playerId },
  });

  if (!eventPlayer) {
    return NextResponse.json(
      { error: "Player not found in event" },
      { status: 404 }
    );
  }

  // Check player is not in any match for this event
  const inMatch = await prisma.matchPlayer.findFirst({
    where: {
      playerId,
      match: { eventId: id },
    },
  });
  if (inMatch) {
    return NextResponse.json(
      { error: "Cannot remove: player is in a match. Delete the match first." },
      { status: 400 }
    );
  }

  const wasActive = eventPlayer.status === "registered" || eventPlayer.status === "checked_in";

  await prisma.eventPlayer.deleteMany({
    where: { eventId: id, playerId },
  });

  // Promote next waitlisted player if an active player was removed
  if (wasActive) {
    const cls = await prisma.eventClass.findFirst({ where: { eventId: id, isDefault: true } });
    if (cls?.maxPlayers) {
      const next = await prisma.eventPlayer.findFirst({
        where: { eventId: id, status: "waitlisted" },
        orderBy: { joinedAt: "asc" },
      });
      if (next) {
        await prisma.eventPlayer.update({
          where: { id: next.id },
          data: { status: "registered" },
        });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
