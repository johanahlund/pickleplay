import { prisma } from "@/lib/db";
import { requireLeagueManager, authErrorResponse } from "@/lib/auth";
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

// PATCH: update team
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; teamId: string }> }
) {
  const { id, teamId } = await params;
  try { await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }
  const err = await assertTeamInLeague(teamId, id);
  if (err) return err;

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.captainId !== undefined) data.captainId = body.captainId || null;
  if (body.viceCaptainId !== undefined) data.viceCaptainId = body.viceCaptainId || null;
  if (body.logoUrl !== undefined) data.logoUrl = body.logoUrl;

  const team = await prisma.leagueTeam.update({ where: { id: teamId }, data });
  return NextResponse.json(team);
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
