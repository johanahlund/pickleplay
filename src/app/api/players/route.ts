import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  const players = await prisma.player.findMany({
    orderBy: { rating: "desc" },
    include: { _count: { select: { matchPlayers: true } } },
  });
  return NextResponse.json(players);
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
