import { prisma } from "@/lib/db";
import { requireAuth, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

// Caller is allowed if app admin, league director/deputy, or captain/vice
// of either team in the game. Used for the principal/friendly toggle.
async function requireGameEditor(leagueId: string, gameId: string) {
  const user = await requireAuth();
  if (user.role === "admin") return user;

  const [league, game] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { createdById: true, deputyId: true } }),
    prisma.leagueGame.findUnique({
      where: { id: gameId },
      select: {
        team1: { select: { captainId: true, viceCaptainId: true } },
        team2: { select: { captainId: true, viceCaptainId: true } },
        event: { select: { round: { select: { leagueId: true } } } },
      },
    }),
  ]);
  if (!league || !game || game.event.round?.leagueId !== leagueId) throw new Error("NotFound");
  if (league.createdById === user.id || league.deputyId === user.id) return user;
  const captains = [
    game.team1.captainId, game.team1.viceCaptainId,
    game.team2.captainId, game.team2.viceCaptainId,
  ];
  if (captains.includes(user.id)) return user;
  throw new Error("Forbidden");
}

// PATCH: toggle isPrincipal (or other game-level fields). Blocked once the
// game has a recorded winner — in-progress matches must not flip status.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; eventId: string; gameId: string }> }
) {
  const { id, eventId, gameId } = await params;
  try { await requireGameEditor(id, gameId); } catch (e) { return authErrorResponse(e); }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const game = await prisma.leagueGame.findUnique({
    where: { id: gameId },
    select: { eventId: true, winnerId: true },
  });
  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });
  if (game.eventId !== eventId) {
    return NextResponse.json({ error: "Game does not belong to this event" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.isPrincipal === "boolean") {
    if (game.winnerId) {
      return NextResponse.json({ error: "Cannot change status — game already has a recorded winner" }, { status: 400 });
    }
    data.isPrincipal = body.isPrincipal;
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const updated = await prisma.leagueGame.update({ where: { id: gameId }, data });
  return NextResponse.json(updated);
}
