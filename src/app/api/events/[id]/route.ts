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
      players: { include: { player: true } },
      matches: {
        include: { players: { include: { player: true } } },
        orderBy: [{ round: "asc" }, { courtNum: "asc" }],
      },
      helpers: { include: { player: true } },
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

  const { name, numCourts, date, endDate, numSets, scoringType, timedMinutes, pairingMode, rankingMode, openSignup, visibility } = await req.json();

  const data: { name?: string; numCourts?: number; date?: Date; endDate?: Date | null; numSets?: number; scoringType?: string; timedMinutes?: number | null; pairingMode?: string; rankingMode?: string; openSignup?: boolean; visibility?: string } = {};
  if (name !== undefined) {
    if (!name?.trim()) {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }
    data.name = name.trim();
  }
  if (numCourts !== undefined) {
    if (typeof numCourts !== "number" || numCourts < 1) {
      return NextResponse.json(
        { error: "numCourts must be a positive number" },
        { status: 400 }
      );
    }
    data.numCourts = numCourts;
  }
  if (date !== undefined) {
    const parsed = new Date(date);
    if (isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    data.date = parsed;
  }
  if (endDate !== undefined) {
    if (endDate === null) {
      data.endDate = null;
    } else {
      const parsed = new Date(endDate);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Invalid end date" }, { status: 400 });
      }
      data.endDate = parsed;
    }
  }
  if (numSets !== undefined) {
    if (![1, 3].includes(numSets)) {
      return NextResponse.json({ error: "numSets must be 1 or 3" }, { status: 400 });
    }
    data.numSets = numSets;
  }
  if (scoringType !== undefined) {
    const valid = ["normal_11", "normal_15", "rally_21", "timed"];
    if (!valid.includes(scoringType)) {
      return NextResponse.json({ error: "Invalid scoring type" }, { status: 400 });
    }
    data.scoringType = scoringType;
  }
  if (timedMinutes !== undefined) {
    data.timedMinutes = timedMinutes; // null or positive integer
  }
  if (pairingMode !== undefined) {
    const valid = ["random", "skill_balanced", "mixed_gender", "skill_mixed_gender", "king_of_court", "swiss", "manual"];
    if (!valid.includes(pairingMode)) {
      return NextResponse.json({ error: "Invalid pairing mode" }, { status: 400 });
    }
    data.pairingMode = pairingMode;
  }
  if (rankingMode !== undefined) {
    if (!["ranked", "approval", "none"].includes(rankingMode)) {
      return NextResponse.json({ error: "Invalid ranking mode" }, { status: 400 });
    }
    data.rankingMode = rankingMode;
  }
  if (openSignup !== undefined) {
    data.openSignup = !!openSignup;
  }
  if (visibility !== undefined) {
    if (!["visible", "hidden"].includes(visibility)) {
      return NextResponse.json({ error: "Invalid visibility" }, { status: 400 });
    }
    data.visibility = visibility;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No fields to update" },
      { status: 400 }
    );
  }

  const event = await prisma.event.update({
    where: { id },
    data,
    include: {
      players: { include: { player: true } },
      matches: {
        include: { players: { include: { player: true } } },
        orderBy: [{ round: "asc" }, { courtNum: "asc" }],
      },
    },
  });

  return NextResponse.json(event);
}
