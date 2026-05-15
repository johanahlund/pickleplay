import { prisma } from "@/lib/db";
import { requireAuth, requireEventOwner, requireEventManager, requireScheduleEditor, canSeeEmails, stripEmailsDeep, getViewerMemberships, canSeeWhatsApp } from "@/lib/auth";
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
      // safePlayerSelect plus passwordHash (→ hasAccount), plus the
      // phone + visibility + membership data needed to compute the
      // canSeeWhatsApp gate per-player below.
      players: {
        include: {
          player: {
            select: {
              ...safePlayerSelect,
              passwordHash: true,
              phone: true,
              whatsappVisibility: true,
              invitesSent: true,
              lastInvitedAt: true,
              clubMembers: { select: { clubId: true } },
              leagueTeamPlayers: { select: { teamId: true } },
              eventPlayers: { select: { eventId: true } },
            },
          },
        },
      },
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
              matchDurationMin: true,
              categories: { select: { id: true, name: true, format: true, gender: true, matchDurationMin: true, scoringFormat: true, winBy: true }, orderBy: { sortOrder: "asc" } },
              // For visibility checks: anyone on a team in the league should
              // be able to see the league-attached event regardless of its status.
              teams: {
                select: {
                  id: true, name: true, captainId: true, viceCaptainId: true,
                  // Include the player payload so the league-event participants
                  // column can render roster names + the captain's
                  // "+ Add player" picker can list teammates who haven't
                  // signed up yet.
                  players: {
                    select: {
                      playerId: true,
                      player: {
                        select: {
                          id: true, name: true, photoUrl: true, gender: true,
                          phone: true, passwordHash: true,
                          whatsappVisibility: true,
                          invitesSent: true,
                          lastInvitedAt: true,
                          clubMembers: { select: { clubId: true } },
                          leagueTeamPlayers: { select: { teamId: true } },
                          eventPlayers: { select: { eventId: true } },
                        },
                      },
                    },
                  },
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
          scheduleAnchored: true,
          scoringFormatOverride: true,
          winByOverride: true,
          gamePlayers: {
            select: {
              playerId: true,
              team: true,
              // Include the player record so the share builder can
              // resolve names even for non-roster / non-signup players
              // (e.g. someone added straight into a friendly slot).
              player: { select: { id: true, name: true } },
            },
          },
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
  //
  // We always attach team1PlayerCount / team2PlayerCount BEFORE the
  // identity filter. The lineup page needs the opposite side's count
  // pre-reveal so the host captain's "delete match" dialog can escalate
  // ("Opp has 2 players assigned — type REMOVE to confirm") without
  // leaking who those players are.
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
    type GamePlayerLite = { playerId: string; team: number | null };
    type LeagueGameLite = { team1Id: string; team2Id: string; gamePlayers: GamePlayerLite[] };
    // Annotate every game with per-side counts (pre-filter). The
    // legacy null-team fallback uses roster membership for stragglers
    // from before the team field was populated.
    type TeamRosterLite = { id: string; players: { playerId: string }[] };
    const teamsForCount = (league.teams as TeamRosterLite[]) ?? [];
    const rosterByTeam = new Map<string, Set<string>>(
      teamsForCount.map((t) => [t.id, new Set(t.players.map((p) => p.playerId))]),
    );
    const countsBySide = (g: LeagueGameLite): { t1: number; t2: number } => {
      let t1 = 0, t2 = 0;
      const t1Roster = rosterByTeam.get(g.team1Id) ?? new Set<string>();
      const t2Roster = rosterByTeam.get(g.team2Id) ?? new Set<string>();
      for (const gp of g.gamePlayers) {
        if (gp.team === 1) t1++;
        else if (gp.team === 2) t2++;
        else if (t1Roster.has(gp.playerId)) t1++;
        else if (t2Roster.has(gp.playerId)) t2++;
      }
      return { t1, t2 };
    };
    if (!isOrganizer && !revealed) {
      type TeamLite = { id: string; captainId: string | null; viceCaptainId: string | null; players: { playerId: string }[] };
      const myTeam = (league.teams as TeamLite[]).find((t) =>
        t.captainId === user.id
        || t.viceCaptainId === user.id
        || t.players.some((p) => p.playerId === user.id),
      );
      const myTeamId = myTeam?.id;
      const myTeammateIds = new Set((myTeam?.players ?? []).map((p) => p.playerId));
      event.leagueGames = (event.leagueGames as unknown as LeagueGameLite[]).map((g) => {
        const { t1, t2 } = countsBySide(g);
        const viewerIsInGame = myTeamId === g.team1Id || myTeamId === g.team2Id;
        if (!viewerIsInGame) return { ...g, gamePlayers: [], team1PlayerCount: t1, team2PlayerCount: t2 };
        return {
          ...g,
          gamePlayers: g.gamePlayers.filter((gp) => myTeammateIds.has(gp.playerId)),
          team1PlayerCount: t1,
          team2PlayerCount: t2,
        };
      }) as unknown as typeof event.leagueGames;
    } else {
      // Revealed or organizer view — no identity filter, but still
      // expose the counts so clients have a single, consistent field
      // to read regardless of viewer.
      event.leagueGames = (event.leagueGames as unknown as LeagueGameLite[]).map((g) => {
        const { t1, t2 } = countsBySide(g);
        return { ...g, team1PlayerCount: t1, team2PlayerCount: t2 };
      }) as unknown as typeof event.leagueGames;
    }
  }

  // Gate phone visibility per player. We selected the target's
  // memberships above; combine with the viewer's memberships and
  // canSeeWhatsApp to decide. Always strip the membership lists from
  // the response payload — they were only fetched for the gate.
  type WhatsAppPayload = {
    id: string;
    phone: string | null;
    whatsappVisibility: string;
    clubMembers: { clubId: string }[];
    leagueTeamPlayers: { teamId: string }[];
    eventPlayers: { eventId: string }[];
  };
  const scrubPhone = (
    p: WhatsAppPayload,
    viewer: Awaited<ReturnType<typeof getViewerMemberships>>,
  ) => {
    const allow = canSeeWhatsApp(viewer, {
      id: p.id,
      whatsappVisibility: p.whatsappVisibility,
      clubIds: p.clubMembers.map((c) => c.clubId),
      teamIds: p.leagueTeamPlayers.map((t) => t.teamId),
      signedUpEventIds: p.eventPlayers.map((e) => e.eventId),
    });
    return allow ? p.phone : null;
  };
  const viewerMemberships = await getViewerMemberships(user.id, user.role);
  // event.players[].player
  for (const ep of event.players as unknown as { player: WhatsAppPayload }[]) {
    const newPhone = scrubPhone(ep.player, viewerMemberships);
    ep.player.phone = newPhone;
    // Drop the per-target membership lists from the response.
    delete (ep.player as Partial<WhatsAppPayload>).clubMembers;
    delete (ep.player as Partial<WhatsAppPayload>).leagueTeamPlayers;
    delete (ep.player as Partial<WhatsAppPayload>).eventPlayers;
    delete (ep.player as Partial<WhatsAppPayload>).whatsappVisibility;
  }
  // event.round.league.teams[].players[].player (when present)
  const leagueTeams = (event.round?.league as unknown as { teams?: { players: { player: WhatsAppPayload }[] }[] } | undefined)?.teams;
  if (Array.isArray(leagueTeams)) {
    for (const t of leagueTeams) {
      for (const tp of t.players) {
        tp.player.phone = scrubPhone(tp.player, viewerMemberships);
        delete (tp.player as Partial<WhatsAppPayload>).clubMembers;
        delete (tp.player as Partial<WhatsAppPayload>).leagueTeamPlayers;
        delete (tp.player as Partial<WhatsAppPayload>).eventPlayers;
        delete (tp.player as Partial<WhatsAppPayload>).whatsappVisibility;
      }
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
  // Schedule-affecting fields (start times, durations, category
  // overrides) need the stricter `requireScheduleEditor` gate —
  // helpers and visitor-team captains who can manage everything
  // else must not be able to touch these.
  const touchesSchedule = body.matchDurationMin !== undefined
    || body.courtStartTimes !== undefined
    || body.categoryDurationOverrides !== undefined
    || body.scheduleLocked !== undefined;
  if (touchesSchedule) {
    try {
      await requireScheduleEditor(id);
    } catch {
      return NextResponse.json(
        { error: "Only the event organizer, league admin, or host team captain/vice can change scheduling fields." },
        { status: 403 },
      );
    }
    // Lock check: if the schedule is currently locked, reject ALL
    // schedule-field writes EXCEPT the scheduleLocked toggle itself
    // (otherwise locking would trap us — no way to unlock).
    const isToggleOnly = body.scheduleLocked !== undefined
      && body.matchDurationMin === undefined
      && body.courtStartTimes === undefined
      && body.categoryDurationOverrides === undefined;
    if (!isToggleOnly) {
      const current = await prisma.event.findUnique({
        where: { id },
        select: { scheduleLocked: true },
      });
      if (current?.scheduleLocked) {
        return NextResponse.json(
          { error: "Schedule is locked. Unlock it before editing scheduling fields." },
          { status: 409 },
        );
      }
    }
  }
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
  if (body.matchDurationMin !== undefined) {
    const v = body.matchDurationMin;
    if (v === null) {
      eventData.matchDurationMin = null;
    } else if (typeof v === "number" && v >= 5 && v <= 240) {
      eventData.matchDurationMin = Math.round(v);
    } else {
      return NextResponse.json({ error: "matchDurationMin must be null or 5-240" }, { status: 400 });
    }
  }
  if (body.courtStartTimes !== undefined) {
    const v = body.courtStartTimes;
    if (v === null) {
      eventData.courtStartTimes = null;
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      // Validate each entry is an ISO datetime (or null to clear).
      const out: Record<string, string> = {};
      for (const [k, val] of Object.entries(v)) {
        if (val === null || val === "") continue;
        if (typeof val !== "string") {
          return NextResponse.json({ error: `courtStartTimes.${k} must be ISO datetime` }, { status: 400 });
        }
        const d = new Date(val);
        if (isNaN(d.getTime())) {
          return NextResponse.json({ error: `courtStartTimes.${k} is not a valid datetime` }, { status: 400 });
        }
        out[k] = d.toISOString();
      }
      eventData.courtStartTimes = out;
    } else {
      return NextResponse.json({ error: "courtStartTimes must be an object" }, { status: 400 });
    }
  }
  if (body.categoryDurationOverrides !== undefined) {
    const v = body.categoryDurationOverrides;
    if (v === null) {
      eventData.categoryDurationOverrides = null;
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      const out: Record<string, number> = {};
      for (const [catId, raw] of Object.entries(v as Record<string, unknown>)) {
        if (raw === null || raw === undefined || raw === "") continue;
        const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n < 5 || n > 240) {
          return NextResponse.json({ error: `categoryDurationOverrides[${catId}] must be 5-240` }, { status: 400 });
        }
        out[catId] = n;
      }
      eventData.categoryDurationOverrides = Object.keys(out).length > 0 ? out : null;
    } else {
      return NextResponse.json({ error: "categoryDurationOverrides must be an object" }, { status: 400 });
    }
  }
  if (body.scheduleLocked !== undefined) {
    eventData.scheduleLocked = !!body.scheduleLocked;
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
  if (body.comments !== undefined) {
    if (body.comments === null) {
      eventData.comments = null;
    } else if (typeof body.comments !== "string") {
      return NextResponse.json({ error: "comments must be a string" }, { status: 400 });
    } else {
      // Trim trailing whitespace but keep internal newlines (operators
      // use line breaks for readability in the WhatsApp share).
      const trimmed = body.comments.replace(/\s+$/g, "");
      eventData.comments = trimmed.length > 0 ? trimmed : null;
    }
  }
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

  // Schedule inputs changed → recompute every court's match times.
  // Cheap (one query per court) and the only reliable way to keep the
  // chain in sync when default duration or court anchors move.
  const scheduleTriggers = ["matchDurationMin", "categoryDurationOverrides", "courtStartTimes", "numCourts"];
  if (scheduleTriggers.some((k) => k in eventData)) {
    try {
      const { recalcAllCourtsAndPersist } = await import("@/lib/leagueSchedule");
      await recalcAllCourtsAndPersist(id);
    } catch { /* logging failures must not break the response */ }
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
