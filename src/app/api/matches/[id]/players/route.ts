import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { safePlayerSelect } from "@/lib/playerSelect";
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

// Admin deletes a match — reverses ELO if completed
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

  const match = await prisma.match.findUnique({
    where: { id },
    include: { players: { include: { player: { select: safePlayerSelect } } } },
  });
  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  // If completed, reverse ELO changes before deleting
  if (match.status === "completed" && match.eloChange > 0) {
    const team1 = match.players.filter((p) => p.team === 1);
    const team2 = match.players.filter((p) => p.team === 2);
    const team1Score = team1[0]?.score ?? 0;
    const team2Score = team2[0]?.score ?? 0;
    const winners = team1Score > team2Score ? team1 : team2;
    const losers = team1Score > team2Score ? team2 : team1;

    for (const mp of winners) {
      await prisma.player.update({
        where: { id: mp.playerId },
        data: {
          rating: { decrement: match.eloChange },
          wins: { decrement: 1 },
        },
      });
    }
    for (const mp of losers) {
      await prisma.player.update({
        where: { id: mp.playerId },
        data: {
          rating: { increment: match.eloChange },
          losses: { decrement: 1 },
        },
      });
    }
  }

  await prisma.match.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
