import { prisma } from "@/lib/db";
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
  await prisma.event.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { name, numCourts, date, numSets, scoringType, timedMinutes, pairingMode } = await req.json();

  const data: { name?: string; numCourts?: number; date?: Date; numSets?: number; scoringType?: string; timedMinutes?: number | null; pairingMode?: string } = {};
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
  if (numSets !== undefined) {
    if (![1, 2, 3].includes(numSets)) {
      return NextResponse.json({ error: "numSets must be 1, 2, or 3" }, { status: 400 });
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
    const valid = ["random", "skill_balanced", "mixed_gender", "skill_mixed_gender", "king_of_court", "swiss"];
    if (!valid.includes(pairingMode)) {
      return NextResponse.json({ error: "Invalid pairing mode" }, { status: 400 });
    }
    data.pairingMode = pairingMode;
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
