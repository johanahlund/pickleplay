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

  try {
  const { name, numCourts, format, playerIds, date, endDate, scoringFormat, numSets, scoringType, timedMinutes, pairingMode, playMode, prioSpeed, prioFairness, prioSkill, rankingMode, minPlayers, maxPlayers, clubId, locationId, skillMin, skillMax, competitionMode } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }

  // If a locationId is provided, verify it belongs to the given club and
  // cap numCourts at the location's configured capacity.
  let effectiveNumCourts = Number(numCourts) || 2;
  if (locationId) {
    const loc = await prisma.clubLocation.findUnique({
      where: { id: locationId },
      select: { clubId: true, numCourts: true },
    });
    if (!loc) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }
    if (clubId && loc.clubId !== clubId) {
      return NextResponse.json({ error: "Location does not belong to the selected club" }, { status: 400 });
    }
    const locCourts = Number(loc.numCourts) || 2;
    const reqCourts = Number(numCourts) || locCourts;
    effectiveNumCourts = Math.min(reqCourts, locCourts);
  }

  // Create event
  const event = await prisma.event.create({
    data: {
      name: name.trim(),
      numCourts: effectiveNumCourts,
      createdById: user.id,
      ...(clubId ? { clubId } : {}),
      ...(locationId ? { locationId } : {}),
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
      ...(skillMin !== undefined && skillMin !== null && skillMin !== "" ? { skillMin: Number(skillMin) } : {}),
      ...(skillMax !== undefined && skillMax !== null && skillMax !== "" ? { skillMax: Number(skillMax) } : {}),
      ...(competitionMode ? { competitionMode } : {}),
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
  } catch (err) {
    console.error("POST /api/events failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create event" },
      { status: 500 },
    );
  }
}
