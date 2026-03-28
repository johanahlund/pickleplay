import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; playerId: string }> }
) {
  await requireAdmin();
  const { id, playerId } = await params;

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
