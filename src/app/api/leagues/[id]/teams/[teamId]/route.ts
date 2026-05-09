import { prisma } from "@/lib/db";
import { requireLeagueManager, requireAuth, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

async function assertTeamInLeague(teamId: string, leagueId: string) {
  const team = await prisma.leagueTeam.findUnique({
    where: { id: teamId },
    select: { leagueId: true },
  });
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });
  if (team.leagueId !== leagueId) {
    return NextResponse.json({ error: "Team does not belong to this league" }, { status: 403 });
  }
  return null;
}

// PATCH: update team. Field-level permissions described below.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; teamId: string }> }
) {
  const { id, teamId } = await params;
  const body = await req.json();

  // Regular team edit. Field-level permissions:
  //   - Manager-only: captainId, viceCaptainId, clubId (leadership/structure).
  //   - Team captain/vice (or manager): name, slogan, logoUrl, photoUrl.
  const managerOnlyFields = ["captainId", "viceCaptainId", "clubId"] as const;
  const wantsManagerField = managerOnlyFields.some((f) => body[f] !== undefined);

  let user;
  try { user = await requireAuth(); } catch (e) { return authErrorResponse(e); }
  const team = await prisma.leagueTeam.findUnique({
    where: { id: teamId },
    select: { leagueId: true, captainId: true, viceCaptainId: true },
  });
  if (!team || team.leagueId !== id) return NextResponse.json({ error: "Team not found" }, { status: 404 });
  const league = await prisma.league.findUnique({
    where: { id }, select: { createdById: true, deputyId: true, clubId: true },
  });
  const isAppAdmin = user.role === "admin";
  const isLeagueOrganizer = isAppAdmin || league?.createdById === user.id || league?.deputyId === user.id;
  let isLeagueHelper = false;
  if (!isLeagueOrganizer) {
    const helper = await prisma.leagueHelper.findFirst({ where: { leagueId: id, playerId: user.id } });
    isLeagueHelper = !!helper;
  }
  const isManager = isLeagueOrganizer || isLeagueHelper;
  const isTeamLeader = team.captainId === user.id || team.viceCaptainId === user.id;

  if (wantsManagerField && !isManager) {
    return NextResponse.json({ error: "Only league managers can change team name / captains / club" }, { status: 403 });
  }
  if (!isManager && !isTeamLeader) {
    return NextResponse.json({ error: "Not authorized to edit this team" }, { status: 403 });
  }

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.captainId !== undefined) data.captainId = body.captainId || null;
  if (body.viceCaptainId !== undefined) data.viceCaptainId = body.viceCaptainId || null;
  if (body.logoUrl !== undefined) data.logoUrl = body.logoUrl;
  if (body.photoUrl !== undefined) data.photoUrl = body.photoUrl;
  if (body.slogan !== undefined) data.slogan = body.slogan ? String(body.slogan).trim() : null;
  if (body.clubId !== undefined) data.clubId = body.clubId || null;

  const updated = await prisma.leagueTeam.update({ where: { id: teamId }, data });
  return NextResponse.json(updated);
}

// DELETE: remove team
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; teamId: string }> }
) {
  const { id, teamId } = await params;
  try { await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }
  const err = await assertTeamInLeague(teamId, id);
  if (err) return err;

  await prisma.leagueTeam.delete({ where: { id: teamId } });
  return NextResponse.json({ ok: true });
}
