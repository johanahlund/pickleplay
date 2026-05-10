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

// PATCH: change `kind` (or other game-level fields). Blocked once the game
// has a recorded winner — in-progress matches must not flip status. When
// promoting to "principal", any existing principal in the same category is
// demoted to "league" so the invariant holds.
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
    select: {
      eventId: true, categoryId: true, winnerId: true,
      event: {
        select: {
          hostTeamId: true,
          round: { select: { league: { select: { createdById: true, deputyId: true } } } },
        },
      },
      team1: { select: { captainId: true, viceCaptainId: true } },
      team2: { select: { captainId: true, viceCaptainId: true } },
    },
  });
  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });
  if (game.eventId !== eventId) {
    return NextResponse.json({ error: "Game does not belong to this event" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.kind === "string") {
    if (!["principal", "league", "extra"].includes(body.kind)) {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    }
    if (game.winnerId) {
      return NextResponse.json({ error: "Cannot change kind — game already has a recorded winner" }, { status: 400 });
    }
    if (body.kind === "principal") {
      await prisma.leagueGame.updateMany({
        where: { eventId, categoryId: game.categoryId, kind: "principal", NOT: { id: gameId } },
        data: { kind: "league" },
      });
    }
    data.kind = body.kind;
  }

  // Schedule fields: only the host team's captain/vice or a league
  // organizer (or app admin) may set them. The away team can't.
  if (body.scheduledAt !== undefined || body.courtNum !== undefined) {
    const user = await requireAuth();
    const isAppAdmin = user.role === "admin";
    const league = game.event.round?.league;
    const isLeagueAdmin = !!league && (league.createdById === user.id || league.deputyId === user.id);
    const hostTeamId = game.event.hostTeamId;
    const hostTeam = hostTeamId === null ? null
      : hostTeamId === undefined ? null
      : (await prisma.leagueTeam.findUnique({ where: { id: hostTeamId }, select: { captainId: true, viceCaptainId: true } }));
    const isHostCaptain = !!hostTeam && (hostTeam.captainId === user.id || hostTeam.viceCaptainId === user.id);
    if (!isAppAdmin && !isLeagueAdmin && !isHostCaptain) {
      return NextResponse.json({ error: "Only the home team's captain/vice or a league organizer can schedule this match." }, { status: 403 });
    }
    if (body.scheduledAt !== undefined) {
      data.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    }
    if (body.courtNum !== undefined) {
      const n = body.courtNum === null || body.courtNum === "" ? null : Number(body.courtNum);
      if (n !== null && (Number.isNaN(n) || n < 1)) {
        return NextResponse.json({ error: "Invalid courtNum" }, { status: 400 });
      }
      data.courtNum = n;
    }
  }

  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const updated = await prisma.leagueGame.update({ where: { id: gameId }, data });
  return NextResponse.json(updated);
}
