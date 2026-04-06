import { prisma } from "@/lib/db";
import { requireEventManager } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET: list sessions for a competition
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sessions = await prisma.event.findMany({
    where: { parentEventId: id },
    orderBy: { date: "asc" },
    include: {
      _count: { select: { matches: true } },
    },
  });
  return NextResponse.json(sessions);
}

// POST: create a new session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireEventManager(id); } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await req.json();
  const { name, date, endDate, numCourts } = body;

  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

  // Get parent event for defaults
  const parent = await prisma.event.findUnique({ where: { id } });
  if (!parent) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const session = await prisma.event.create({
    data: {
      name: name.trim(),
      date: date ? new Date(date) : new Date(),
      ...(endDate ? { endDate: new Date(endDate) } : {}),
      numCourts: numCourts || parent.numCourts,
      parentEventId: id,
      clubId: parent.clubId,
      createdById: parent.createdById,
      status: "draft",
    },
  });

  return NextResponse.json(session);
}

// DELETE: remove a session
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireEventManager(id); } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { sessionId } = await req.json();
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  // Unlink matches from this session (don't delete them)
  await prisma.match.updateMany({
    where: { sessionId },
    data: { sessionId: null },
  });

  await prisma.event.delete({ where: { id: sessionId } });
  return NextResponse.json({ ok: true });
}
