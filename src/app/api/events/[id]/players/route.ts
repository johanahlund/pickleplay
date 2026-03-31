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
  const { playerId } = await req.json();

  if (!playerId) {
    return NextResponse.json({ error: "playerId required" }, { status: 400 });
  }

  const existing = await prisma.eventPlayer.findUnique({
    where: { eventId_playerId: { eventId: id, playerId } },
  });
  if (existing) {
    return NextResponse.json({ error: "Player already in event" }, { status: 400 });
  }

  await prisma.eventPlayer.create({
    data: { eventId: id, playerId },
  });

  return NextResponse.json({ ok: true });
}
