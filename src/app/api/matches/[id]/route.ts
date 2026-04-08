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
  const { status, scorerId } = body;

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
    if (!["active", "pending"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    data.status = status;
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
