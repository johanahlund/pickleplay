import { prisma } from "@/lib/db";
import { requireAuth, requireLeagueManager, requireLeagueOwner, requireClubOwner, authErrorResponse, canSeeEmails, stripEmailsDeep } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET: league details with all relations (login required; emails stripped for non-club-owners)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const { id } = await params;
  const league = await prisma.league.findUnique({
    where: { id },
    include: {
      club: { select: { id: true, name: true, emoji: true, logoUrl: true } },
      createdBy: { select: { id: true, name: true } },
      deputy: { select: { id: true, name: true } },
      helpers: { include: { player: { select: { id: true, name: true, email: true, photoUrl: true } } } },
      categories: { orderBy: { sortOrder: "asc" } },
      documents: { orderBy: { uploadedAt: "asc" } },
      // Pending requests so the UI can show counts. Slot detail (preferences,
      // note) is fetched via /participation-requests for captains/organizers.
      // Also include the viewer's own accepted request so they can cancel/leave.
      participationRequests: {
        where: { OR: [{ status: "pending" }, { status: "accepted", playerId: user.id }] },
        select: {
          id: true, playerId: true, preferredTeamId: true, status: true,
          // preferences is included only for the viewer's own request below; we
          // strip it for everyone else so other captains can't see prefs here.
          preferences: true,
          player: { select: { id: true, gender: true } },
        },
      },
      teams: {
        include: {
          club: { select: { id: true, name: true, emoji: true, logoUrl: true } },
          captain: { select: { id: true, name: true, email: true, photoUrl: true } },
          viceCaptain: { select: { id: true, name: true, email: true, photoUrl: true } },
          players: { include: { player: { select: { id: true, name: true, email: true, photoUrl: true, rating: true, gender: true, passwordHash: true } } } },
          _count: { select: { players: true } },
        },
      },
      rounds: {
        orderBy: { roundNumber: "asc" },
        include: {
          events: {
            select: {
              id: true, name: true, date: true, status: true, hostTeamId: true,
              leagueTeams: {
                select: {
                  teamId: true, points: true,
                  lineupReady: true, lineupReadyAt: true, lineupReadyById: true,
                  team: { select: { id: true, name: true, logoUrl: true, captainId: true, viceCaptainId: true } },
                },
              },
              leagueGames: {
                select: {
                  id: true, categoryId: true, slotNumber: true, kind: true,
                  team1Id: true, team2Id: true, team1Wants: true, team2Wants: true,
                  matchId: true, winnerId: true,
                  scheduledAt: true, courtNum: true,
                  category: { select: { id: true, name: true } },
                  team1: { select: { id: true, name: true } },
                  team2: { select: { id: true, name: true } },
                  winner: { select: { id: true, name: true } },
                  gamePlayers: {
                    select: {
                      playerId: true,
                      player: { select: { id: true, name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!league) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isAppAdmin = user.role === "admin";
  const isOrganizer = isAppAdmin || league.createdBy?.id === user.id || league.deputy?.id === user.id;
  const isHelper = league.helpers.some((h) => h.player.id === user.id);

  // Setup gate: leagues in "setup" are only visible to organizers (director/deputy/admin).
  if (league.status === "setup" && !isOrganizer) {
    return NextResponse.json({ error: "Not visible" }, { status: 403 });
  }
  // Visibility gate: when "participants", only league participants + organizers
  // (and app admin) may see the league.
  if (league.visibility === "participants" && !isAppAdmin) {
    const isOnTeam = league.teams.some((t) =>
      t.captain?.id === user.id || t.viceCaptain?.id === user.id ||
      t.players.some((tp) => tp.player.id === user.id),
    );
    if (!isOrganizer && !isHelper && !isOnTeam) {
      return NextResponse.json({ error: "Not visible" }, { status: 403 });
    }
  }

  // Roster visibility: hide other teams' players unless the league has reached
  // "active" (or "complete"), OR the viewer is an organizer/helper/admin,
  // OR the viewer is captain/vice of that team.
  const rostersAreVisible = league.status === "active" || league.status === "complete";
  let view = league;
  if (!rostersAreVisible && !isOrganizer && !isHelper) {
    view = {
      ...league,
      teams: league.teams.map((t) => {
        const canSeeRoster = t.captain?.id === user.id || t.viceCaptain?.id === user.id;
        if (canSeeRoster) return t;
        // Keep the viewer's own membership so the client can tell they're on
        // the team (drives the "You're on team X" banner). Hide everyone else.
        return { ...t, players: t.players.filter((tp) => tp.player.id === user.id) };
      }),
    };
  }

  // Strip preferences from other people's participation requests — captains
  // managing their own team's requests fetch full data via the dedicated
  // /participation-requests endpoint (which has its own visibility rules).
  view = {
    ...view,
    participationRequests: view.participationRequests.map((r) =>
      r.playerId === user.id ? r : { ...r, preferences: null },
    ),
  };

  // Hide rounds with status="setup" from non-managers — those are still
  // being configured by the league admin and shouldn't show to players.
  if (!isOrganizer && !isHelper) {
    view = { ...view, rounds: view.rounds.filter((r) => r.status !== "setup") };
  }

  // Lineup secrecy: until BOTH teams in a match-day event mark themselves
  // "lineup ready", each team only sees its own players in leagueGames.
  // Organizers/helpers/admin always see both. The viewer sees a row's
  // players only if (a) they're on that game's team's roster, or (b) both
  // teams have flipped lineupReady=true. We keep `team1Wants`/`team2Wants`
  // visible — only the player identities are hidden.
  if (!isOrganizer && !isHelper) {
    // Build a map of (teamId → does the viewer belong to that team?). A
    // viewer "belongs" if they're a player on the roster, captain, or vice.
    const myTeamIds = new Set<string>();
    for (const t of view.teams) {
      const isMine = t.captain?.id === user.id
        || t.viceCaptain?.id === user.id
        || t.players.some((tp) => tp.player.id === user.id);
      if (isMine) myTeamIds.add(t.id);
    }
    view = {
      ...view,
      rounds: view.rounds.map((r) => ({
        ...r,
        events: r.events.map((ev) => {
          const bothReady = ev.leagueTeams.length === 2
            && ev.leagueTeams.every((lt) => lt.lineupReady);
          if (bothReady) return ev;
          return {
            ...ev,
            leagueGames: ev.leagueGames.map((g) => ({
              ...g,
              gamePlayers: g.gamePlayers.filter((gp) => {
                // Keep players whose team the viewer belongs to. Need to
                // tie the gp back to either team1 or team2 by roster
                // membership, which we don't have inline — so: if the
                // viewer is on EITHER of the two playing teams, look up
                // that team's roster and only keep gp's whose playerId is
                // on the viewer's team's roster.
                const viewerTeam = view.teams.find((t) =>
                  myTeamIds.has(t.id)
                  && (t.id === g.team1Id || t.id === g.team2Id),
                );
                if (!viewerTeam) return false;
                const onMyTeam = viewerTeam.players.some((tp) => tp.player.id === gp.playerId);
                return onMyTeam;
              }),
            })),
          };
        }),
      })),
    };
  }

  // Derive `hasAccount` per roster player and strip the raw passwordHash
  // before sending. Used by the UI to flag unclaimed players for admins.
  view = {
    ...view,
    teams: view.teams.map((t) => ({
      ...t,
      players: t.players.map((tp) => {
        const p = tp.player as { passwordHash?: string | null } & Record<string, unknown>;
        const hasAccount = !!p.passwordHash;
        const { passwordHash: _stripped, ...rest } = p;
        void _stripped;
        return { ...tp, player: { ...rest, hasAccount } };
      }),
    })),
  } as unknown as typeof view;

  const allowed = await canSeeEmails(user.id, user.role);
  return NextResponse.json(allowed ? view : stripEmailsDeep(view));
}

// PATCH: update league
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Transferring director / assigning deputy / changing club is owner-only.
  // We only escalate to owner-required when the value is actually CHANGING —
  // saving other fields shouldn't fail just because the form rebroadcasts
  // the existing director/deputy/club ids.
  let ownerOnly = false;
  if (body.createdById !== undefined || body.deputyId !== undefined) {
    const current = await prisma.league.findUnique({
      where: { id },
      select: { createdById: true, deputyId: true },
    });
    if (current) {
      if (body.createdById !== undefined && body.createdById !== current.createdById) ownerOnly = true;
      if (body.deputyId !== undefined && (body.deputyId || null) !== current.deputyId) ownerOnly = true;
    }
  }
  try {
    if (ownerOnly) await requireLeagueOwner(id);
    else await requireLeagueManager(id);
  } catch (e) { return authErrorResponse(e); }

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.shortName !== undefined) {
    const v = body.shortName ? String(body.shortName).trim() : "";
    data.shortName = v ? v.slice(0, 25) : null;
  }
  if (body.description !== undefined) data.description = body.description ? String(body.description).trim() : null;
  if (body.season !== undefined) data.season = body.season ? String(body.season).trim() : null;
  if (body.status !== undefined) {
    // Accept the new short values and normalise legacy aliases on the way in.
    const allowed = new Set(["setup", "open", "closed", "active", "complete", "registration", "forming"]);
    if (!allowed.has(body.status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    data.status = body.status === "registration" ? "open" : body.status === "forming" ? "closed" : body.status;
  }
  if (body.config !== undefined) data.config = body.config;
  if (body.deputyId !== undefined) data.deputyId = body.deputyId || null;
  if (body.createdById !== undefined) data.createdById = body.createdById;
  if (body.clubId !== undefined) {
    // Only re-validate club ownership when the clubId is actually changing.
    // Saving other fields shouldn't require club-owner role just because
    // the form rebroadcasts the unchanged clubId.
    const incoming = body.clubId ? String(body.clubId) : null;
    const current = await prisma.league.findUnique({ where: { id }, select: { clubId: true } });
    if (incoming && incoming !== current?.clubId) {
      try { await requireClubOwner(incoming); } catch (e) { return authErrorResponse(e); }
    }
    data.clubId = incoming;
  }
  if (body.visibility !== undefined) {
    if (body.visibility !== "public" && body.visibility !== "participants") {
      return NextResponse.json({ error: "Invalid visibility" }, { status: 400 });
    }
    data.visibility = body.visibility;
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const league = await prisma.league.update({ where: { id }, data });
  return NextResponse.json(league);
}

// DELETE: delete league
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireLeagueOwner(id); } catch (e) { return authErrorResponse(e); }
  await prisma.league.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
