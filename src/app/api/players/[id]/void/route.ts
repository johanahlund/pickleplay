import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const player = await prisma.player.findUnique({
    where: { id },
    include: { _count: { select: { matchPlayers: true } } },
  });

  if (!player) {
    return NextResponse.json({ error: "Player not found" }, { status: 404 });
  }

  if (player._count.matchPlayers === 0) {
    // No match data — safe to hard delete
    await prisma.player.delete({ where: { id } });
    return NextResponse.json({ action: "deleted" });
  }

  // Has match data — soft delete (void)
  await prisma.player.update({
    where: { id },
    data: { status: "voided" },
  });

  return NextResponse.json({ action: "voided" });
}
