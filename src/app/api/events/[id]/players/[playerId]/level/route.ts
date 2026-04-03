import { prisma } from "@/lib/db";
import { requireEventManager } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; playerId: string }> }
) {
  const { id, playerId } = await params;
  try {
    await requireEventManager(id);
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { skillLevel } = await req.json();

  if (skillLevel !== null && ![1, 2, 3].includes(skillLevel)) {
    return NextResponse.json({ error: "skillLevel must be 1, 2, 3, or null" }, { status: 400 });
  }

  const ep = await prisma.eventPlayer.findUnique({
    where: { eventId_playerId: { eventId: id, playerId } },
  });
  if (!ep) {
    return NextResponse.json({ error: "Player not in event" }, { status: 404 });
  }

  await prisma.eventPlayer.update({
    where: { id: ep.id },
    data: { skillLevel },
  });

  return NextResponse.json({ ok: true, skillLevel });
}
