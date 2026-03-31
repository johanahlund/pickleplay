import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

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

  // Check event exists
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  // Check if event allows open signup
  if (!event.openSignup) {
    return NextResponse.json({ error: "This event is closed — only the organizer can add players" }, { status: 403 });
  }

  // Check not already signed up
  const existing = await prisma.eventPlayer.findUnique({
    where: { eventId_playerId: { eventId: id, playerId: user.id } },
  });
  if (existing) {
    return NextResponse.json({ error: "Already signed up" }, { status: 400 });
  }

  await prisma.eventPlayer.create({
    data: { eventId: id, playerId: user.id },
  });

  return NextResponse.json({ ok: true });
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

  await prisma.eventPlayer.deleteMany({
    where: { eventId: id, playerId: user.id },
  });

  return NextResponse.json({ ok: true });
}
