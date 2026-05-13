import { prisma } from "@/lib/db";
import { requireAuth, authErrorResponse } from "@/lib/auth";
import { recalcAllCourtsAndPersist } from "@/lib/leagueSchedule";
import { NextResponse } from "next/server";

// POST: apply a bulk court+displayOrder rearrangement, then recalc
// scheduledAt for every court in one shot. The lineup-page "Auto-arrange"
// flow generates assignments client-side, previews them, and only POSTs
// here on approval. Doing it atomically (one recalc, not N) avoids the
// per-PATCH race where parallel writes step on each other.
//
// Auth: host team's captain/vice, league organizer/deputy, or app admin
// — mirrors the per-game PATCH route.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; eventId: string }> }
) {
  const { id: leagueId, eventId } = await params;
  let user;
  try { user = await requireAuth(); } catch (e) { return authErrorResponse(e); }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      hostTeamId: true,
      round: { select: { leagueId: true, league: { select: { createdById: true, deputyId: true } } } },
    },
  });
  if (!event || event.round?.leagueId !== leagueId) {
    return NextResponse.json({ error: "Event not in league" }, { status: 404 });
  }

  const isAppAdmin = user.role === "admin";
  const league = event.round?.league;
  const isLeagueAdmin = !!league && (league.createdById === user.id || league.deputyId === user.id);
  let isHostCaptain = false;
  if (event.hostTeamId) {
    const host = await prisma.leagueTeam.findUnique({
      where: { id: event.hostTeamId },
      select: { captainId: true, viceCaptainId: true },
    });
    isHostCaptain = !!host && (host.captainId === user.id || host.viceCaptainId === user.id);
  }
  if (!isAppAdmin && !isLeagueAdmin && !isHostCaptain) {
    return NextResponse.json(
      { error: "Only the home team's captain/vice or a league organizer can rearrange the schedule." },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.assignments)) {
    return NextResponse.json({ error: "Invalid body — expected { assignments: [...] }" }, { status: 400 });
  }

  type Assignment = { gameId: string; courtNum: number; displayOrder: number };
  const assignments: Assignment[] = [];
  for (const a of body.assignments as unknown[]) {
    if (!a || typeof a !== "object") continue;
    const r = a as { gameId?: unknown; courtNum?: unknown; displayOrder?: unknown };
    if (typeof r.gameId !== "string") continue;
    if (typeof r.courtNum !== "number" || r.courtNum < 1) continue;
    if (typeof r.displayOrder !== "number") continue;
    assignments.push({ gameId: r.gameId, courtNum: r.courtNum, displayOrder: r.displayOrder });
  }
  if (assignments.length === 0) {
    return NextResponse.json({ error: "No valid assignments" }, { status: 400 });
  }

  // Apply each assignment scoped by eventId so a bad gameId can't touch
  // a different event's row. We don't update scheduledAt here — the
  // recalc below derives it deterministically from courtStartTimes,
  // displayOrder, and per-cat durations.
  await prisma.$transaction(
    assignments.map((a) =>
      prisma.leagueGame.updateMany({
        where: { id: a.gameId, eventId },
        data: { courtNum: a.courtNum, displayOrder: a.displayOrder },
      }),
    ),
  );

  try {
    await recalcAllCourtsAndPersist(eventId);
  } catch { /* never break the response on a recalc hiccup */ }

  return NextResponse.json({ ok: true, applied: assignments.length });
}
