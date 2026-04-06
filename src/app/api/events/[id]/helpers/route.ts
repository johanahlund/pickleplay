import { prisma } from "@/lib/db";
import { requireEventOwner } from "@/lib/auth";
import { NextResponse } from "next/server";

// Add a helper to the event (owner/admin only)
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireEventOwner(id);
  } catch {
    return NextResponse.json({ error: "Only the event owner can add helpers" }, { status: 403 });
  }

  const { playerId } = await req.json();
  if (!playerId) {
    return NextResponse.json({ error: "playerId required" }, { status: 400 });
  }

  const existing = await prisma.eventHelper.findFirst({
    where: { eventId: id, playerId },
  });
  if (existing) {
    return NextResponse.json({ error: "Already a helper" }, { status: 400 });
  }

  await prisma.eventHelper.create({
    data: { eventId: id, playerId },
  });

  return NextResponse.json({ ok: true });
}

// Remove a helper from the event (owner/admin only)
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireEventOwner(id);
  } catch {
    return NextResponse.json({ error: "Only the event owner can remove helpers" }, { status: 403 });
  }

  const { playerId } = await req.json();
  await prisma.eventHelper.deleteMany({
    where: { eventId: id, playerId },
  });

  return NextResponse.json({ ok: true });
}
