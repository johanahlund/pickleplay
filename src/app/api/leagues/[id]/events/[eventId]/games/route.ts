import { prisma } from "@/lib/db";
import { requireAuth, requireLeagueManager, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

// Lineup-builder games endpoint. The new model creates LeagueGame rows
// lazily: a captain ticks a checkbox for (category, slotNumber) on their
// side, the server upserts a row with their `wants` flag set. When both
// teams have unticked AND no players are assigned, the row is deleted.
//
// Actions (`body.action`):
//   "toggle_slot"     captain toggles wants for a (category, slot) on their side
//   "assign_players"  captain sets the players for a slot on their side
//   "set_kind"        organizer/captain marks a game principal | league | extra
//   "create_extra"    legacy: standalone "Friendly in league" toggle on the event page
//   (no action)       legacy: record winner for an existing game
//
// Permissions:
//   organizer/admin can do anything;
//   team captain or vice can toggle/assign for their own side and set kind
//   among games involving their team. We resolve who the caller is per call.

interface GameContext {
  eventId: string;
  leagueId: string;
  team1Id: string;        // canonical (sorted-by-id) for the event
  team2Id: string;
  captainTeamId: string | null; // null = organizer/admin (any team)
}

async function loadEventContext(leagueId: string, eventId: string, userId: string, isAppAdmin: boolean): Promise<GameContext | { error: string; status: number }> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      round: { select: { leagueId: true, league: { select: { createdById: true, deputyId: true } } } },
      leagueTeams: {
        include: { team: { select: { id: true, captainId: true, viceCaptainId: true } } },
      },
    },
  });
  if (!event || event.round?.leagueId !== leagueId) {
    return { error: "Event not in league", status: 404 };
  }
  const teams = event.leagueTeams.map((lt) => lt.team).sort((a, b) => a.id.localeCompare(b.id));
  if (teams.length !== 2) {
    return { error: "Event must have exactly 2 league teams", status: 400 };
  }
  const [team1, team2] = teams;

  // Prefer captain/vice ownership over organizer status: a person who is
  // both league director AND a team captain (common in small leagues) needs
  // the captain path so they can toggle slots for their team. Organizer-only
  // fallback is for non-captain admins who'd otherwise be locked out.
  const ownsTeam1 = team1.captainId === userId || team1.viceCaptainId === userId;
  const ownsTeam2 = team2.captainId === userId || team2.viceCaptainId === userId;
  if (ownsTeam1) return { eventId, leagueId, team1Id: team1.id, team2Id: team2.id, captainTeamId: team1.id };
  if (ownsTeam2) return { eventId, leagueId, team1Id: team1.id, team2Id: team2.id, captainTeamId: team2.id };
  const isOrganizer = isAppAdmin
    || event.round?.league.createdById === userId
    || event.round?.league.deputyId === userId;
  if (isOrganizer) {
    return { eventId, leagueId, team1Id: team1.id, team2Id: team2.id, captainTeamId: null };
  }
  return { error: "Not a captain or organizer", status: 403 };
}

