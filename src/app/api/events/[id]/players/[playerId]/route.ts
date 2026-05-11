import { prisma } from "@/lib/db";
import { requireAuth, requireEventManager } from "@/lib/auth";
import { NextResponse } from "next/server";
import { syncPlayerToSocial } from "@/lib/socialEventSync";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; playerId: string }> }
) {
  const { id, playerId } = await params;
  // Authorisation: event manager (organizer / event helper / league
  // director-deputy / app admin) OR self-leave OR — for league events —
  // captain/vice of one of the playing teams where the target player is
  // a roster member. The last path lets team captains remove a player
  // they signed up on behalf of (or whose plans changed).
  let user;
  try {
    user = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const isSelf = user.id === playerId;
  let authorized = isSelf;
  if (!authorized) {
    try {
      await requireEventManager(id);
      authorized = true;
    } catch { /* fall through */ }
  }
  if (!authorized) {
    // Team-captain path: viewer is captain/vice of a team that's in this
    // league-event AND the target is on that team's roster.
    const event = await prisma.event.findUnique({
      where: { id },
      select: {
        leagueTeams: {
          select: {
            team: {
              select: {
                id: true, captainId: true, viceCaptainId: true,
                players: { select: { playerId: true } },
              },
            },
          },
        },
      },
    });
    const teams = event?.leagueTeams.map((et) => et.team) ?? [];
    const myTeam = teams.find((t) => t.captainId === user.id || t.viceCaptainId === user.id);
    if (myTeam && myTeam.players.some((tp) => tp.playerId === playerId)) {
      authorized = true;
    }
  }
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const eventPlayer = await prisma.eventPlayer.findFirst({
    where: { eventId: id, playerId },
  });

  if (!eventPlayer) {
    return NextResponse.json(
      { error: "Player not found in event" },
      { status: 404 }
    );
  }

  // Check player is not in any match for this event
  const inMatch = await prisma.matchPlayer.findFirst({
    where: {
      playerId,
      match: { eventId: id },
    },
  });
  if (inMatch) {
    return NextResponse.json(
      { error: "Cannot remove: player is in a match. Delete the match first." },
      { status: 400 }
    );
  }

  const wasActive = eventPlayer.status === "registered" || eventPlayer.status === "checked_in";

  await prisma.eventPlayer.deleteMany({
    where: { eventId: id, playerId },
  });

  // Mirror deletion to the linked social event (no-op when none).
  await syncPlayerToSocial(id, playerId, "unavailable", null);

  // Promote next waitlisted player if an active player was removed
  if (wasActive) {
    const cls = await prisma.eventClass.findFirst({ where: { eventId: id, isDefault: true } });
    if (cls?.maxPlayers) {
      const next = await prisma.eventPlayer.findFirst({
        where: { eventId: id, status: "waitlisted" },
        orderBy: { joinedAt: "asc" },
      });
      if (next) {
        await prisma.eventPlayer.update({
          where: { id: next.id },
          data: { status: "registered" },
        });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
