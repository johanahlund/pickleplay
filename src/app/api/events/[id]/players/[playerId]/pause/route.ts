import { prisma } from "@/lib/db";
import { requireEventManager } from "@/lib/auth";
import { NextResponse } from "next/server";

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

  const ep = await prisma.eventPlayer.findUnique({
    where: { eventId_playerId: { eventId: id, playerId } },
  });

  if (!ep) {
    return NextResponse.json({ error: "Player not in event" }, { status: 404 });
  }

  const updated = await prisma.eventPlayer.update({
    where: { id: ep.id },
    data: { checkedIn: !ep.checkedIn },
  });

  return NextResponse.json({ checkedIn: updated.checkedIn });
}