// POST: dispatch on body.action. Default (no action) records a winner.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; eventId: string }> }
) {
  const { id: leagueId, eventId } = await params;

  let user;
  try { user = await requireAuth(); } catch (e) { return authErrorResponse(e); }
  const isAppAdmin = user.role === "admin";

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Score-recording (legacy) and create_extra paths require manager.
  if (body.action === "create_extra" || !body.action) {
    try { await requireLeagueManager(leagueId); } catch (e) { return authErrorResponse(e); }
  }

  const ctx = await loadEventContext(leagueId, eventId, user.id, isAppAdmin);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  // ─── toggle_slot ─────────────────────────────────────────────
  // body: { action: "toggle_slot", categoryId, slotNumber, want: boolean }
  // The acting team is ctx.captainTeamId (or first team for organizer).
  if (body.action === "toggle_slot") {
    if (ctx.captainTeamId === null) {
      return NextResponse.json({ error: "Organizers can't toggle slots — only captains can." }, { status: 400 });
    }
    const { categoryId, slotNumber, want } = body;
    if (!categoryId || typeof slotNumber !== "number" || typeof want !== "boolean") {
      return NextResponse.json({ error: "categoryId, slotNumber, want required" }, { status: 400 });
    }
    const isTeam1Side = ctx.captainTeamId === ctx.team1Id;
    const wantsField = isTeam1Side ? "team1Wants" : "team2Wants";

    const existing = await prisma.leagueGame.findUnique({
      where: { eventId_categoryId_slotNumber: { eventId, categoryId, slotNumber } },
      include: { gamePlayers: { select: { player: { select: { id: true } }, playerId: true } } },
    });

    if (want) {
      // Tick — upsert row with our flag true.
      if (existing) {
        const data: Record<string, unknown> = { [wantsField]: true };
        const updated = await prisma.leagueGame.update({ where: { id: existing.id }, data });
        return NextResponse.json(updated);
      }
      // First slot in this category = principal by default. Captains can
      // demote/swap via set_kind. If a principal already exists in the
      // category (e.g. someone added slot 2 as principal manually), the
      // new game stays "league".
      const principalCount = await prisma.leagueGame.count({
        where: { eventId, categoryId, kind: "principal" },
      });
      const kind = principalCount === 0 ? "principal" : "league";
      const created = await prisma.leagueGame.create({
        data: {
          eventId, categoryId, slotNumber,
          team1Id: ctx.team1Id, team2Id: ctx.team2Id,
          team1Wants: isTeam1Side, team2Wants: !isTeam1Side,
          kind,
        },
      });
      return NextResponse.json(created);
    }

    // Untick.
    if (!existing) return NextResponse.json({ ok: true });
    // Block if our team has assigned players for this game.
    const ourTeamPlayerIds = new Set(
      isTeam1Side
        ? [ctx.team1Id]   // we'd need to look up which players belong to team1
        : [ctx.team2Id]
    );
    void ourTeamPlayerIds;
    // Simpler check: if any LeagueGamePlayer rows exist for this game
    // belonging to our side's roster, block. We approximate "our side" by
    // looking at LeagueTeamPlayer.
    if (existing.gamePlayers.length > 0) {
      const ourTeamId = isTeam1Side ? ctx.team1Id : ctx.team2Id;
      const ourRoster = await prisma.leagueTeamPlayer.findMany({
        where: { teamId: ourTeamId },
        select: { playerId: true },
      });
      const rosterSet = new Set(ourRoster.map((r) => r.playerId));
      const ourAssigned = existing.gamePlayers.some((gp) => rosterSet.has(gp.playerId));
      if (ourAssigned) {
        return NextResponse.json(
          { error: "Remove assigned players first before unticking this match." },
          { status: 400 },
        );
      }
    }
    const otherWants = isTeam1Side ? existing.team2Wants : existing.team1Wants;
    if (!otherWants) {
      // Neither side wants → delete the row (cascade-clears its players).
      await prisma.leagueGame.delete({ where: { id: existing.id } });
      return NextResponse.json({ deleted: true });
    }
    const updated = await prisma.leagueGame.update({
      where: { id: existing.id },
      data: { [wantsField]: false },
    });
    return NextResponse.json(updated);
  }

  // ─── assign_players ──────────────────────────────────────────
  // body: { action: "assign_players", gameId, playerIds: string[] }
  // Replaces the acting team's player assignments for that game.
  if (body.action === "assign_players") {
    if (ctx.captainTeamId === null) {
      return NextResponse.json({ error: "Organizers can't assign players — captains do." }, { status: 400 });
    }
    const { gameId, playerIds } = body;
    if (!gameId || !Array.isArray(playerIds)) {
      return NextResponse.json({ error: "gameId, playerIds required" }, { status: 400 });
    }
    const game = await prisma.leagueGame.findUnique({
      where: { id: gameId },
      select: { eventId: true, team1Id: true, team2Id: true, winnerId: true },
    });
    if (!game || game.eventId !== eventId) {
      return NextResponse.json({ error: "Game not in event" }, { status: 404 });
    }
    if (game.winnerId) {
      return NextResponse.json({ error: "Game already scored" }, { status: 400 });
    }
    if (game.team1Id !== ctx.captainTeamId && game.team2Id !== ctx.captainTeamId) {
      return NextResponse.json({ error: "Game does not involve your team" }, { status: 403 });
    }

    // Drop the acting team's existing assignments, then add the new ones.
    const ourTeamId = ctx.captainTeamId;
    const roster = await prisma.leagueTeamPlayer.findMany({
      where: { teamId: ourTeamId },
      select: { playerId: true },
    });
    const rosterSet = new Set(roster.map((r) => r.playerId));
    const existing = await prisma.leagueGamePlayer.findMany({
      where: { leagueGameId: gameId },
      select: { id: true, playerId: true },
    });
    const toRemove = existing.filter((gp) => rosterSet.has(gp.playerId));
    if (toRemove.length > 0) {
      await prisma.leagueGamePlayer.deleteMany({
        where: { id: { in: toRemove.map((gp) => gp.id) } },
      });
    }
    for (const pid of playerIds as string[]) {
      // Allow off-roster substitutes (e.g. emergency fill-in) — skip the
      // membership check. Captains pick from "All sign-ups" pool.
      await prisma.leagueGamePlayer.upsert({
        where: { leagueGameId_playerId: { leagueGameId: gameId, playerId: pid } },
        create: { leagueGameId: gameId, playerId: pid },
        update: {},
      });
    }
    return NextResponse.json({ ok: true });
  }

  // ─── set_ready ───────────────────────────────────────────────
  // body: { action: "set_ready", ready: boolean }
  // Captain marks their team's lineup as final. Opponent's gamePlayers stay
  // hidden in API responses until BOTH teams flip this true.
  if (body.action === "set_ready") {
    if (ctx.captainTeamId === null) {
      return NextResponse.json({ error: "Only captains can mark a lineup ready." }, { status: 400 });
    }
    const ready = !!body.ready;
    await prisma.leagueEventTeam.update({
      where: { eventId_teamId: { eventId, teamId: ctx.captainTeamId } },
      data: {
        lineupReady: ready,
        lineupReadyAt: ready ? new Date() : null,
        lineupReadyById: ready ? user.id : null,
      },
    });
    return NextResponse.json({ ok: true });
  }

  // ─── set_kind ────────────────────────────────────────────────
  // body: { action: "set_kind", gameId, kind: "principal"|"league"|"extra" }
  // Server enforces: at most one principal per category in this event.
  // Locked once a winner is recorded.
  if (body.action === "set_kind") {
    const { gameId, kind } = body;
    if (!gameId || !["principal", "league", "extra"].includes(kind)) {
      return NextResponse.json({ error: "gameId + valid kind required" }, { status: 400 });
    }
    const game = await prisma.leagueGame.findUnique({
      where: { id: gameId },
      select: { eventId: true, categoryId: true, winnerId: true, team1Id: true, team2Id: true },
    });
    if (!game || game.eventId !== eventId) {
      return NextResponse.json({ error: "Game not in event" }, { status: 404 });
    }
    if (game.winnerId) {
      return NextResponse.json({ error: "Game already scored — kind is locked" }, { status: 400 });
    }
    if (ctx.captainTeamId !== null
      && game.team1Id !== ctx.captainTeamId
      && game.team2Id !== ctx.captainTeamId) {
      return NextResponse.json({ error: "Game does not involve your team" }, { status: 403 });
    }
    if (kind === "principal") {
      // Demote any other principal in the same category to "league".
      await prisma.leagueGame.updateMany({
        where: { eventId, categoryId: game.categoryId, kind: "principal", NOT: { id: gameId } },
        data: { kind: "league" },
      });
    }
    const updated = await prisma.leagueGame.update({ where: { id: gameId }, data: { kind } });
    return NextResponse.json(updated);
  }

  // ─── create_extra (legacy) ───────────────────────────────────
  // Used by the standalone-event page's "Friendly in league" toggle when
  // creating a manual match outside the lineup builder.
  if (body.action === "create_extra") {
    const { categoryId, team1Id, team2Id, matchId } = body;
    if (!categoryId || !team1Id || !team2Id) {
      return NextResponse.json({ error: "categoryId, team1Id, team2Id required" }, { status: 400 });
    }
    // Pick the next free slotNumber for that category in this event.
    const used = await prisma.leagueGame.findMany({
      where: { eventId, categoryId },
      select: { slotNumber: true },
      orderBy: { slotNumber: "desc" },
      take: 1,
    });
    const slotNumber = (used[0]?.slotNumber ?? 0) + 1;
    const created = await prisma.leagueGame.create({
      data: {
        eventId, categoryId, slotNumber,
        team1Id, team2Id,
        team1Wants: true, team2Wants: true,
        kind: "extra",
        ...(matchId ? { matchId } : {}),
      },
    });
    return NextResponse.json(created);
  }

  // ─── default: set winner (legacy) ────────────────────────────
  const { gameId, winnerId } = body;
  if (!gameId) return NextResponse.json({ error: "gameId or action required" }, { status: 400 });

  const game = await prisma.leagueGame.findUnique({
    where: { id: gameId },
    select: { eventId: true, matchId: true, categoryId: true, kind: true },
  });
  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });
  if (game.eventId !== eventId) {
    return NextResponse.json({ error: "Game does not belong to this event" }, { status: 403 });
  }

  await prisma.leagueGame.update({ where: { id: gameId }, data: { winnerId: winnerId || null } });

  // Auto-promote to principal if this is the first scored game in its
  // category and no other principal exists yet (and this game isn't extra).
  if (winnerId && game.kind === "league") {
    const principalCount = await prisma.leagueGame.count({
      where: { eventId, categoryId: game.categoryId, kind: "principal" },
    });
    if (principalCount === 0) {
      await prisma.leagueGame.update({ where: { id: gameId }, data: { kind: "principal" } });
    }
  }

  // Mirror the linked match's players into LeagueGamePlayer if the captain
  // didn't already assign them. (Kept for legacy single-match flows.)
  if (game.matchId && winnerId) {
    const matchPlayers = await prisma.matchPlayer.findMany({
      where: { matchId: game.matchId },
      select: { playerId: true },
    });
    for (const mp of matchPlayers) {
      await prisma.leagueGamePlayer.upsert({
        where: { leagueGameId_playerId: { leagueGameId: gameId, playerId: mp.playerId } },
        create: { leagueGameId: gameId, playerId: mp.playerId },
        update: {},
      });
    }
  }

  // Recalculate event team points, capped per league config. "extra" games
  // don't count.
  const games = await prisma.leagueGame.findMany({
    where: { eventId, NOT: { kind: "extra" } },
  });
  const teamPoints: Record<string, number> = {};
  for (const g of games) {
    if (g.winnerId) {
      teamPoints[g.winnerId] = (teamPoints[g.winnerId] || 0) + 1;
    }
  }
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { round: { include: { league: { select: { config: true } } } } },
  });
  const config = (event?.round?.league.config as Record<string, number> | null) || {};
  const maxPoints = config.maxPointsPerMatchDay || 99;
  const eventTeams = await prisma.leagueEventTeam.findMany({ where: { eventId } });
  for (const et of eventTeams) {
    const raw = teamPoints[et.teamId] || 0;
    await prisma.leagueEventTeam.update({
      where: { id: et.id },
      data: { points: Math.min(raw, maxPoints) },
    });
  }

  return NextResponse.json({ ok: true });
}
