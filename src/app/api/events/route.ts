import { prisma } from "@/lib/db";
import { auth, requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const events = await prisma.event.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      players: { include: { player: true } },
      helpers: { include: { player: true } },
      club: { select: { id: true, name: true, emoji: true } },
      _count: { select: { matches: true } },
    },
  });

  // Filter out hidden events unless user is admin, owner, helper, or a player in the event
  const filtered = events.filter((event) => {
    if (event.visibility !== "hidden") return true;
    if (!userId) return false;
    const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";
    if (isAdmin) return true;
    if (event.createdById === userId) return true;
    if (event.helpers.some((h) => h.playerId === userId)) return true;
    if (event.players.some((p) => p.playerId === userId)) return true;
    return false;
  });

  return NextResponse.json(filtered);
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const { name, numCourts, format, playerIds, date, endDate, numSets, scoringType, timedMinutes, pairingMode, rankingMode, minPlayers, maxPlayers, clubId } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }

  const event = await prisma.event.create({
    data: {
      name: name.trim(),
      numCourts: numCourts || 2,
      format: format || "doubles",
      createdById: user.id,
      ...(clubId ? { clubId } : {}),
      ...(date ? { date: new Date(date) } : {}),
      ...(endDate ? { endDate: new Date(endDate) } : {}),
      ...(numSets ? { numSets } : {}),
      ...(scoringType ? { scoringType } : {}),
      ...(timedMinutes !== undefined && timedMinutes !== null ? { timedMinutes } : {}),
      ...(pairingMode ? { pairingMode } : {}),
      ...(rankingMode && ["ranked", "approval", "none"].includes(rankingMode) ? { rankingMode } : {}),
      ...(minPlayers !== undefined ? { minPlayers: minPlayers || null } : {}),
      ...(maxPlayers !== undefined ? { maxPlayers: maxPlayers || null } : {}),
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
