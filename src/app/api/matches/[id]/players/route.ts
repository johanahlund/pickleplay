import { prisma } from "@/lib/db";
import { requireAdmin, requireScheduleEditor, requireAuth } from "@/lib/auth";
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
  const { id } = await params;

  // Need the match to know its eventId before we can run the gate.
  const match = await prisma.match.findUnique({
    where: { id },
    include: { players: { include: { player: { select: safePlayerSelect } } } },
  });
  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  // Permission: schedule editor (admin / event organizer / league
  // admin / host team captain or vice). Widened from app-admin-only
  // so event organisers don't 403 on their own match-day's matches —
  // the UI surfaces Delete to them and the server must agree.
  try {
    await requireScheduleEditor(match.eventId);
  } catch {
    // Fall back to allowing event helpers too, mirroring
    // requireEventManager-style permissiveness for non-league
    // events. App admin / event organiser is already covered.
    try {
      const user = await requireAuth();
      const helper = user.role === "admin" ? true : !!(await prisma.eventHelper.findFirst({
        where: { eventId: match.eventId, playerId: user.id },
      }));
      if (!helper) {
        return NextResponse.json({ error: "Not authorised to delete this match." }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Login required" }, { status: 401 });
    }
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
