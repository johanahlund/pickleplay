import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  const events = await prisma.event.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      players: { include: { player: true } },
      _count: { select: { matches: true } },
    },
  });
  return NextResponse.json(events);
}

export async function POST(req: Request) {
  const { name, numCourts, format, playerIds, date } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }

  const event = await prisma.event.create({
    data: {
      name: name.trim(),
      numCourts: numCourts || 2,
      format: format || "doubles",
      ...(date ? { date: new Date(date) } : {}),
      players: {
        create: (playerIds || []).map((pid: string) => ({
          playerId: pid,
        })),
      },
    },
    include: { players: { include: { player: true } } },
  });
  return NextResponse.json(event);
}
