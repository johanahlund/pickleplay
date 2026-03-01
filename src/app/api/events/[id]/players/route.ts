import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { NextResponse } from "next/server";

// Admin adds a player to the event
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
