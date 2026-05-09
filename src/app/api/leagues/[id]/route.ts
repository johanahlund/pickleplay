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
          players: { include: { player: { select: { id: true, name: true, email: true, photoUrl: true, rating: true, gender: true } } } },
          _count: { select: { players: true } },
        },
      },
      rounds: {
        orderBy: { roundNumber: "asc" },
        include: {
          events: {
            select: {
              id: true, name: true, date: true, status: true, hostTeamId: true,
              leagueTeams: { include: { team: { select: { id: true, name: true, logoUrl: true } } } },
              leagueGames: {
                include: {
                  category: { select: { id: true, name: true } },
                  team1: { select: { id: true, name: true } },
                  team2: { select: { id: true, name: true } },
                  winner: { select: { id: true, name: true } },
                },
              },
              // Status only — slot details come from /lineups endpoint (visibility-controlled)
              leagueLineups: {
                select: { id: true, teamId: true, status: true, unlockRequestedById: true },
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

  // Transferring director or assigning deputy is owner-only.
  const ownerOnly = body.createdById !== undefined || body.deputyId !== undefined;
  try {
    if (ownerOnly) await requireLeagueOwner(id);
    else await requireLeagueManager(id);
  } catch (e) { return authErrorResponse(e); }

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.description !== undefined) data.description = body.description ? String(body.description).trim() : null;
  if (body.season !== undefined) data.season = body.season ? String(body.season).trim() : null;
  if (body.status !== undefined) data.status = body.status;
  if (body.config !== undefined) data.config = body.config;
  if (body.deputyId !== undefined) data.deputyId = body.deputyId || null;
  if (body.createdById !== undefined) data.createdById = body.createdById;
  if (body.clubId !== undefined) {
    if (body.clubId) {
      try { await requireClubOwner(String(body.clubId)); } catch (e) { return authErrorResponse(e); }
      data.clubId = String(body.clubId);
    } else {
      data.clubId = null;
    }
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
