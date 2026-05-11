import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// PATCH: update match status and/or assign scorer
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await requireAuth();

  const match = await prisma.match.findUnique({
    where: { id },
    include: { event: true, players: true },
  });
  if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });

  const body = await req.json();
  const { status, scorerId, swapWithMatchId } = body;

  // Check authorization: match player, event manager, or app admin
  const isMatchPlayer = match.players.some((p) => p.playerId === user.id);
  const isAdmin = user.role === "admin";
  const isOwner = match.event.createdById === user.id;
  const isHelper = await prisma.eventHelper.findFirst({ where: { eventId: match.eventId, playerId: user.id } });
  const isAuthorized = isMatchPlayer || isAdmin || isOwner || !!isHelper;

  if (!isAuthorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const data: Record<string, unknown> = {};

  if (status) {
    if (!["active", "pending", "paused"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    data.status = status;
    if (status === "active" && !match.startedAt) {
      data.startedAt = new Date();
    }
  }

  if (scorerId !== undefined) {
    data.scorerId = scorerId; // null to unassign

    // Auto-add scorer as event helper if not already
    if (scorerId) {
      const existingHelper = await prisma.eventHelper.findFirst({
        where: { eventId: match.eventId, playerId: scorerId },
      });
      if (!existingHelper) {
        await prisma.eventHelper.create({
          data: { eventId: match.eventId, playerId: scorerId },
        });
      }
    }
  }

  // Queue reorder: swap court+round with another pending match in the
  // same event. Used by the continuous-play queue UI ("move up" / "move
  // down" between two pending matches). Both matches must be pending and
  // in the same event; the caller must be authorised for both (which
  // follows from being an event manager).
  if (typeof swapWithMatchId === "string") {
    if (match.status !== "pending") {
      return NextResponse.json({ error: "Can only reorder pending matches" }, { status: 400 });
    }
    const other = await prisma.match.findUnique({
      where: { id: swapWithMatchId },
      select: { id: true, eventId: true, status: true, courtNum: true, round: true },
    });
    if (!other || other.eventId !== match.eventId) {
      return NextResponse.json({ error: "Other match not found in this event" }, { status: 404 });
    }
    if (other.status !== "pending") {
      return NextResponse.json({ error: "Other match must be pending too" }, { status: 400 });
    }
    if (!isAdmin && !isOwner && !isHelper) {
      return NextResponse.json({ error: "Only event managers can reorder" }, { status: 403 });
    }
    // Two-step swap so the unique (eventId, round, courtNum) won't clash
    // mid-update — first move `match` to a temporary "high" courtNum.
    await prisma.$transaction(async (tx) => {
      const tmpCourt = -1;
      await tx.match.update({ where: { id: match.id }, data: { courtNum: tmpCourt } });
      await tx.match.update({ where: { id: other.id }, data: { courtNum: match.courtNum, round: match.round } });
      await tx.match.update({ where: { id: match.id }, data: { courtNum: other.courtNum, round: other.round } });
    });
    return NextResponse.json({ ok: true });
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await prisma.match.update({
    where: { id },
    data,
    include: { scorer: { select: { id: true, name: true, photoUrl: true } } },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await requireAuth();

  const match = await prisma.match.findUnique({
    where: { id },
    include: { event: true, players: true },
  });
  if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });

  const isAdmin = user.role === "admin";
  const isOwner = match.event.createdById === user.id;
  const isHelper = await prisma.eventHelper.findFirst({ where: { eventId: match.eventId, playerId: user.id } });
  if (!isAdmin && !isOwner && !isHelper) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  await prisma.matchPlayer.deleteMany({ where: { matchId: id } });
  await prisma.match.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
