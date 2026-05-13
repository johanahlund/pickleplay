import { prisma } from "@/lib/db";
import { requireAuth, authErrorResponse } from "@/lib/auth";
import { recalcCourtAndPersist } from "@/lib/leagueSchedule";
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
      courtNum: true, // captured pre-update so we can recalc the old court on a move
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

  // Schedule + per-match format-override fields: only the host team's
  // captain/vice or a league organizer (or app admin) may set them.
  // The away team can't. Same auth gate covers schedule edits AND
  // scoringFormat / winBy overrides set from the lineup page.
  if (
    body.scheduledAt !== undefined
    || body.courtNum !== undefined
    || body.displayOrder !== undefined
    || body.scoringFormatOverride !== undefined
    || body.winByOverride !== undefined
  ) {
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
      if (body.scheduledAt) {
        const d = new Date(body.scheduledAt);
        if (isNaN(d.getTime())) {
          return NextResponse.json({ error: "Invalid scheduledAt — expected ISO datetime" }, { status: 400 });
        }
        data.scheduledAt = d;
        // A manual time edit becomes an anchor: the auto-scheduler
        // preserves it and chains subsequent matches forward.
        if (body.scheduleAnchored === undefined) data.scheduleAnchored = true;
      } else {
        data.scheduledAt = null;
        // Clearing the time also clears the anchor.
        if (body.scheduleAnchored === undefined) data.scheduleAnchored = false;
      }
    }
    if (body.scheduleAnchored !== undefined) {
      data.scheduleAnchored = !!body.scheduleAnchored;
    }
    if (body.courtNum !== undefined) {
      const n = body.courtNum === null || body.courtNum === "" ? null : Number(body.courtNum);
      if (n !== null && (Number.isNaN(n) || n < 1)) {
        return NextResponse.json({ error: "Invalid courtNum" }, { status: 400 });
      }
      data.courtNum = n;
    }
    if (body.displayOrder !== undefined) {
      const o = body.displayOrder === null ? null : Number(body.displayOrder);
      if (o !== null && Number.isNaN(o)) {
        return NextResponse.json({ error: "Invalid displayOrder" }, { status: 400 });
      }
      data.displayOrder = o;
    }
    // Per-match scoring format / winBy overrides. Free-form strings
    // validated by code lookup; matches LeagueCategory's accepted set.
    const VALID_SCORING = new Set(["1x7", "1x9", "1x11", "1x15", "3x11", "3x15", "1xR15", "1xR21", "3xR15", "3xR21"]);
    // Mirror lib/leagueCategories.ts: "1", "2", plus 2_gp12..2_gp25 and cap12..cap25.
    const VALID_WINBY: Set<string> = (() => {
      const s = new Set<string>(["1", "2"]);
      for (let n = 12; n <= 25; n++) { s.add(`2_gp${n}`); s.add(`cap${n}`); }
      return s;
    })();
    if (body.scoringFormatOverride !== undefined) {
      const v = body.scoringFormatOverride;
      if (v === null || v === "") {
        data.scoringFormatOverride = null;
      } else if (typeof v === "string" && VALID_SCORING.has(v)) {
        data.scoringFormatOverride = v;
      } else {
        return NextResponse.json({ error: "Invalid scoringFormatOverride" }, { status: 400 });
      }
    }
    if (body.winByOverride !== undefined) {
      const v = body.winByOverride;
      if (v === null || v === "") {
        data.winByOverride = null;
      } else if (typeof v === "string" && VALID_WINBY.has(v)) {
        data.winByOverride = v;
      } else {
        return NextResponse.json({ error: "Invalid winByOverride" }, { status: 400 });
      }
    }
  }

  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const updated = await prisma.leagueGame.update({ where: { id: gameId }, data });

  // Auto-schedule recalc — if anything about court/order/time changed,
  // re-derive scheduledAt for everything on the affected court(s).
  const scheduleTouched =
    "scheduledAt" in data || "courtNum" in data || "displayOrder" in data || "scheduleAnchored" in data;
  if (scheduleTouched) {
    try {
      const newCourt = updated.courtNum;
      const oldCourt = game.courtNum;
      const touched = new Set<number>();
      if (oldCourt != null) touched.add(oldCourt);
      if (newCourt != null) touched.add(newCourt);
      for (const courtNum of touched) {
        await recalcCourtAndPersist(eventId, courtNum);
      }
    } catch { /* never break the write on a recalc hiccup */ }
  }

  return NextResponse.json(updated);
}

// DELETE: hard-remove the LeagueGame regardless of team-wants state.
// Used by the lineup-page ✕ button when the host captain decides the
// match shouldn't be played this event. Blocked once a winner is
// recorded — completed matches shouldn't disappear. Auth: host
// captain / vice, league organizer / deputy, or app admin.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; eventId: string; gameId: string }> }
) {
  const { id: leagueId, eventId, gameId } = await params;
  let user;
  try { user = await requireAuth(); } catch (e) { return authErrorResponse(e); }

  const game = await prisma.leagueGame.findUnique({
    where: { id: gameId },
    select: {
      eventId: true,
      courtNum: true,
      winnerId: true,
      event: {
        select: {
          hostTeamId: true,
          round: { select: { leagueId: true, league: { select: { createdById: true, deputyId: true } } } },
        },
      },
    },
  });
  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });
  if (game.eventId !== eventId || game.event.round?.leagueId !== leagueId) {
    return NextResponse.json({ error: "Game does not belong to this league/event" }, { status: 400 });
  }
  if (game.winnerId) {
    return NextResponse.json({ error: "Cannot delete a match that already has a winner" }, { status: 400 });
  }

  const isAppAdmin = user.role === "admin";
  const league = game.event.round?.league;
  const isLeagueAdmin = !!league && (league.createdById === user.id || league.deputyId === user.id);
  let isHostCaptain = false;
  if (game.event.hostTeamId) {
    const host = await prisma.leagueTeam.findUnique({
      where: { id: game.event.hostTeamId },
      select: { captainId: true, viceCaptainId: true },
    });
    isHostCaptain = !!host && (host.captainId === user.id || host.viceCaptainId === user.id);
  }
  if (!isAppAdmin && !isLeagueAdmin && !isHostCaptain) {
    return NextResponse.json({ error: "Only the home team's captain/vice or a league organizer can remove this match." }, { status: 403 });
  }

  await prisma.leagueGame.delete({ where: { id: gameId } });

  // If the deleted game had a court assignment, re-chain that court's
  // remaining schedule so following matches don't keep a stale start time.
  if (game.courtNum != null) {
    try { await recalcCourtAndPersist(eventId, game.courtNum); } catch { /* ignore */ }
  }
  return NextResponse.json({ ok: true });
}
