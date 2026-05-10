import { prisma } from "@/lib/db";
import { requireAuth, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET: list requests for the league. Visible to:
//   - the requester themselves (their own request only)
//   - team captains/vice (preferredTeam matches OR null/free-agent)
//   - league director / deputy / helper / app admin (all)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try { user = await requireAuth(); } catch { return NextResponse.json({ error: "Login required" }, { status: 401 }); }
  const { id } = await params;

  const league = await prisma.league.findUnique({
    where: { id },
    select: {
      createdById: true, deputyId: true,
      helpers: { select: { playerId: true } },
      teams: { select: { id: true, captainId: true, viceCaptainId: true } },
    },
  });
  if (!league) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isAppAdmin = user.role === "admin";
  const isOrganizer = isAppAdmin || league.createdById === user.id || league.deputyId === user.id;
  const isHelper = league.helpers.some((h) => h.playerId === user.id);
  const captainTeamIds = league.teams
    .filter((t) => t.captainId === user.id || t.viceCaptainId === user.id)
    .map((t) => t.id);

  const requests = await prisma.leagueParticipationRequest.findMany({
    where: { leagueId: id, status: { in: ["pending", "accepted"] } },
    include: {
      player: { select: { id: true, name: true, photoUrl: true, gender: true, duprRating: true, rating: true } },
      preferredTeam: { select: { id: true, name: true } },
      respondedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Filter for non-organizer / non-helper viewers: own request + requests
  // for teams they captain (free agents = preferredTeamId null are visible to all captains)
  const filtered = (isOrganizer || isHelper)
    ? requests
    : requests.filter((r) => {
        if (r.playerId === user.id) return true;
        if (captainTeamIds.length === 0) return false;
        if (!r.preferredTeamId) return true; // free-agent pool visible to all captains
        return captainTeamIds.includes(r.preferredTeamId);
      });

  return NextResponse.json(filtered);
}

// POST: player creates a sign-up request for themselves.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try { user = await requireAuth(); } catch { return NextResponse.json({ error: "Login required" }, { status: 401 }); }
  const { id } = await params;

  const league = await prisma.league.findUnique({
    where: { id },
    select: { id: true, status: true, teams: { select: { id: true, players: { where: { playerId: user.id }, select: { id: true } } } } },
  });
  if (!league) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Accept legacy "registration" alongside the new "open".
  if (league.status !== "open" && league.status !== "registration") {
    return NextResponse.json({ error: "Registration is not open" }, { status: 400 });
  }
  // If the player is already on a team in this league, no request allowed
  const onTeam = league.teams.some((t) => t.players.length > 0);
  if (onTeam) return NextResponse.json({ error: "You are already on a team in this league" }, { status: 400 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const preferredTeamId = body.preferredTeamId || null;
  if (preferredTeamId && !league.teams.some((t) => t.id === preferredTeamId)) {
    return NextResponse.json({ error: "Invalid preferredTeamId" }, { status: 400 });
  }
  const preferences = body.preferences ?? null;

  // Upsert (allows the player to update their existing request)
  const existing = await prisma.leagueParticipationRequest.findUnique({
    where: { leagueId_playerId: { leagueId: id, playerId: user.id } },
  });
  if (existing && (existing.status === "accepted")) {
    return NextResponse.json({ error: "Already accepted onto a team" }, { status: 400 });
  }
  if (existing) {
    const updated = await prisma.leagueParticipationRequest.update({
      where: { id: existing.id },
      data: { status: "pending", preferredTeamId, preferences, respondedById: null, respondedAt: null },
    });
    return NextResponse.json(updated);
  }
  const created = await prisma.leagueParticipationRequest.create({
    data: { leagueId: id, playerId: user.id, preferredTeamId, preferences },
  });
  return NextResponse.json(created);
}

// PATCH: captain/vice (or organizer) edits a teammate's preferences on
// their behalf. Body: { playerId, preferences, preferredTeamId? }.
// If no participation request exists yet (e.g. the player was added
// directly to the team), one is created in "accepted" status.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try { user = await requireAuth(); } catch { return NextResponse.json({ error: "Login required" }, { status: 401 }); }
  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const targetId = typeof body.playerId === "string" && body.playerId.length > 0 ? body.playerId : null;
  if (!targetId) return NextResponse.json({ error: "playerId required" }, { status: 400 });

  const league = await prisma.league.findUnique({
    where: { id },
    select: {
      id: true, createdById: true, deputyId: true,
      teams: {
        select: {
          id: true, captainId: true, viceCaptainId: true,
          players: { where: { playerId: targetId }, select: { teamId: true } },
        },
      },
      helpers: { select: { playerId: true } },
    },
  });
  if (!league) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isOrganizer = user.role === "admin"
    || league.createdById === user.id
    || league.deputyId === user.id
    || league.helpers.some((h) => h.playerId === user.id);
  const targetTeam = league.teams.find((t) => t.players.length > 0);
  if (!targetTeam) return NextResponse.json({ error: "Player is not on a team in this league" }, { status: 404 });
  const isCaptainOfTarget = targetTeam.captainId === user.id || targetTeam.viceCaptainId === user.id;
  if (!isOrganizer && !isCaptainOfTarget) {
    return NextResponse.json({ error: "Only the player's captain/vice or a league organizer can edit their preferences." }, { status: 403 });
  }

  const preferences = body.preferences ?? null;
  const preferredTeamId = body.preferredTeamId !== undefined
    ? (body.preferredTeamId || null)
    : targetTeam.id;

  const existing = await prisma.leagueParticipationRequest.findUnique({
    where: { leagueId_playerId: { leagueId: id, playerId: targetId } },
  });
  if (existing) {
    const updated = await prisma.leagueParticipationRequest.update({
      where: { id: existing.id },
      data: { preferences, preferredTeamId },
    });
    return NextResponse.json(updated);
  }
  // No prior request — create one in "accepted" status (since the player
  // is already on the team) so future event sign-ups can read it.
  const created = await prisma.leagueParticipationRequest.create({
    data: {
      leagueId: id, playerId: targetId,
      preferredTeamId, preferences,
      status: "accepted",
      respondedById: user.id,
      respondedAt: new Date(),
    },
  });
  return NextResponse.json(created);
}
