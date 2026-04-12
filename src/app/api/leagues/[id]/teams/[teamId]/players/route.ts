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

// POST: add player to team roster
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; teamId: string }> }
) {
  const { id, teamId } = await params;
  try { await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }
  const err = await assertTeamInLeague(teamId, id);
  if (err) return err;

  const { playerId } = await req.json();
  if (!playerId) return NextResponse.json({ error: "playerId required" }, { status: 400 });

  // Check player isn't already on another team in this league
  const existing = await prisma.leagueTeamPlayer.findFirst({
    where: { playerId, team: { leagueId: id } },
    include: { team: { select: { name: true } } },
  });
  if (existing) {
    return NextResponse.json({ error: `Player already on team ${existing.team.name}` }, { status: 400 });
  }

  // Check roster limit
  const league = await prisma.league.findUnique({ where: { id }, select: { config: true } });
  const config = (league?.config as Record<string, number> | null) || {};
  const maxRoster = config.maxRoster || 99;
  const currentCount = await prisma.leagueTeamPlayer.count({ where: { teamId } });
  if (currentCount >= maxRoster) {
    return NextResponse.json({ error: `Roster full (max ${maxRoster})` }, { status: 400 });
  }

  await prisma.leagueTeamPlayer.create({ data: { teamId, playerId } });
  return NextResponse.json({ ok: true });
}

// DELETE: remove player from team roster
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; teamId: string }> }
) {
  const { id, teamId } = await params;
  try { await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }
  const err = await assertTeamInLeague(teamId, id);
  if (err) return err;

  const { playerId } = await req.json();
  await prisma.leagueTeamPlayer.deleteMany({ where: { teamId, playerId } });
  return NextResponse.json({ ok: true });
}
