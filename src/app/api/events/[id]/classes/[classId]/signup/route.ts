import { prisma } from "@/lib/db";
import { requireAuth, requireEventManager } from "@/lib/auth";
import { NextResponse } from "next/server";

// POST: sign up to a class (self or admin-assigned)
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; classId: string }> }
) {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const { id, classId } = await params;
  const body = await req.json().catch(() => ({}));
  const playerId = body.playerId || user.id; // admin can assign others

  // If assigning someone else, require manager
  if (playerId !== user.id) {
    try { await requireEventManager(id); } catch {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
  }

  // Check event exists and is open for signup
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  // Self-signup: check if event allows it
  if (playerId === user.id && !["open"].includes(event.status)) {
    // Allow managers to add even when not open
    try { await requireEventManager(id); } catch {
      return NextResponse.json({ error: "Event is not open for signup" }, { status: 403 });
    }
  }

  // Check class exists
  const cls = await prisma.eventClass.findUnique({ where: { id: classId } });
  if (!cls || cls.eventId !== id) return NextResponse.json({ error: "Class not found" }, { status: 404 });

  // Check max capacity
  if (cls.maxPlayers) {
    const count = await prisma.eventPlayer.count({ where: { classId, status: { in: ["registered", "checked_in"] } } });
    if (count >= cls.maxPlayers) {
      return NextResponse.json({ error: "Class is full" }, { status: 400 });
    }
  }

  // Check if already in this class
  const existing = await prisma.eventPlayer.findFirst({
    where: { eventId: id, playerId, classId },
  });
  if (existing) return NextResponse.json({ error: "Already in this class" }, { status: 400 });

  // Check if player is in the event at all
  const eventPlayer = await prisma.eventPlayer.findFirst({
    where: { eventId: id, playerId },
  });

  if (eventPlayer) {
    // Player already in event but different class — update classId
    // Or if they were in the default class, move them
    if (eventPlayer.classId !== classId) {
      // Create a new entry for this class (player can be in multiple classes)
      await prisma.eventPlayer.create({
        data: { eventId: id, classId, playerId, status: "registered" },
      });
    }
  } else {
    // New to the event — create entry
    await prisma.eventPlayer.create({
      data: { eventId: id, classId, playerId, status: "registered" },
    });
  }

  return NextResponse.json({ ok: true });
}

// DELETE: leave a class
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; classId: string }> }
) {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const { id, classId } = await params;
  const body = await req.json().catch(() => ({}));
  const playerId = body.playerId || user.id;

  if (playerId !== user.id) {
    try { await requireEventManager(id); } catch {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
  }

  // Check if player is in any match for this event
  const inMatch = await prisma.matchPlayer.findFirst({
    where: { playerId, match: { eventId: id, classId } },
  });
  if (inMatch) {
    return NextResponse.json(
      { error: "Cannot remove: player is assigned to a match" },
      { status: 400 }
    );
  }

  // Remove from this class
  await prisma.eventPlayer.deleteMany({
    where: { eventId: id, classId, playerId },
  });

  // Check if player is still in any class for this event
  const remaining = await prisma.eventPlayer.count({
    where: { eventId: id, playerId },
  });

  // If not in any class, they're fully removed from the event
  // (the deleteMany above already handled it)

  return NextResponse.json({ ok: true, remainingClasses: remaining });
}
