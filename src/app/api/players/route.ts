import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  const players = await prisma.player.findMany({
    where: { status: "active" },
    orderBy: { rating: "desc" },
    select: {
      id: true,
      name: true,
      emoji: true,
      email: true,
      rating: true,
      wins: true,
      losses: true,
      photoUrl: true,
      passwordHash: true, // only used to derive hasAccount below
      _count: { select: { matchPlayers: true } },
    },
  });

  // Strip passwordHash, add hasAccount flag
  const safe = players.map(({ passwordHash, ...rest }) => ({
    ...rest,
    hasAccount: !!passwordHash,
  }));

  return NextResponse.json(safe);
}

export async function POST(req: Request) {
  const { name, emoji } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }
  const player = await prisma.player.create({
    data: { name: name.trim(), emoji: emoji || "🏓" },
  });
  return NextResponse.json(player);
}
