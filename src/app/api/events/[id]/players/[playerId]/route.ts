import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; playerId: string }> }
) {
  const { id, playerId } = await params;

  const eventPlayer = await prisma.eventPlayer.findUnique({
    where: { eventId_playerId: { eventId: id, playerId } },
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

  await prisma.eventPlayer.delete({
    where: { eventId_playerId: { eventId: id, playerId } },
  });

  return NextResponse.json({ ok: true });
}
