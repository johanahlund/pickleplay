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

// PATCH: update team. rosterLocked has its own permission rules:
//   - Lock: captain/vice (own team) OR league director/deputy/admin (any team — force-lock)
//   - Unlock: only league director/deputy/admin (captains can ASK but not unlock themselves)
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; teamId: string }> }
) {
  const { id, teamId } = await params;
  const body = await req.json();
  const isLockToggle = body.rosterLocked !== undefined && Object.keys(body).filter((k) => k !== "rosterLocked").length === 0;

  if (isLockToggle) {
    let user;
    try { user = await requireAuth(); } catch (e) { return authErrorResponse(e); }
    const team = await prisma.leagueTeam.findUnique({
      where: { id: teamId },
      select: { leagueId: true, captainId: true, viceCaptainId: true, rosterLocked: true },
    });
    if (!team || team.leagueId !== id) return NextResponse.json({ error: "Team not found" }, { status: 404 });

    const league = await prisma.league.findUnique({
      where: { id }, select: { createdById: true, deputyId: true },
    });
    const isAppAdmin = user.role === "admin";
    const isOrganizer = isAppAdmin || league?.createdById === user.id || league?.deputyId === user.id;
    const isTeamLeader = team.captainId === user.id || team.viceCaptainId === user.id;
    const newLocked = !!body.rosterLocked;

    if (newLocked && !isOrganizer && !isTeamLeader) {
      return NextResponse.json({ error: "Only the team captain/vice or a league organizer can lock" }, { status: 403 });
    }
    if (!newLocked && !isOrganizer) {
      return NextResponse.json({ error: "Only a league organizer can unlock a roster" }, { status: 403 });
    }

    const updated = await prisma.leagueTeam.update({
      where: { id: teamId },
      data: {
        rosterLocked: newLocked,
        rosterLockedAt: newLocked ? new Date() : null,
        rosterLockedById: newLocked ? user.id : null,
      },
    });
    return NextResponse.json(updated);
  }

  // Regular team edit (name, slogan, captain, etc.)
  try { await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }
  const err = await assertTeamInLeague(teamId, id);
  if (err) return err;

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.captainId !== undefined) data.captainId = body.captainId || null;
  if (body.viceCaptainId !== undefined) data.viceCaptainId = body.viceCaptainId || null;
  if (body.logoUrl !== undefined) data.logoUrl = body.logoUrl;
  if (body.photoUrl !== undefined) data.photoUrl = body.photoUrl;
  if (body.slogan !== undefined) data.slogan = body.slogan ? String(body.slogan).trim() : null;
  if (body.clubId !== undefined) data.clubId = body.clubId || null;

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
