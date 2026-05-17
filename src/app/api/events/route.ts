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

  // The "completed" phase is now derived from start/end dates whenever
  // stored status === "active" — no bulk update needed. Kept here as a
  // historical note: the old code flipped status="active" → "completed"
  // for events past their end date.

  const events = await prisma.event.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      classes: true,
      players: { include: { player: { select: safePlayerSelect } } },
      helpers: { include: { player: { select: safePlayerSelect } } },
      // Event "manager" surfaced on the event list cards — the creator
      // for standalone events, plus helpers list (the same surface used
      // on the detail page).
      createdBy: { select: { id: true, name: true, emoji: true, photoUrl: true } },
      club: { select: { id: true, name: true, shortName: true, emoji: true, logoUrl: true, locations: { select: { id: true, name: true, googleMapsUrl: true } } } },
      _count: { select: { matches: true } },
      // Used by visibility check: league participants (team players/captains,
      // helpers, organizers) can see league-attached events even when those
      // events are still in "setup"/"draft" status.
      round: {
        select: {
          id: true, name: true, roundNumber: true,
          league: {
            select: {
              id: true, name: true, shortName: true, season: true,
              createdById: true, deputyId: true,
              helpers: { select: { playerId: true } },
              teams: { select: { captainId: true, viceCaptainId: true, players: { select: { playerId: true } } } },
            },
          },
        },
      },
      // Safe subset of league-event meta so /events/[id]'s loading
      // hero can synthesise the same short title the loaded view
      // shows (e.g. "Setúbal vs Oeiras — Round 1") instead of the
      // stored long event.name. Carried through setPreview().
      // hostTeamId is a scalar — Prisma `include` returns it
      // automatically alongside the named relations.
      leagueTeams: { select: { teamId: true, team: { select: { id: true, name: true } } } },
    },
  });

  // Hide events from outsiders in two cases:
  //   - visibility="hidden" (creator-only)
  //   - status is "setup" / "draft" / "visible" (legacy aliases for setup)
  // Setup LEAGUE events are visible only to league administrators
  // (organizer / deputy / helper) plus app admin. Team captains and
  // players don't see them until the round is published and the event
  // auto-flips to "open". Standalone hidden events keep the broader
  // creator/helper/player branch.
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";
  const filtered = events.filter((event) => {
    const isSetup = event.status === "setup" || event.status === "draft" || event.status === "visible";
    const needsInsiderView = event.visibility === "hidden" || isSetup;
    if (!needsInsiderView) return true;
    if (!userId) return false;
    if (isAdmin) return true;
    const league = event.round?.league;
    if (league) {
      // League event: only league admin tier.
      if (league.createdById === userId) return true;
      if (league.deputyId === userId) return true;
      if (league.helpers.some((h) => h.playerId === userId)) return true;
      return false;
    }
    // Standalone hidden/setup: original broader insider rule.
    if (event.createdById === userId) return true;
    if (event.helpers.some((h) => h.playerId === userId)) return true;
    if (event.players.some((p) => p.playerId === userId)) return true;
    return false;
  });
  // Strip the visibility-gating fields off the league response
  // (createdById / deputyId / helpers / teams' captain+roster ids
  // would leak otherwise). Keep the public round / league meta so
  // the event-detail loading hero can produce the same short title
  // as the loaded view.
  const stripped = filtered.map((e) => {
    if (!e.round) return e;
    const { league } = e.round;
    const cleanLeague = {
      id: league.id,
      name: league.name,
      shortName: league.shortName,
      season: league.season,
    };
    return { ...e, round: { id: e.round.id, name: e.round.name, roundNumber: e.round.roundNumber, league: cleanLeague } };
  });

  const allowEmail = await canSeeEmails(userId, userRole);
  return NextResponse.json(allowEmail ? stripped : stripEmailsDeep(stripped));
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

  // Create event. We override the schema's "setup" default to "open"
  // so newly created standalone events are immediately visible to
  // normal users. The /events/new form doesn't expose a status field,
  // so without this override creators kept making invisible events.
  // Organizers who want a hidden draft can flip the status to "setup"
  // afterwards from the Event Data section.
  const event = await prisma.event.create({
    data: {
      name: name.trim(),
      numCourts: effectiveNumCourts,
      status: "open",
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
