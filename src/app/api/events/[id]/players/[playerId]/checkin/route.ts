import { prisma } from "@/lib/db";
import { requireEventManager } from "@/lib/auth";
import { NextResponse } from "next/server";

// Check a player in (confirm they're physically present)
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; playerId: string }> }
) {
  const { id, playerId } = await params;
  try {
    await requireEventManager(id);
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const ep = await prisma.eventPlayer.findFirst({
    where: { eventId: id, playerId },
  });

  if (!ep) {
    return NextResponse.json({ error: "Player not in event" }, { status: 404 });
  }

  if (ep.status === "waitlisted") {
    return NextResponse.json({ error: "Player is on waitlist — promote them first" }, { status: 400 });
  }

  const newStatus = ep.status === "checked_in" ? "registered" : "checked_in";

  let matchCountOffset = 0;
  if (newStatus === "checked_in") {
    // Late joiner support: calculate current average match count across all
    // checked-in players so the solver treats this player fairly.
    const classId = ep.classId;
    if (classId) {
      const allMatches = await prisma.match.findMany({
        where: { eventId: id, classId, status: { in: ["completed", "pending"] } },
        select: { players: { select: { playerId: true } } },
      });
      const checkedInPlayers = await prisma.eventPlayer.findMany({
        where: { eventId: id, classId, status: "checked_in" },
        select: { playerId: true },
      });
      const checkedInIds = new Set(checkedInPlayers.map((p) => p.playerId));
      if (checkedInIds.size > 0) {
        const counts = new Map<string, number>();
        for (const m of allMatches) {
          for (const p of m.players) {
            if (checkedInIds.has(p.playerId)) {
              counts.set(p.playerId, (counts.get(p.playerId) || 0) + 1);
            }
          }
        }
        const total = [...checkedInIds].reduce((s, pid) => s + (counts.get(pid) || 0), 0);
        matchCountOffset = Math.round(total / checkedInIds.size);
      }
    }
  }
  // When checking OUT, reset offset to 0.

  const updated = await prisma.eventPlayer.update({
    where: { id: ep.id },
    data: { status: newStatus, matchCountOffset },
  });

  return NextResponse.json({ status: updated.status, matchCountOffset: updated.matchCountOffset });
}
