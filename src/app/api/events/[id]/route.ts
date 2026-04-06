import { prisma } from "@/lib/db";
import { requireEventOwner, requireEventManager } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      classes: true,
      sessions: { orderBy: { date: "asc" } },
      players: { include: { player: true } },
      matches: {
        include: { players: { include: { player: true } } },
        orderBy: [{ round: "asc" }, { courtNum: "asc" }],
      },
      helpers: { include: { player: true } },
      pairs: {
        include: {
          player1: { select: { id: true, name: true, emoji: true, rating: true, gender: true } },
          player2: { select: { id: true, name: true, emoji: true, rating: true, gender: true } },
        },
      },
      createdBy: { select: { id: true, name: true, emoji: true } },
      club: { select: { id: true, name: true, emoji: true, locations: true } },
    },
  });
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  return NextResponse.json(event);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireEventOwner(id);
  } catch {
    return NextResponse.json({ error: "Only the event owner or admin can delete" }, { status: 403 });
  }
  await prisma.event.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    await requireEventManager(id);
  } catch {
    return NextResponse.json({ error: "Not authorized to edit this event" }, { status: 403 });
  }

  const body = await req.json();
  const { name, numCourts, date, endDate, openSignup, visibility } = body;
  const { numSets, scoringType, timedMinutes, pairingMode, rankingMode } = body;

  // Event-level fields
  const eventData: Record<string, unknown> = {};
  if (name !== undefined) {
    if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
    eventData.name = name.trim();
  }
  if (numCourts !== undefined) {
    if (typeof numCourts !== "number" || numCourts < 1) return NextResponse.json({ error: "numCourts must be positive" }, { status: 400 });
    eventData.numCourts = numCourts;
  }
  if (date !== undefined) {
    const parsed = new Date(date);
    if (isNaN(parsed.getTime())) return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    eventData.date = parsed;
  }
  if (endDate !== undefined) {
    eventData.endDate = endDate === null ? null : new Date(endDate);
  }
  if (openSignup !== undefined) eventData.openSignup = !!openSignup;
  if (visibility !== undefined) eventData.visibility = visibility;
  if (body.status !== undefined) eventData.status = body.status;

  // Class-level fields (update default class)
  const classData: Record<string, unknown> = {};
  if (numSets !== undefined) classData.numSets = numSets;
  if (scoringType !== undefined) classData.scoringType = scoringType;
  if (timedMinutes !== undefined) classData.timedMinutes = timedMinutes;
  if (pairingMode !== undefined) classData.pairingMode = pairingMode;
  if (body.playMode !== undefined) classData.playMode = body.playMode;
  if (body.prioSpeed !== undefined) classData.prioSpeed = body.prioSpeed;
  if (body.prioFairness !== undefined) classData.prioFairness = body.prioFairness;
  if (body.prioSkill !== undefined) classData.prioSkill = body.prioSkill;
  if (rankingMode !== undefined) classData.rankingMode = rankingMode;

  const data = eventData; // for backwards compat with the update below

  if (Object.keys(eventData).length === 0 && Object.keys(classData).length === 0) {
    return NextResponse.json(
      { error: "No fields to update" },
      { status: 400 }
    );
  }

  // Update event-level fields
  if (Object.keys(eventData).length > 0) {
    await prisma.event.update({ where: { id }, data: eventData });
  }

  // Update default class fields
  if (Object.keys(classData).length > 0) {
    const defaultClass = await prisma.eventClass.findFirst({
      where: { eventId: id, isDefault: true },
    });
    if (defaultClass) {
      await prisma.eventClass.update({ where: { id: defaultClass.id }, data: classData });
    }
  }

  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      classes: true,
      players: { include: { player: true } },
      matches: {
        include: { players: { include: { player: true } } },
        orderBy: [{ round: "asc" }, { courtNum: "asc" }],
      },
    },
  });

  return NextResponse.json(event);
}
