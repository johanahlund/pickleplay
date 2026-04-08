import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// PATCH: update match status (start/pause)
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

  const { status } = await req.json();
  if (!status || !["active", "pending"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  // Check authorization: match player, event manager, or app admin
  const isMatchPlayer = match.players.some((p) => p.playerId === user.id);
  const isAdmin = user.role === "admin";
  if (!isMatchPlayer && !isAdmin) {
    // Check if event manager
    const isOwner = match.event.createdById === user.id;
    const isHelper = await prisma.eventHelper.findFirst({ where: { eventId: match.eventId, playerId: user.id } });
    if (!isOwner && !isHelper) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
  }

  await prisma.match.update({ where: { id }, data: { status } });
  return NextResponse.json({ ok: true });
}
