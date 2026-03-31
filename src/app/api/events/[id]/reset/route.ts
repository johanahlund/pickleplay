import { prisma } from "@/lib/db";
import { requireEventManager } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireEventManager(id);
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      matches: {
        where: { status: "completed" },
        include: { players: { include: { player: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  // Reverse ELO for each completed match (newest first)
  for (const match of event.matches) {
    if (match.eloChange === 0) continue;

    const team1 = match.players.filter((p) => p.team === 1);
    const team2 = match.players.filter((p) => p.team === 2);
    const team1Score = team1[0]?.score ?? 0;
    const team2Score = team2[0]?.score ?? 0;

    // Determine who won and reverse
    const winners = team1Score > team2Score ? team1 : team2;
    const losers = team1Score > team2Score ? team2 : team1;

    // Reverse: subtract eloChange from winners, add to losers
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

  // Delete ALL matches (including pending/active ones)
  const deleted = await prisma.match.deleteMany({ where: { eventId: id } });

  // Reset event status to setup
  await prisma.event.update({
    where: { id },
    data: { status: "setup" },
  });

  return NextResponse.json({ ok: true, matchesDeleted: deleted.count });
}
