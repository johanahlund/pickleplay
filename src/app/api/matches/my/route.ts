import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET() {
  let user;
  try {
    user = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const matches = await prisma.match.findMany({
    where: {
      players: { some: { playerId: user.id } },
    },
    orderBy: { createdAt: "desc" },
    include: {
      players: {
        include: { player: { select: { id: true, name: true, emoji: true, photoUrl: true } } },
      },
      event: { select: { id: true, name: true, date: true, clubId: true } },
      class: { select: { format: true } },
    },
  });

  return NextResponse.json(matches);
}
