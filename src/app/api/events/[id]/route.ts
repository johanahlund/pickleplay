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
      // safePlayerSelect plus passwordHash so we can derive `hasAccount`.
      players: { include: { player: { select: { ...safePlayerSelect, passwordHash: true } } } },
      matches: {
        include: {
          players: { include: { player: { select: safePlayerSelect } } },
          scorer: { select: { id: true, name: true, photoUrl: true } },
          // League-game link, if this match is the scoring of a league game.
          // `kind` drives the Principal/League/Extra badge in the match card.
          leagueGame: { select: { id: true, kind: true, slotNumber: true, scheduledAt: true, courtNum: true, category: { select: { id: true, name: true } } } },
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
              id: true, name: true, shortName: true, season: true, createdById: true, deputyId: true,
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
                  players: { select: { playerId: true, player: { select: { id: true, name: true, photoUrl: true, gender: true, passwordHash: true } } } },
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
      // Lineup placements for the event. Used by the sign-up page to
      // detect "this player is already in a lineup → seed prefs as
      // 'playing' + 'prefer' for their category". Visibility filter
      // applied below (mirrors /api/leagues/[id]: each team sees only
      // their own players until both teams flip lineupReady).
      leagueGames: {
        select: {
          id: true,
          categoryId: true,
          team1Id: true,
          team2Id: true,
          team1Wants: true,
          team2Wants: true,
          slotNumber: true,
          kind: true,
          scheduledAt: true,
          courtNum: true,
          displayOrder: true,
          winnerId: true,
          gamePlayers: { select: { playerId: true, team: true } },
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
      // Linked social event (one or zero). When present, the league
      // event UI can show a "social side" component badge + navigation.
      socialEvents: { select: { id: true, name: true, status: true }, take: 1 },
      // Inverse: when this IS a social event, expose the league parent.
      socialOf: { select: { id: true, name: true } },
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
    // Tightened: Setup LEAGUE events are visible only to league
    // administrators (organizer / deputy / helper) + app admin. Team
    // captains, vice-captains and players are NOT insiders for Setup
    // events — they only see the event once the round is published
    // and status auto-flips to Open. Standalone hidden events keep
    // the broader insider rule (creator + event helpers + players).
    const isLeagueAdmin = !!league && (
      league.createdById === user.id ||
      league.deputyId === user.id ||
      league.helpers?.some((h: { playerId: string }) => h.playerId === user.id)
    );
    const isLeagueEvent = !!league;
    const isInsider =
      isAdmin ||
      (isLeagueEvent ? isLeagueAdmin : (
        event.createdById === user.id ||
        event.helpers.some((h) => h.playerId === user.id) ||
        event.players.some((p) => p.playerId === user.id)
      ));
    if (!isInsider) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
  }
  // Attach league-time category preferences (from LeagueParticipationRequest)
  // to each rostered team player so the event sign-up page can use them as
  // defaults. Visibility mirrors the participation-requests endpoint:
  //   - everyone sees their own
  //   - captain/vice see their team's roster
  //   - organizers/helpers/admin see everything
  if (event.round?.league) {
    const league = event.round.league;
    const isAdminUser = user.role === "admin";
    const isOrganizer = isAdminUser
      || league.createdById === user.id
      || league.deputyId === user.id
      || league.helpers.some((h: { playerId: string }) => h.playerId === user.id);
    const myCaptainTeamIds = new Set(
      league.teams
        .filter((t: { captainId: string | null; viceCaptainId: string | null }) => t.captainId === user.id || t.viceCaptainId === user.id)
        .map((t: { id: string }) => t.id),
    );
    const reqs = await prisma.leagueParticipationRequest.findMany({
      where: { leagueId: league.id, status: "accepted" },
      select: { playerId: true, preferredTeamId: true, preferences: true },
    });
    type PrefMap = Record<string, unknown>;
    const prefByPlayer = new Map<string, PrefMap>();
    for (const r of reqs) {
      if (r.preferences) prefByPlayer.set(r.playerId, r.preferences as PrefMap);
    }
    type RosterPlayer = { playerId: string; player: { id: string; name: string; photoUrl: string | null; gender: string | null } };
    const eventLike = event as unknown as { round: { league: { teams: { id: string; players: (RosterPlayer & { participationPrefs?: PrefMap | null })[] }[] } } };
    for (const t of eventLike.round.league.teams) {
      for (const tp of t.players) {
        const prefs = prefByPlayer.get(tp.playerId);
        if (!prefs) continue;
        const visible = isOrganizer
          || tp.playerId === user.id
          || myCaptainTeamIds.has(t.id);
        if (visible) tp.participationPrefs = prefs;
      }
    }
  }

  // Lineup secrecy: until BOTH teams in the match-day event mark themselves
  // "lineup ready", each team sees only its own players in leagueGames.
  // Organizers/helpers/admin always see both. Mirrors /api/leagues/[id].
  if (event.round?.league && Array.isArray(event.leagueGames)) {
    const league = event.round.league;
    const isAdminUser = user.role === "admin";
    const isOrganizer = isAdminUser
      || league.createdById === user.id
      || league.deputyId === user.id
      || league.helpers.some((h: { playerId: string }) => h.playerId === user.id);
    // Cross-team lineup reveal piggybacks on Event.lineupTotalLocked —
    // once latched the opponent's gamePlayers stay visible forever.
    // Pre-latch we fall back to the legacy "both currently ready" so
    // any historical events without lineupTotalLocked still work.
    const revealed = (event as unknown as { lineupTotalLocked?: boolean }).lineupTotalLocked === true
      || (Array.isArray(event.leagueTeams)
        && event.leagueTeams.length === 2
        && event.leagueTeams.every((lt: { lineupReady: boolean | null }) => lt.lineupReady));
    if (!isOrganizer && !revealed) {
      type TeamLite = { id: string; captainId: string | null; viceCaptainId: string | null; players: { playerId: string }[] };
      const myTeam = (league.teams as TeamLite[]).find((t) =>
        t.captainId === user.id
        || t.viceCaptainId === user.id
        || t.players.some((p) => p.playerId === user.id),
      );
      const myTeamId = myTeam?.id;
      const myTeammateIds = new Set((myTeam?.players ?? []).map((p) => p.playerId));
      type LeagueGameLite = { team1Id: string; team2Id: string; gamePlayers: { playerId: string }[] };
      event.leagueGames = (event.leagueGames as LeagueGameLite[]).map((g) => {
        const viewerIsInGame = myTeamId === g.team1Id || myTeamId === g.team2Id;
        if (!viewerIsInGame) return { ...g, gamePlayers: [] };
        return {
          ...g,
          gamePlayers: g.gamePlayers.filter((gp) => myTeammateIds.has(gp.playerId)),
        };
      }) as typeof event.leagueGames;
    }
  }

  // Derive `hasAccount` and strip raw passwordHash from any player payload
  // we just included. Cheap recursive walk; never mutates the original
  // record types since the cast is at the response boundary.
  const stripPasswordHash = (obj: unknown): unknown => {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(stripPasswordHash);
    const o = obj as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(o, "passwordHash")) {
      const hasAccount = !!o.passwordHash;
      delete o.passwordHash;
      o.hasAccount = hasAccount;
    }
    for (const k of Object.keys(o)) o[k] = stripPasswordHash(o[k]);
    return o;
  };
  stripPasswordHash(event);

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
    // Stored values now: setup | open | closed. Legacy aliases
    // (visible/draft/completed/active) are normalised on the way in:
    //   visible/draft → setup, completed/active → closed.
    const allowed = new Set(["setup", "open", "closed", "active", "visible", "draft", "completed"]);
    if (!allowed.has(body.status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    const nextStatus =
      body.status === "visible" || body.status === "draft" ? "setup"
      : body.status === "completed" || body.status === "active" ? "closed"
      : body.status;

    // Transition guard: for LEAGUE events you cannot push the status
    // BACK to "setup" once it's left (Round publish is the boundary
    // and we don't want home captains pulling the rug out from under
    // signups). App admin can override. Standalone events are free.
    const evtForGuard = await prisma.event.findUnique({
      where: { id },
      select: { status: true, round: { select: { id: true } } },
    });
    const user = await requireAuth();
    const isAppAdmin = user.role === "admin";
    const isLeagueEvent = !!evtForGuard?.round;
    if (
      isLeagueEvent &&
      nextStatus === "setup" &&
      (evtForGuard?.status === "open" || evtForGuard?.status === "closed") &&
      !isAppAdmin
    ) {
      return NextResponse.json(
        { error: "League events can't be moved back to Setup once the round is active." },
        { status: 400 },
      );
    }
    eventData.status = nextStatus;
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
  if (body.maxMinutes !== undefined) {
    // null = remove cap; positive int = enforce cap.
    classData.maxMinutes =
      body.maxMinutes === null
        ? null
        : Number.isFinite(body.maxMinutes) && body.maxMinutes > 0
          ? Math.min(60, Math.max(1, Math.round(body.maxMinutes)))
          : null;
  }
  if (body.scoringEnforced !== undefined) {
    classData.scoringEnforced = body.scoringEnforced !== false;
  }
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
