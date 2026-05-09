import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// POST: roster player opts in to a league-attached event with category preferences.
//
// Body:
//   {
//     status?: "registered" | "unavailable",  // default "registered"
//     preferences?: { [categoryId]: { level: "prefer"|"ok"|"no", note?: string } }
//   }
//
// Validates that the event is league-attached AND the caller is on a team
// in that league (i.e. on the roster — only roster players can sign up).
// Upserts an EventPlayer row for the caller; replaces signupPreferences.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const { id: eventId } = await params;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true, roundId: true,
      round: {
        select: {
          league: {
            select: {
              id: true,
              teams: { select: { players: { where: { playerId: user.id }, select: { teamId: true } } } },
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

  // Verify caller is on a team in this league.
  const onTeam = event.round.league.teams.some((t) => t.players.length > 0);
  if (!onTeam) {
    return NextResponse.json({ error: "You are not on a team in this league" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
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

  // Upsert EventPlayer
  const existing = await prisma.eventPlayer.findFirst({
    where: { eventId, playerId: user.id },
  });
  if (existing) {
    await prisma.eventPlayer.update({
      where: { id: existing.id },
      data: { status, signupPreferences: cleanPrefs },
    });
  } else {
    await prisma.eventPlayer.create({
      data: {
        eventId, playerId: user.id, classId: defaultClassId,
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
