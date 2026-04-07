import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

function getActiveCount(players: { status: string }[]) {
  return players.filter((p) => p.status === "registered" || p.status === "checked_in").length;
}

async function promoteNextWaitlisted(eventId: string) {
  const next = await prisma.eventPlayer.findFirst({
    where: { eventId, status: "waitlisted" },
    orderBy: { joinedAt: "asc" },
  });
  if (next) {
    await prisma.eventPlayer.update({
      where: { id: next.id },
      data: { status: "registered" },
    });
  }
}

// User signs up for event
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try {
    user = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const { id } = await params;

  const event = await prisma.event.findUnique({
    where: { id },
    include: { players: { select: { status: true } } },
  });
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  if (!event.openSignup) {
    return NextResponse.json({ error: "This event is closed — only the organizer can add players" }, { status: 403 });
  }

  const existing = await prisma.eventPlayer.findFirst({
    where: { eventId: id, playerId: user.id },
  });
  if (existing) {
    return NextResponse.json({ error: "Already signed up" }, { status: 400 });
  }

  // Determine status based on capacity
  const cls = await prisma.eventClass.findFirst({ where: { eventId: id, isDefault: true } });
  const activeCount = getActiveCount(event.players);
  const isFull = cls?.maxPlayers !== null && cls?.maxPlayers !== undefined && activeCount >= cls.maxPlayers;
  const status = isFull ? "waitlisted" : "registered";

  await prisma.eventPlayer.create({
    data: { eventId: id, classId: cls?.id, playerId: user.id, status },
  });

  return NextResponse.json({ ok: true, status });
}

// User unsigns from event
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try {
    user = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const { id } = await params;

  const ep = await prisma.eventPlayer.findFirst({
    where: { eventId: id, playerId: user.id },
  });
  if (!ep) {
    return NextResponse.json({ error: "Not signed up" }, { status: 400 });
  }

  // Check user is not in any match for this event
  const inMatch = await prisma.matchPlayer.findFirst({
    where: {
      playerId: user.id,
      match: { eventId: id },
    },
  });
  if (inMatch) {
    return NextResponse.json(
      { error: "Cannot leave: you are registered in a match" },
      { status: 400 }
    );
  }

  const wasActive = ep.status === "registered" || ep.status === "checked_in";

  await prisma.eventPlayer.deleteMany({
    where: { eventId: id, playerId: user.id },
  });

  // If an active player left, promote next waitlisted
  if (wasActive) {
    const evtCls = await prisma.eventClass.findFirst({ where: { eventId: id, isDefault: true } });
    if (evtCls?.maxPlayers) {
      await promoteNextWaitlisted(id);
    }
  }

  return NextResponse.json({ ok: true });
}
