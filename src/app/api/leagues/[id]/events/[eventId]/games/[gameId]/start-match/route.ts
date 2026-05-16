import { prisma } from "@/lib/db";
import { requireAuth, authErrorResponse, requireScheduleEditor } from "@/lib/auth";
import { NextResponse } from "next/server";

/**
 * Find-or-create the Match for a LeagueGame and set it active.
 *
 * The schedule view renders LeagueGame rows; the start/pause/scorer
 * flow operates on Match. This endpoint is the bridge: it lazily
 * creates a Match from the LeagueGamePlayer assignments the first
 * time someone presses ▶ Start on a card.
 *
 * Auth: same gate as the rest of the league-event scheduling
 *   - schedule editor (admin / event organizer / league admin / host
 *     team captain or vice), OR
 *   - a player rostered into this specific game's LeagueGamePlayer
 *     rows (they're literally playing it), OR
 *   - the Match's assigned scorerId (when a Match already exists).
 *
 * Requires: both teams have at least one LeagueGamePlayer entry.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; eventId: string; gameId: string }> }
) {
  const { id: leagueId, eventId, gameId } = await params;
  let user;
  try { user = await requireAuth(); } catch (e) { return authErrorResponse(e); }
  // Optional body: { startNow?: boolean }. When false (or omitted &
  // body absent), the Match is created in `pending` state without
  // startedAt. Used by the Edit button to lazy-create a Match so the
  // action sheet can open before the operator hits ▶ Start. Default
  // true so the existing ▶ Start callers keep their semantics.
  const body = await req.json().catch(() => null) as { startNow?: boolean } | null;
  const startNow = body?.startNow !== false;

  const game = await prisma.leagueGame.findUnique({
    where: { id: gameId },
    select: {
      id: true,
      eventId: true,
      matchId: true,
      courtNum: true,
      team1Id: true,
      team2Id: true,
      gamePlayers: { select: { playerId: true, team: true } },
      event: {
        select: { id: true, hostTeamId: true, round: { select: { leagueId: true } } },
      },
      match: { select: { id: true, status: true, scorerId: true } },
    },
  });
  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });
  if (game.eventId !== eventId || game.event.round?.leagueId !== leagueId) {
    return NextResponse.json({ error: "Game not in this event/league" }, { status: 400 });
  }

  // Permission: schedule editor OR a player in this game OR the
  // existing Match's scorer.
  let allowed = false;
  if (user.role === "admin") allowed = true;
  if (!allowed) {
    try { await requireScheduleEditor(eventId); allowed = true; } catch { /* fall through */ }
  }
  const playerIds = new Set(game.gamePlayers.map((gp) => gp.playerId));
  if (!allowed && playerIds.has(user.id)) allowed = true;
  if (!allowed && game.match?.scorerId === user.id) allowed = true;
  if (!allowed) {
    return NextResponse.json(
      { error: "Only schedule editors, players in this match, or the assigned scorer can start it." },
      { status: 403 },
    );
  }

  // Both teams must have at least one player assigned, otherwise
  // there's nothing to track.
  const team1Count = game.gamePlayers.filter((gp) => gp.team === 1).length;
  const team2Count = game.gamePlayers.filter((gp) => gp.team === 2).length;
  if (team1Count === 0 || team2Count === 0) {
    return NextResponse.json(
      { error: "Both teams need at least one assigned player before this match can start." },
      { status: 400 },
    );
  }

  const now = new Date();
  const defaultCourt = game.courtNum ?? 1;

  // Already have a Match — when startNow is true, flip status to
  // active (idempotent). When startNow is false (Edit-lazy-create
  // path), just return the existing Match unchanged.
  if (game.matchId && game.match) {
    if (game.match.status === "completed") {
      return NextResponse.json({ error: "Match already completed." }, { status: 400 });
    }
    if (!startNow) {
      return NextResponse.json({ match: game.match, created: false });
    }
    const updated = await prisma.match.update({
      where: { id: game.matchId },
      data: {
        status: "active",
        startedAt: game.match.status === "pending" ? now : undefined,
      },
      select: { id: true, status: true, startedAt: true },
    });
    return NextResponse.json({ match: updated, created: false });
  }

  // No Match yet — create one, link it back to the LeagueGame, and
  // seed MatchPlayer rows from the LeagueGamePlayer assignments. When
  // startNow is false, the Match is created in `pending` state with
  // no startedAt so the Edit affordance can open the action sheet
  // before any play begins.
  const created = await prisma.match.create({
    data: {
      eventId,
      courtNum: defaultCourt,
      round: 1,
      status: startNow ? "active" : "pending",
      startedAt: startNow ? now : null,
      createdById: user.id,
      players: {
        create: game.gamePlayers.map((gp) => ({
          playerId: gp.playerId,
          team: gp.team ?? 1,
        })),
      },
    },
    select: { id: true, status: true, startedAt: true },
  });
  await prisma.leagueGame.update({
    where: { id: gameId },
    data: { matchId: created.id },
  });

  return NextResponse.json({ match: created, created: true });
}
