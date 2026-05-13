import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { randomBytes } from "crypto";

// Caller is allowed to generate a claim-token for a player if any of:
//   - app admin
//   - the player IS the caller (self-invite, rare)
//   - club owner/admin of any club the player is a member of
//   - league organizer / deputy / helper of any league the player is
//     rostered on (LeagueTeamPlayer)
//   - captain / vice of any league team the player is on
//
// This widens the previous admin-only gate so the per-event ShareSheet
// can mint personal claim links for unclaimed roster players without
// needing an app-admin pair of hands.
async function canInvite(callerId: string, callerRole: string, playerId: string): Promise<boolean> {
  if (callerRole === "admin") return true;
  if (callerId === playerId) return true;

  // Club ownership/admin path.
  const clubMembers = await prisma.clubMember.findMany({
    where: { playerId },
    select: { clubId: true },
  });
  if (clubMembers.length > 0) {
    const clubIds = clubMembers.map((m) => m.clubId);
    const isClubManager = await prisma.clubMember.findFirst({
      where: { playerId: callerId, clubId: { in: clubIds }, role: { in: ["owner", "admin"] } },
      select: { id: true },
    });
    if (isClubManager) return true;
  }

  // League team paths — captain/vice of any team the player is on, or
  // organizer/deputy/helper of any league the player is rostered in.
  const teamRows = await prisma.leagueTeamPlayer.findMany({
    where: { playerId },
    select: {
      team: { select: { id: true, captainId: true, viceCaptainId: true, leagueId: true } },
    },
  });
  for (const r of teamRows) {
    if (r.team.captainId === callerId || r.team.viceCaptainId === callerId) return true;
  }
  if (teamRows.length > 0) {
    const leagueIds = Array.from(new Set(teamRows.map((r) => r.team.leagueId)));
    const orgLeague = await prisma.league.findFirst({
      where: {
        id: { in: leagueIds },
        OR: [
          { createdById: callerId },
          { deputyId: callerId },
          { helpers: { some: { playerId: callerId } } },
        ],
      },
      select: { id: true },
    });
    if (orgLeague) return true;
  }

  return false;
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const { id } = await params;

  const player = await prisma.player.findUnique({ where: { id } });
  if (!player || player.status === "voided") {
    return NextResponse.json({ error: "Player not found" }, { status: 404 });
  }

  const ok = await canInvite(user.id, user.role, id);
  if (!ok) {
    return NextResponse.json({ error: "Not authorized to invite this player" }, { status: 403 });
  }

  // If already has email + password, they're already registered
  if (player.email && player.passwordHash) {
    return NextResponse.json(
      { error: "Player already has an account" },
      { status: 400 }
    );
  }

  // Generate or reuse existing invite token
  let token = player.inviteToken;
  if (!token) {
    token = randomBytes(24).toString("hex");
    await prisma.player.update({
      where: { id },
      data: { inviteToken: token },
    });
  }

  return NextResponse.json({ token });
}
