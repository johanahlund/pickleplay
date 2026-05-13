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

/**
 * Effective cap on Principal + League matches per event. Pulls
 * `maxMatchesPerEvent` from the round's configOverride first, then
 * falls back to the league's config. Returns null when no cap is set.
 * Friendly ("extra") matches don't count against this cap.
 */
async function getMaxMatchesPerEvent(eventId: string): Promise<number | null> {
  const ev = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      round: {
        select: {
          configOverride: true,
          league: { select: { config: true } },
        },
      },
    },
  });
  const override = ev?.round?.configOverride as { maxMatchesPerEvent?: unknown } | null | undefined;
  const overrideVal = override && typeof override === "object" && typeof override.maxMatchesPerEvent === "number"
    ? override.maxMatchesPerEvent
    : null;
  if (overrideVal !== null && overrideVal > 0) return overrideVal;
  const baseCfg = ev?.round?.league?.config as { maxMatchesPerEvent?: unknown } | null | undefined;
  const baseVal = baseCfg && typeof baseCfg === "object" && typeof baseCfg.maxMatchesPerEvent === "number"
    ? baseCfg.maxMatchesPerEvent
    : null;
  return baseVal !== null && baseVal > 0 ? baseVal : null;
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

  // Captain-side edits (toggle_slot, assign_players, set_kind) are
  // gated by lineup-lock state:
  //
  //   Pre-reveal (event.lineupTotalLocked = false)
  //     This captain can edit when their OWN team's lineupReady is
  //     false. set_ready itself is always allowed — that's the escape
  //     hatch out of a locked state.
  //
  //   Post-reveal (event.lineupTotalLocked = true, latched)
  //     Mutual-unlock required: BOTH teams must have lineupReady=false
  //     before either side can edit. A captain who unlocks alone will
  //     hit this guard and see a "waiting on opponent" message.
  //
  // App admins bypass both gates (incident recovery / data fixes).
  const captainEdits = ["toggle_slot", "assign_players", "set_kind"];
  if (ctx.captainTeamId !== null && captainEdits.includes(body.action) && !isAppAdmin) {
    const ets = await prisma.leagueEventTeam.findMany({
      where: { eventId },
      select: { teamId: true, lineupReady: true },
    });
    const myEt = ets.find((e) => e.teamId === ctx.captainTeamId);
    const otherEt = ets.find((e) => e.teamId !== ctx.captainTeamId);
    if (myEt?.lineupReady) {
      return NextResponse.json(
        { error: "Your team's lineup is locked. Tap Re-open to edit it." },
        { status: 400 },
      );
    }
    if (otherEt?.lineupReady) {
      const ev = await prisma.event.findUnique({
        where: { id: eventId },
        select: { lineupTotalLocked: true },
      });
      if (ev?.lineupTotalLocked) {
        return NextResponse.json(
          { error: "waiting on the opposing team to unlock for joint editing" },
          { status: 400 },
        );
      }
    }
  }

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

    const existing = await prisma.leagueGame.findUnique({
      where: { eventId_categoryId_slotNumber: { eventId, categoryId, slotNumber } },
      include: { gamePlayers: { select: { player: { select: { id: true } }, playerId: true } } },
    });
    // When updating an EXISTING row, derive our side from that row's
    // own team1Id — older pre-create paths (rounds/events POST) stored
    // team1Id/team2Id in UI-selection order, not the alphabetical
    // canonical order. Reading from `ctx.team1Id` would write the wrong
    // flag in those cases. For a fresh create we fall back to the
    // canonical ctx pair.
    const isTeam1Side = existing
      ? ctx.captainTeamId === existing.team1Id
      : ctx.captainTeamId === ctx.team1Id;
    const wantsField = isTeam1Side ? "team1Wants" : "team2Wants";

    if (want) {
      // Tick — upsert row with our flag true.
      if (existing) {
        const data: Record<string, unknown> = { [wantsField]: true };
        // If this UPDATE is taking a pre-create placeholder row (both
        // wants=false, kind="league" by default) to a real match for
        // the first time, re-evaluate kind against the current state:
        // the first real match in a category should be "principal", not
        // "league", and the event-wide cap takes precedence.
        const wasReal = existing.team1Wants || existing.team2Wants;
        if (!wasReal) {
          const realWants = {
            OR: [{ team1Wants: true }, { team2Wants: true }],
            NOT: { id: existing.id },
          };
          const principalCount = await prisma.leagueGame.count({
            where: { eventId, categoryId: existing.categoryId, kind: "principal", ...realWants },
          });
          let newKind: "principal" | "league" | "extra" = principalCount === 0 ? "principal" : "league";
          const cap = await getMaxMatchesPerEvent(eventId);
          if (cap !== null) {
            const countingNow = await prisma.leagueGame.count({
              where: { eventId, kind: { in: ["principal", "league"] }, ...realWants },
            });
            if (countingNow >= cap) newKind = "extra";
          }
          data.kind = newKind;
        }
        const updated = await prisma.leagueGame.update({ where: { id: existing.id }, data });
        return NextResponse.json(updated);
      }
      // First REAL slot in this category = principal by default
      // (pre-create placeholder rows with both wants=false are
      // bookkeeping, not real matches). Captains can demote/swap via
      // set_kind. If a real principal already exists in the category,
      // the new game stays "league".
      // Event-wide cap: Principal + League ≤ maxMatchesPerEvent. When
      // the cap is reached, new ticked slots fall back to "extra"
      // (Friendly) so the captain can still mark intent without
      // overflowing standings.
      const realWants = { OR: [{ team1Wants: true }, { team2Wants: true }] };
      const principalCount = await prisma.leagueGame.count({
        where: { eventId, categoryId, kind: "principal", ...realWants },
      });
      let kind: "principal" | "league" | "extra" = principalCount === 0 ? "principal" : "league";
      const cap = await getMaxMatchesPerEvent(eventId);
      if (cap !== null) {
        const countingNow = await prisma.leagueGame.count({
          where: { eventId, kind: { in: ["principal", "league"] }, ...realWants },
        });
        if (countingNow >= cap) kind = "extra";
      }
      const created = await prisma.leagueGame.create({
        data: {
          eventId, categoryId, slotNumber,
          team1Id: ctx.team1Id, team2Id: ctx.team2Id,
          team1Wants: isTeam1Side, team2Wants: !isTeam1Side,
          kind,
          createdById: user.id,
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
      select: { eventId: true, team1Id: true, team2Id: true, winnerId: true, categoryId: true },
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
    // Side is derived from the captain's teamId against the game's team1/2
    // ids — used to tag each LeagueGamePlayer.team field on insert/update.
    // Without the side tag, non-roster "friendly extras" couldn't be
    // attributed to a team and showed up in the opposing column.
    const ourTeamId = ctx.captainTeamId;
    const ourSide: 1 | 2 = game.team1Id === ourTeamId ? 1 : 2;
    const roster = await prisma.leagueTeamPlayer.findMany({
      where: { teamId: ourTeamId },
      select: { playerId: true },
    });
    const rosterSet = new Set(roster.map((r) => r.playerId));
    // Delete every row currently on our side (covers both roster picks
    // and friendly extras). Falls back to "roster match" for legacy rows
    // where team is null — keeps backward compat with pre-migration data.
    await prisma.leagueGamePlayer.deleteMany({
      where: {
        leagueGameId: gameId,
        OR: [
          { team: ourSide },
          { team: null, playerId: { in: [...rosterSet] } },
        ],
      },
    });
    for (const pid of playerIds as string[]) {
      // Allow off-roster substitutes (e.g. emergency fill-in) — skip the
      // membership check. Captains pick from "All sign-ups" pool. Always
      // tag the row with `team` so the read side knows which column to
      // render the player in.
      await prisma.leagueGamePlayer.upsert({
        where: { leagueGameId_playerId: { leagueGameId: gameId, playerId: pid } },
        create: { leagueGameId: gameId, playerId: pid, team: ourSide },
        update: { team: ourSide },
      });
    }

    // Auto-bump each assigned player's preference for this game's category
    // to at least "ok". Rationale: if a captain picks a player for a
    // category, the player is implicitly available for it — even if they
    // had said "no" or skipped it during sign-up. Treat "prefer" as the
    // ceiling (don't downgrade); upgrade "no"/missing/"ok" to "ok".
    if (game.categoryId && playerIds.length > 0) {
      const eps = await prisma.eventPlayer.findMany({
        where: { eventId, playerId: { in: playerIds as string[] } },
        select: { id: true, playerId: true, signupPreferences: true },
      });
      for (const ep of eps) {
        const prefs = (ep.signupPreferences as Record<string, { level?: string; note?: string }> | null) ?? {};
        const current = prefs[game.categoryId]?.level;
        if (current === "prefer") continue; // already top-level, don't downgrade
        const next = { ...prefs, [game.categoryId]: { ...(prefs[game.categoryId] ?? {}), level: "ok" } };
        await prisma.eventPlayer.update({
          where: { id: ep.id },
          data: { signupPreferences: next },
        });
      }
    }

    return NextResponse.json({ ok: true });
  }

  // ─── set_ready ───────────────────────────────────────────────
  // body: { action: "set_ready", ready: boolean }
  // Captain locks/unlocks their team's lineup. Cross-team visibility
  // and edit-gating are now driven by Event.lineupTotalLocked instead
  // of an event status flip:
  //   - The moment BOTH teams' lineupReady become true → latch
  //     event.lineupTotalLocked = true (NEVER reset).
  //   - After the latch, lineup mutations (assign_players, toggle_slot)
  //     require BOTH teams to have lineupReady = false ("mutual unlock"
  //     — neither side can stealth-edit after seeing the opponent's
  //     lineup).
  //   - The opponent's gamePlayers stay hidden in API responses only
  //     until the latch fires; after that they're visible permanently.
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

    // Re-evaluate both teams' ready state and latch lineupTotalLocked
    // if both are now true. We DO NOT auto-flip event.status anymore —
    // "Active" is gone from the stored status taxonomy. Cross-team
    // reveal piggybacks on lineupTotalLocked.
    const ets = await prisma.leagueEventTeam.findMany({
      where: { eventId },
      select: { lineupReady: true },
    });
    const bothReady = ets.length === 2 && ets.every((et) => et.lineupReady);
    if (bothReady) {
      const ev = await prisma.event.findUnique({
        where: { id: eventId },
        select: { lineupTotalLocked: true },
      });
      if (!ev?.lineupTotalLocked) {
        await prisma.event.update({
          where: { id: eventId },
          data: { lineupTotalLocked: true },
        });
      }
    }
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
    // Enforce event-wide cap: Principal + League ≤ maxMatchesPerEvent.
    // Switching from extra → principal/league adds 1 to the count;
    // switching principal/league → extra removes 1. Same kind = no-op.
    const cap = await getMaxMatchesPerEvent(eventId);
    if (cap !== null) {
      const oldGame = await prisma.leagueGame.findUnique({ where: { id: gameId }, select: { kind: true } });
      const oldCounts = oldGame?.kind === "principal" || oldGame?.kind === "league";
      const newCounts = kind === "principal" || kind === "league";
      if (newCounts && !oldCounts) {
        const countingNow = await prisma.leagueGame.count({
          where: { eventId, kind: { in: ["principal", "league"] } },
        });
        if (countingNow >= cap) {
          return NextResponse.json(
            { error: `This match-day allows at most ${cap} Principal + League matches combined. Switch one to Friendly first.` },
            { status: 400 },
          );
        }
      }
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
        createdById: user.id,
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
