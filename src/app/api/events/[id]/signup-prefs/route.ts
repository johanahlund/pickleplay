import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// POST: roster player opts in to a league-attached event with category preferences.
//
// Body:
//   {
//     status?: "registered" | "unavailable",  // default "registered"
//     preferences?: { [categoryId]: { level: "prefer"|"ok"|"no", note?: string } },
//     playerId?: string  // captain-on-behalf override (see below)
//   }
//
// Validates that the event is league-attached AND that EITHER:
//   (a) the caller is on a team in that league (signing up themselves), OR
//   (b) the caller is captain/vice of the team that rosters `playerId`
//       (or league director/deputy/admin) — for "sign up on behalf" flows
//       when a player doesn't have the app or hasn't signed up yet.
// Upserts an EventPlayer row for the target; replaces signupPreferences.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const { id: eventId } = await params;
  const body = await req.json().catch(() => ({}));
  const overrideId = typeof body.playerId === "string" && body.playerId.length > 0 ? body.playerId : null;
  const targetId = overrideId ?? user.id;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true, roundId: true,
      round: {
        select: {
          league: {
            select: {
              id: true, createdById: true, deputyId: true,
              // Pull every team's captain/vice + the target's roster row, so
              // we can authorize on-behalf signups without a second query.
              teams: {
                select: {
                  id: true, captainId: true, viceCaptainId: true,
                  players: { where: { playerId: targetId }, select: { teamId: true } },
                },
              },
              categories: { select: { id: true, status: true }, orderBy: { sortOrder: "asc" } },
            },
          },
        },
      },
      classes: { select: { id: true, isDefault: true }, orderBy: { isDefault: "desc" } },
    },
  });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (!event.roundId || !event.round) {
    return NextResponse.json({ error: "Sign-up preferences are only for league events" }, { status: 400 });
  }

  const targetTeam = event.round.league.teams.find((t) => t.players.length > 0);
  if (!targetTeam) {
    return NextResponse.json({ error: "Target player is not on a team in this league" }, { status: 403 });
  }
  if (overrideId) {
    // On-behalf: caller must be captain/vice of target's team, or organizer.
    const isOrganizer = user.role === "admin"
      || event.round.league.createdById === user.id
      || event.round.league.deputyId === user.id;
    const isTeamLeader = targetTeam.captainId === user.id || targetTeam.viceCaptainId === user.id;
    if (!isOrganizer && !isTeamLeader) {
      return NextResponse.json({ error: "Only the player's captain/vice or a league organizer can sign them up." }, { status: 403 });
    }
  }

  const status = body.status === "unavailable" ? "unavailable" : "registered";
  const rawPrefs = body.preferences;

  // Sanitize preferences: only known categories, valid levels, trimmed notes.
  const validCatIds = new Set(event.round.league.categories.filter((c) => c.status !== "draft").map((c) => c.id));
  const cleanPrefs: Record<string, { level: "prefer" | "ok" | "no"; note?: string }> = {};
  if (rawPrefs && typeof rawPrefs === "object") {
    for (const [catId, val] of Object.entries(rawPrefs as Record<string, unknown>)) {
      if (!validCatIds.has(catId)) continue;
      if (!val || typeof val !== "object") continue;
      const v = val as { level?: unknown; note?: unknown };
      if (v.level !== "prefer" && v.level !== "ok" && v.level !== "no") continue;
      const note = typeof v.note === "string" ? v.note.trim() : undefined;
      cleanPrefs[catId] = { level: v.level, ...(note ? { note } : {}) };
    }
  }

  // Default class — match-day events have one class per league category, so
  // attach the EventPlayer to the default class for compatibility with
  // existing event flows. (Players play multiple classes via the lineup; this
  // is just the entry-point class.)
  const defaultClassId = event.classes[0]?.id ?? null;

  // Upsert EventPlayer for the target.
  const existing = await prisma.eventPlayer.findFirst({
    where: { eventId, playerId: targetId },
  });
  if (existing) {
    await prisma.eventPlayer.update({
      where: { id: existing.id },
      data: { status, signupPreferences: cleanPrefs },
    });
  } else {
    await prisma.eventPlayer.create({
      data: {
        eventId, playerId: targetId, classId: defaultClassId,
        status, signupPreferences: cleanPrefs,
      },
    });
  }
  return NextResponse.json({ ok: true });
}

// DELETE: withdraw signup (sets status = "unavailable", keeps the row + prefs
// so a captain can still see "X said no").
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const { id: eventId } = await params;
  await prisma.eventPlayer.updateMany({
    where: { eventId, playerId: user.id },
    data: { status: "unavailable" },
  });
  return NextResponse.json({ ok: true });
}
