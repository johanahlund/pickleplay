import { prisma } from "@/lib/db";
import { auth, requireAuth, canSeeEmails, stripEmailsDeep } from "@/lib/auth";
import { safePlayerSelect } from "@/lib/playerSelect";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const userId = (session.user as { id?: string }).id;
  const userRole = (session.user as { role?: string }).role;

  const events = await prisma.event.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      classes: true,
      players: { include: { player: { select: safePlayerSelect } } },
      helpers: { include: { player: { select: safePlayerSelect } } },
      club: { select: { id: true, name: true, emoji: true, locations: { select: { id: true, name: true, googleMapsUrl: true } } } },
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

  const allowEmail = await canSeeEmails(userId, userRole);
  return NextResponse.json(allowEmail ? filtered : stripEmailsDeep(filtered));
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const { name, numCourts, format, playerIds, date, endDate, scoringFormat, numSets, scoringType, timedMinutes, pairingMode, playMode, prioSpeed, prioFairness, prioSkill, rankingMode, minPlayers, maxPlayers, clubId } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }

  // Create event
  const event = await prisma.event.create({
    data: {
      name: name.trim(),
      numCourts: numCourts || 2,
      createdById: user.id,
      ...(clubId ? { clubId } : {}),
      ...(date ? { date: new Date(date) } : {}),
      ...(endDate ? { endDate: new Date(endDate) } : {}),
    },
  });

  // Create default "Open" class with format settings
  const cls = await prisma.eventClass.create({
    data: {
      eventId: event.id,
      name: "Open",
      isDefault: true,
      format: format || "doubles",
      ...(scoringFormat ? { scoringFormat } : numSets && scoringType ? { scoringFormat: `${numSets}x${scoringType.replace("normal_", "").replace("rally_", "R")}` } : {}),
      ...(timedMinutes !== undefined && timedMinutes !== null ? { timedMinutes } : {}),
      ...(pairingMode ? { pairingMode } : {}),
      ...(playMode ? { playMode } : {}),
      ...(prioSpeed !== undefined ? { prioSpeed } : {}),
      ...(prioFairness !== undefined ? { prioFairness } : {}),
      ...(prioSkill !== undefined ? { prioSkill } : {}),
      ...(rankingMode && ["ranked", "approval", "none"].includes(rankingMode) ? { rankingMode } : {}),
      ...(minPlayers !== undefined ? { minPlayers: minPlayers || null } : {}),
      ...(maxPlayers !== undefined ? { maxPlayers: maxPlayers || null } : {}),
    },
  });

  // Add players to both event and class
  for (const pid of (playerIds || [])) {
    await prisma.eventPlayer.create({
      data: { eventId: event.id, classId: cls.id, playerId: pid },
    });
  }

  // Return event with class info
  const result = await prisma.event.findUnique({
    where: { id: event.id },
    include: {
      classes: true,
      players: { include: { player: { select: safePlayerSelect } } },
      helpers: { include: { player: { select: safePlayerSelect } } },
    },
  });
  return NextResponse.json(result);
}
