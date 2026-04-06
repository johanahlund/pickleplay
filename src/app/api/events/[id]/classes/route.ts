import { prisma } from "@/lib/db";
import { requireEventManager } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET: list classes for an event
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const classes = await prisma.eventClass.findMany({
    where: { eventId: id },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(classes);
}

// POST: create a new class (or copy from another)
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireEventManager(id); } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await req.json();
  const { name, format, gender, ageGroup, ageMin, ageMax, skillMin, skillMax, copyFromId } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }

  let data: Record<string, unknown> = {
    eventId: id,
    name: name.trim(),
    isDefault: false,
    format: format || "doubles",
    gender: gender || "open",
    ageGroup: ageGroup || "open",
    ...(ageMin !== undefined ? { ageMin } : {}),
    ...(ageMax !== undefined ? { ageMax } : {}),
    ...(skillMin !== undefined ? { skillMin } : {}),
    ...(skillMax !== undefined ? { skillMax } : {}),
  };

  // Copy competition settings from another class
  if (copyFromId) {
    const source = await prisma.eventClass.findUnique({ where: { id: copyFromId } });
    if (source) {
      data = {
        ...data,
        numSets: source.numSets,
        scoringType: source.scoringType,
        timedMinutes: source.timedMinutes,
        pairingMode: source.pairingMode,
        playMode: source.playMode,
        prioSpeed: source.prioSpeed,
        prioFairness: source.prioFairness,
        prioSkill: source.prioSkill,
        rankingMode: source.rankingMode,
        competitionMode: source.competitionMode,
        competitionConfig: source.competitionConfig ?? undefined,
      };
    }
  }

  const cls = await prisma.eventClass.create({ data: data as Parameters<typeof prisma.eventClass.create>[0]["data"] });
  return NextResponse.json(cls);
}

// DELETE: remove a class
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireEventManager(id); } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { classId } = await req.json();
  if (!classId) return NextResponse.json({ error: "classId required" }, { status: 400 });

  // Don't allow deleting the default class
  const cls = await prisma.eventClass.findUnique({ where: { id: classId } });
  if (!cls) return NextResponse.json({ error: "Class not found" }, { status: 404 });
  if (cls.isDefault) return NextResponse.json({ error: "Cannot delete the default class" }, { status: 400 });

  await prisma.eventClass.delete({ where: { id: classId } });
  return NextResponse.json({ ok: true });
}

// PATCH: copy competition settings from another class
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireEventManager(id); } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { classId, copyFromId } = await req.json();
  if (!classId || !copyFromId) {
    return NextResponse.json({ error: "classId and copyFromId required" }, { status: 400 });
  }

  const source = await prisma.eventClass.findUnique({ where: { id: copyFromId } });
  if (!source) return NextResponse.json({ error: "Source class not found" }, { status: 404 });

  await prisma.eventClass.update({
    where: { id: classId },
    data: {
      numSets: source.numSets,
      scoringType: source.scoringType,
      timedMinutes: source.timedMinutes,
      pairingMode: source.pairingMode,
      playMode: source.playMode,
      prioSpeed: source.prioSpeed,
      prioFairness: source.prioFairness,
      prioSkill: source.prioSkill,
      rankingMode: source.rankingMode,
      competitionMode: source.competitionMode,
      competitionConfig: source.competitionConfig ?? undefined,
    },
  });

  return NextResponse.json({ ok: true });
}
