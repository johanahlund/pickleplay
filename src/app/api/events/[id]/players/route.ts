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

  const existing = await prisma.eventPlayer.findFirst({
    where: { eventId: id, playerId },
  });
  if (existing) {
    return NextResponse.json({ error: "Player already in event" }, { status: 400 });
  }

  // Always link to default class
  const cls = await prisma.eventClass.findFirst({ where: { eventId: id, isDefault: true } });

  // Managers can force a status, otherwise auto-determine
  let status = requestedStatus || "registered";
  if (!requestedStatus && cls?.maxPlayers) {
    const players = await prisma.eventPlayer.findMany({ where: { eventId: id }, select: { status: true } });
    const activeCount = players.filter(
      (p) => p.status === "registered" || p.status === "checked_in"
    ).length;
    if (activeCount >= cls.maxPlayers) {
      status = "waitlisted";
    }
  }

  // If event is already underway (has matches), auto check-in the new player
  if (status === "registered") {
    const matchCount = await prisma.match.count({ where: { eventId: id } });
    if (matchCount > 0) {
      status = "checked_in";
    }
  }

  await prisma.eventPlayer.create({
    data: { eventId: id, classId: cls?.id, playerId, status },
  });

  return NextResponse.json({ ok: true, status });
}
