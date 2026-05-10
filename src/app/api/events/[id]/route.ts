import { prisma } from "@/lib/db";
import { requireAuth, requireEventOwner, requireEventManager, canSeeEmails, stripEmailsDeep } from "@/lib/auth";
import { safePlayerSelect } from "@/lib/playerSelect";
import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const { id } = await params;
  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      classes: true,
      sessions: { orderBy: { date: "asc" } },
      players: { include: { player: { select: safePlayerSelect } } },
      matches: {
        include: {
          players: { include: { player: { select: safePlayerSelect } } },
          scorer: { select: { id: true, name: true, photoUrl: true } },
          // League-game link, if this match is the scoring of a league game.
          // `kind` drives the Principal/League/Extra badge in the match card.
          leagueGame: { select: { id: true, kind: true, slotNumber: true, category: { select: { id: true, name: true } } } },
        },
        orderBy: [{ round: "asc" }, { courtNum: "asc" }],
      },
      helpers: { include: { player: { select: safePlayerSelect } } },
      // If this event is attached to a league round, expose the league + teams
      // so the UI can show a banner + filter the match list.
      round: {
        include: {
          league: {
            select: {
              id: true, name: true, season: true, createdById: true, deputyId: true,
              categories: { select: { id: true, name: true, format: true, gender: true }, orderBy: { sortOrder: "asc" } },
              // For visibility checks: anyone on a team in the league should
              // be able to see the league-attached event regardless of its status.
              teams: {
                select: {
                  id: true, name: true, captainId: true, viceCaptainId: true,
                  // Include the player payload so the league-event participants
                  // column can render roster names + the captain's
                  // "+ Add player" picker can list teammates who haven't
                  // signed up yet.
                  players: { select: { playerId: true, player: { select: { id: true, name: true, photoUrl: true, gender: true } } } },
                },
              },
              helpers: { select: { playerId: true } },
            },
          },
        },
      },
      leagueTeams: {
        select: {
          teamId: true, points: true,
          lineupReady: true, lineupReadyAt: true,
          team: { select: { id: true, name: true, logoUrl: true } },
        },
      },
      pairs: {
        include: {
          player1: { select: { id: true, name: true, emoji: true, photoUrl: true, rating: true, gender: true } },
          player2: { select: { id: true, name: true, emoji: true, photoUrl: true, rating: true, gender: true } },
        },
      },
      createdBy: { select: { id: true, name: true, emoji: true } },
      club: { select: { id: true, name: true, shortName: true, emoji: true, logoUrl: true, locations: true } },
    },
  });
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  // Hide hidden + setup/draft events from outsiders. League match-day and
  // playoff events count league participants (team captains/vice/players,
  // helpers, organizers) as insiders so they can see their own match-day
  // even before an organizer flips the event status.
  // Visible/draft are pre-migration aliases for setup.
  const isSetup = event.status === "setup" || event.status === "draft" || event.status === "visible";
  const needsInsiderView = event.visibility === "hidden" || isSetup;
  if (needsInsiderView) {
    const isAdmin = user.role === "admin";
    const league = event.round?.league;
    const isLeagueParticipant = !!league && (
      league.createdById === user.id ||
      league.deputyId === user.id ||
      league.helpers?.some((h: { playerId: string }) => h.playerId === user.id) ||
      league.teams?.some((t: { captainId: string | null; viceCaptainId: string | null; players: { playerId: string }[] }) =>
        t.captainId === user.id ||
        t.viceCaptainId === user.id ||
        t.players.some((p) => p.playerId === user.id),
      )
    );
    const isInsider =
      isAdmin ||
      event.createdById === user.id ||
      event.helpers.some((h) => h.playerId === user.id) ||
      event.players.some((p) => p.playerId === user.id) ||
      isLeagueParticipant;
    if (!isInsider) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
  }
  const allowEmail = await canSeeEmails(user.id, user.role);
  return NextResponse.json(allowEmail ? event : stripEmailsDeep(event));
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireEventOwner(id);
  } catch {
    return NextResponse.json({ error: "Only the event owner or admin can delete" }, { status: 403 });
  }
  await prisma.event.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    await requireEventManager(id);
  } catch {
    return NextResponse.json({ error: "Not authorized to edit this event" }, { status: 403 });
  }

  const body = await req.json();
  const { name, numCourts, date, endDate, openSignup, visibility } = body;
  const { scoringFormat, numSets, scoringType, timedMinutes, pairingMode, rankingMode } = body;

  // Event-level fields
  const eventData: Record<string, unknown> = {};
  if (name !== undefined) {
    if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
    eventData.name = name.trim();
  }
  if (numCourts !== undefined) {
    if (typeof numCourts !== "number" || numCourts < 1) return NextResponse.json({ error: "numCourts must be positive" }, { status: 400 });
    eventData.numCourts = numCourts;
  }
  if (date !== undefined) {
    const parsed = new Date(date);
    if (isNaN(parsed.getTime())) return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    eventData.date = parsed;
  }
  if (endDate !== undefined) {
    eventData.endDate = endDate === null ? null : new Date(endDate);
  }
  if (openSignup !== undefined) eventData.openSignup = !!openSignup;
  if (visibility !== undefined) eventData.visibility = visibility;
  if (body.status !== undefined) {
    // Stored values: setup | open | closed | active. Legacy aliases (visible,
    // draft, completed) are normalised on the way in.
    const allowed = new Set(["setup", "open", "closed", "active", "visible", "draft", "completed"]);
    if (!allowed.has(body.status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    eventData.status = body.status === "visible" || body.status === "draft" ? "setup"
      : body.status === "completed" ? "active"
      : body.status;
  }
  if (body.locationId !== undefined) eventData.locationId = body.locationId;
  if (body.createdById !== undefined) {
    // Only event owner, club owner, or app admin can transfer ownership
    const user = await requireAuth();
    const evt = await prisma.event.findUnique({ where: { id }, select: { createdById: true, clubId: true } });
    const isEventOwner = evt?.createdById === user.id;
    const isClubOwner = evt?.clubId ? !!(await prisma.clubMember.findFirst({ where: { clubId: evt.clubId, playerId: user.id, role: "owner" } })) : false;
    if (!isEventOwner && !isClubOwner && user.role !== "admin") {
      return NextResponse.json({ error: "Only the event owner, club owner, or app admin can transfer ownership" }, { status: 403 });
    }
    eventData.createdById = body.createdById;
    // Add old owner as helper
    if (evt?.createdById && evt.createdById !== body.createdById) {
      const alreadyHelper = await prisma.eventHelper.findFirst({ where: { eventId: id, playerId: evt.createdById } });
      if (!alreadyHelper) {
        await prisma.eventHelper.create({ data: { eventId: id, playerId: evt.createdById } });
      }
    }
  }

  // Class-level fields (update default class)
  const classData: Record<string, unknown> = {};
  if (body.format !== undefined) classData.format = body.format;
  if (scoringFormat !== undefined) classData.scoringFormat = scoringFormat;
  if (body.winBy !== undefined) classData.winBy = body.winBy;
  // Legacy compat: convert old numSets+scoringType to scoringFormat
  if (!scoringFormat && numSets !== undefined && scoringType !== undefined) {
    classData.scoringFormat = `${numSets}x${scoringType.replace("normal_", "").replace("rally_", "R")}`;
  }
  if (timedMinutes !== undefined) classData.timedMinutes = timedMinutes;
  if (pairingMode !== undefined) classData.pairingMode = pairingMode;
  if (body.playMode !== undefined) classData.playMode = body.playMode;
  if (body.prioSpeed !== undefined) classData.prioSpeed = body.prioSpeed;
  if (body.prioFairness !== undefined) classData.prioFairness = body.prioFairness;
  if (body.prioSkill !== undefined) classData.prioSkill = body.prioSkill;
  if (body.prioVariety !== undefined) classData.prioVariety = body.prioVariety;
  if (rankingMode !== undefined) classData.rankingMode = rankingMode;

  const data = eventData; // for backwards compat with the update below

  if (Object.keys(eventData).length === 0 && Object.keys(classData).length === 0) {
    return NextResponse.json(
      { error: "No fields to update" },
      { status: 400 }
    );
  }

  // Update event-level fields
  if (Object.keys(eventData).length > 0) {
    await prisma.event.update({ where: { id }, data: eventData });
  }

  // Update default class fields
  if (Object.keys(classData).length > 0) {
    const defaultClass = await prisma.eventClass.findFirst({
      where: { eventId: id, isDefault: true },
    });
    if (defaultClass) {
      await prisma.eventClass.update({ where: { id: defaultClass.id }, data: classData });
    }
  }

  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      classes: true,
      players: { include: { player: { select: safePlayerSelect } } },
      matches: {
        include: {
          players: { include: { player: { select: safePlayerSelect } } },
          scorer: { select: { id: true, name: true, photoUrl: true } },
        },
        orderBy: [{ round: "asc" }, { courtNum: "asc" }],
      },
    },
  });

  return NextResponse.json(event);
}
