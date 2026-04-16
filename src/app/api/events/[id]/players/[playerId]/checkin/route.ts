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
  const updated = await prisma.eventPlayer.update({
    where: { id: ep.id },
    data: { status: newStatus },
  });

  return NextResponse.json({ status: updated.status });
}
