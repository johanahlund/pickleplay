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

  const player = await prisma.player.findUnique({ where: { id } });
  if (!player || player.status === "voided") {
    return NextResponse.json({ error: "Player not found" }, { status: 404 });
  }

  await prisma.player.update({
    where: { id },
    data: {
      rating: 1000,
      wins: 0,
      losses: 0,
    },
  });

  return NextResponse.json({ ok: true });
}
