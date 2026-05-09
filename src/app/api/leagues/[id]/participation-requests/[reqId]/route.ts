import { prisma } from "@/lib/db";
import { requireAuth, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

async function loadContext(leagueId: string, reqId: string) {
  const user = await requireAuth();
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      createdById: true, deputyId: true, config: true,
      helpers: { select: { playerId: true } },
      teams: { select: { id: true, captainId: true, viceCaptainId: true, _count: { select: { players: true } } } },
    },
  });
  if (!league) throw new Error("NotFound");
  const request = await prisma.leagueParticipationRequest.findUnique({
    where: { id: reqId },
    select: { id: true, leagueId: true, playerId: true, status: true, preferredTeamId: true },
  });
  if (!request || request.leagueId !== leagueId) throw new Error("NotFound");
  const isAppAdmin = user.role === "admin";
  const isOrganizer = isAppAdmin || league.createdById === user.id || league.deputyId === user.id;
  const isHelper = league.helpers.some((h) => h.playerId === user.id);
  const captainTeamIds = league.teams
    .filter((t) => t.captainId === user.id || t.viceCaptainId === user.id)
    .map((t) => t.id);
  return { user, league, request, isAppAdmin, isOrganizer, isHelper, captainTeamIds };
}

// DELETE: requester withdraws their own request.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; reqId: string }> }
) {
  const { id, reqId } = await params;
  let ctx;
  try { ctx = await loadContext(id, reqId); } catch (e) { return authErrorResponse(e); }
  if (ctx.request.playerId !== ctx.user.id && !ctx.isOrganizer) {
    return NextResponse.json({ error: "Only the requester or an organizer can withdraw" }, { status: 403 });
  }
  await prisma.leagueParticipationRequest.update({
    where: { id: reqId },
    data: { status: "withdrawn" },
  });
  return NextResponse.json({ ok: true });
}

// POST: accept (assign player to a team) or decline.
//   body: { action: "accept" | "decline", teamId?: string }
//   For accept, teamId is required if no preferredTeamId is set.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; reqId: string }> }
) {
  const { id, reqId } = await params;
  let ctx;
  try { ctx = await loadContext(id, reqId); } catch (e) { return authErrorResponse(e); }

  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== "accept" && action !== "decline") {
    return NextResponse.json({ error: "action must be accept or decline" }, { status: 400 });
  }
  if (ctx.request.status !== "pending") {
    return NextResponse.json({ error: `Request is ${ctx.request.status}` }, { status: 400 });
  }

  if (action === "decline") {
    // Captain of preferred team OR organizer can decline
    if (!ctx.isOrganizer && !ctx.isHelper) {
      const targetTeamId = ctx.request.preferredTeamId;
      const isPreferredCaptain = targetTeamId ? ctx.captainTeamIds.includes(targetTeamId) : ctx.captainTeamIds.length > 0;
      if (!isPreferredCaptain) {
        return NextResponse.json({ error: "Not allowed to decline this request" }, { status: 403 });
      }
    }
    await prisma.leagueParticipationRequest.update({
      where: { id: reqId },
      data: { status: "declined", respondedById: ctx.user.id, respondedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  }

  // Accept
  const targetTeamId: string | undefined = body?.teamId || ctx.request.preferredTeamId || undefined;
  if (!targetTeamId) {
    return NextResponse.json({ error: "teamId required (no preferredTeam set)" }, { status: 400 });
  }
  const targetTeam = ctx.league.teams.find((t) => t.id === targetTeamId);
  if (!targetTeam) return NextResponse.json({ error: "Invalid teamId" }, { status: 400 });

  // Permission: captain of THAT team or organizer/helper/admin
  const isTargetCaptain = ctx.captainTeamIds.includes(targetTeamId);
  if (!ctx.isOrganizer && !ctx.isHelper && !isTargetCaptain) {
    return NextResponse.json({ error: "Only that team's captain or an organizer can accept" }, { status: 403 });
  }

  // Roster cap
  const config = (ctx.league.config as { maxRoster?: number } | null) || {};
  const cap = config.maxRoster ?? Infinity;
  if (targetTeam._count.players >= cap) {
    return NextResponse.json({ error: `Roster full (${cap})` }, { status: 400 });
  }

  // Already on another team in this league?
  const existingMembership = await prisma.leagueTeamPlayer.findFirst({
    where: { playerId: ctx.request.playerId, team: { leagueId: id } },
  });
  if (existingMembership) {
    return NextResponse.json({ error: "Player is already on a team in this league" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.leagueTeamPlayer.create({ data: { teamId: targetTeamId, playerId: ctx.request.playerId } });
    await tx.leagueParticipationRequest.update({
      where: { id: reqId },
      data: { status: "accepted", respondedById: ctx.user.id, respondedAt: new Date() },
    });
  });
  return NextResponse.json({ ok: true });
}
