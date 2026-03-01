import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { NextResponse } from "next/server";

// Admin swaps a player in an unscored match
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }

  const { id } = await params;
  const { oldPlayerId, newPlayerId } = await req.json();

  if (!oldPlayerId || !newPlayerId) {
    return NextResponse.json({ error: "oldPlayerId and newPlayerId required" }, { status: 400 });
  }

  const match = await prisma.match.findUnique({
    where: { id },
    include: { players: true },
  });

  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  if (match.status === "completed") {
    return NextResponse.json({ error: "Cannot modify completed match" }, { status: 400 });
  }

  // Check new player not already in this match
  if (match.players.some((p) => p.playerId === newPlayerId)) {
    return NextResponse.json({ error: "Player already in this match" }, { status: 400 });
  }

  // Find the matchPlayer to update
  const matchPlayer = match.players.find((p) => p.playerId === oldPlayerId);
  if (!matchPlayer) {
    return NextResponse.json({ error: "Player not in this match" }, { status: 404 });
  }

  await prisma.matchPlayer.update({
    where: { id: matchPlayer.id },
    data: { playerId: newPlayerId },
  });

  return NextResponse.json({ ok: true });
}

// Admin deletes a match (only pending/active, not completed)
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }

  const { id } = await params;

  const match = await prisma.match.findUnique({ where: { id } });
  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  if (match.status === "completed") {
    return NextResponse.json({ error: "Cannot delete completed match. Use event reset instead." }, { status: 400 });
  }

  await prisma.match.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
