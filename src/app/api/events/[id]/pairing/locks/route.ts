import { prisma } from "@/lib/db";
import { requireEventManager, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

/** GET list, POST create, DELETE remove — manual pair locks for a class. */

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireEventManager(id); } catch (e) { return authErrorResponse(e); }

  const { searchParams } = new URL(req.url);
  const classId = searchParams.get("classId");
  if (!classId) {
    return NextResponse.json({ error: "classId required" }, { status: 400 });
  }

  const locks = await prisma.eventPairLock.findMany({
    where: { eventId: id, classId },
    include: {
      playerA: { select: { id: true, name: true, photoUrl: true } },
      playerB: { select: { id: true, name: true, photoUrl: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(locks);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireEventManager(id); } catch (e) { return authErrorResponse(e); }

  const body = await req.json().catch(() => null) as {
    classId?: string;
    playerAId?: string;
    playerBId?: string;
    note?: string | null;
  } | null;

  if (!body?.classId || !body.playerAId || !body.playerBId) {
    return NextResponse.json({ error: "classId, playerAId, playerBId required" }, { status: 400 });
  }
  if (body.playerAId === body.playerBId) {
    return NextResponse.json({ error: "playerAId and playerBId must differ" }, { status: 400 });
  }

  // Normalize pair order so uniqueness works both ways.
  const [playerAId, playerBId] =
    body.playerAId < body.playerBId
      ? [body.playerAId, body.playerBId]
      : [body.playerBId, body.playerAId];

  const existing = await prisma.eventPairLock.findFirst({
    where: { eventId: id, classId: body.classId, playerAId, playerBId },
  });
  if (existing) return NextResponse.json(existing);

  const lock = await prisma.eventPairLock.create({
    data: {
      eventId: id,
      classId: body.classId,
      playerAId,
      playerBId,
      note: body.note?.trim() || null,
    },
    include: {
      playerA: { select: { id: true, name: true, photoUrl: true } },
      playerB: { select: { id: true, name: true, photoUrl: true } },
    },
  });
  return NextResponse.json(lock);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireEventManager(id); } catch (e) { return authErrorResponse(e); }

  const body = await req.json().catch(() => null) as { lockId?: string } | null;
  if (!body?.lockId) {
    return NextResponse.json({ error: "lockId required" }, { status: 400 });
  }

  // Verify the lock belongs to this event.
  const lock = await prisma.eventPairLock.findUnique({
    where: { id: body.lockId },
    select: { eventId: true },
  });
  if (!lock || lock.eventId !== id) {
    return NextResponse.json({ error: "Lock not found" }, { status: 404 });
  }

  await prisma.eventPairLock.delete({ where: { id: body.lockId } });
  return NextResponse.json({ ok: true });
}
