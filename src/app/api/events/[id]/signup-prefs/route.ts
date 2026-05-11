import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { syncPlayerToSocial } from "@/lib/socialEventSync";

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

  // ── Bulk add path ────────────────────────────────────────────
  // Body shape (additive):
  //   { playerIds: string[], intent?: "social" | "attending" }
  //
  // Two flavours:
  //   - intent === "social" | "attending"  → "guest" add: any captain
  //     (of any team in the league) / organizer / app admin can sign up
  //     ANY player as social or attending. Roster check is skipped; the
  //     player isn't on a team so they can't be picked for the lineup,
  //     but they appear in the participants list. signupPreferences
  //     becomes `{ _intent: <intent> }`.
  //   - default (no intent)                → "roster" add: captain
  //     picks up their own teammates with intent="playing", category
  //     prefs sourced from the player's LeagueParticipationRequest.
  if (Array.isArray(body.playerIds) && body.playerIds.length > 0) {
    const playerIds = body.playerIds.filter((x: unknown): x is string => typeof x === "string" && x.length > 0);
    const guestIntent: "social" | "attending" | null =
      body.intent === "social" || body.intent === "attending" ? body.intent : null;
    // Optional team affinity for guests — when the team captain adds a
    // non-roster guest, this tags them so the participants UI can place
    // them in the right team column. Validated below.
    const guestTeamIdRaw = typeof body.teamId === "string" && body.teamId.length > 0 ? body.teamId : null;
    const ev = await prisma.event.findUnique({
      where: { id: eventId },
      select: {
        roundId: true,
        round: {
          select: {
            league: {
              select: {
                id: true, createdById: true, deputyId: true,
                teams: {
                  select: {
                    id: true, captainId: true, viceCaptainId: true,
                    players: { select: { playerId: true } },
                  },
                },
                categories: { select: { id: true, status: true } },
              },
            },
          },
        },
        classes: { select: { id: true, isDefault: true }, orderBy: { isDefault: "desc" } },
      },
    });
    if (!ev || !ev.roundId || !ev.round) {
      return NextResponse.json({ error: "Bulk signup is only for league events" }, { status: 400 });
    }
    const league = ev.round.league;
    const isOrganizer = user.role === "admin" || league.createdById === user.id || league.deputyId === user.id;
    // Build (playerId → teamId) so we can verify captain/vice authority.
    const playerToTeam = new Map<string, string>();
    for (const t of league.teams) {
      for (const p of t.players) playerToTeam.set(p.playerId, t.id);
    }
    const myCaptainTeamIds = new Set(
      league.teams
        .filter((t) => t.captainId === user.id || t.viceCaptainId === user.id)
        .map((t) => t.id),
    );
    if (guestIntent) {
      // Guest path: caller must be a captain of SOME team in this league
      // or an organizer/admin. No per-player roster check.
      if (!isOrganizer && myCaptainTeamIds.size === 0) {
        return NextResponse.json({ error: "Only captains, league organizers or admins can add guests." }, { status: 403 });
      }
      // Validate the guest's team affinity if provided. Must be a real team
      // in this league. Captains can only attach to a team they captain
      // (unless organizer/admin).
      let guestTeamId: string | null = null;
      if (guestTeamIdRaw) {
        const team = league.teams.find((t) => t.id === guestTeamIdRaw);
        if (!team) {
          return NextResponse.json({ error: "Guest's team is not in this league." }, { status: 400 });
        }
        if (!isOrganizer && !myCaptainTeamIds.has(team.id)) {
          return NextResponse.json({ error: "You can only add guests to a team you captain." }, { status: 403 });
        }
        guestTeamId = team.id;
      }
      const defaultClassId = ev.classes[0]?.id ?? null;
      const guestPrefs: Record<string, string> = { _intent: guestIntent };
      if (guestTeamId) guestPrefs._guestTeamId = guestTeamId;
      let added = 0;
      for (const pid of playerIds) {
        const existing = await prisma.eventPlayer.findFirst({ where: { eventId, playerId: pid } });
        if (existing) {
          // Don't downgrade a "playing" sign-up — only overwrite when the
          // existing row is also a guest/unset (no per-category prefs).
          const prevPrefs = (existing.signupPreferences as Record<string, unknown> | null) ?? {};
          const hasCatPref = Object.entries(prevPrefs).some(([k, v]) => k !== "_intent" && k !== "_guestTeamId" && v && typeof v === "object");
          if (hasCatPref) continue; // skip — they're already in a playing flow
          await prisma.eventPlayer.update({
            where: { id: existing.id },
            data: { status: "registered", signupPreferences: guestPrefs },
          });
        } else {
          await prisma.eventPlayer.create({
            data: { eventId, playerId: pid, classId: defaultClassId, status: "registered", signupPreferences: guestPrefs },
          });
        }
        // Mirror to linked social event (no-op when none).
        await syncPlayerToSocial(eventId, pid, "registered", guestPrefs);
        added++;
      }
      return NextResponse.json({ ok: true, added, mode: "guest", intent: guestIntent, teamId: guestTeamId });
    }
    if (!isOrganizer) {
      const unauth = playerIds.filter((pid: string) => {
        const tid = playerToTeam.get(pid);
        return !tid || !myCaptainTeamIds.has(tid);
      });
      if (unauth.length > 0) {
        return NextResponse.json({ error: "Some players aren't on a team you captain." }, { status: 403 });
      }
    }
    // Pull each target's LeagueParticipationRequest prefs as the default.
    const reqs = await prisma.leagueParticipationRequest.findMany({
      where: { leagueId: league.id, playerId: { in: playerIds }, status: "accepted" },
      select: { playerId: true, preferences: true },
    });
    const prefByPlayer = new Map<string, Record<string, { level: "prefer" | "ok" | "no"; note?: string }>>();
    const validCatIds = new Set(league.categories.filter((c) => c.status !== "draft").map((c) => c.id));
    for (const r of reqs) {
      if (!r.preferences || typeof r.preferences !== "object") continue;
      const clean: Record<string, { level: "prefer" | "ok" | "no"; note?: string }> = {};
      for (const [catId, val] of Object.entries(r.preferences as Record<string, unknown>)) {
        if (!validCatIds.has(catId)) continue;
        if (!val || typeof val !== "object") continue;
        const v = val as { level?: unknown; note?: unknown };
        if (v.level !== "prefer" && v.level !== "ok" && v.level !== "no") continue;
        const note = typeof v.note === "string" ? v.note.trim() : undefined;
        clean[catId] = { level: v.level, ...(note ? { note } : {}) };
      }
      prefByPlayer.set(r.playerId, clean);
    }
    const defaultClassId = ev.classes[0]?.id ?? null;
    let added = 0;
    for (const pid of playerIds) {
      const prefs = prefByPlayer.get(pid) ?? {};
      const existing = await prisma.eventPlayer.findFirst({ where: { eventId, playerId: pid } });
      if (existing) {
        await prisma.eventPlayer.update({
          where: { id: existing.id },
          data: { status: "registered", signupPreferences: prefs },
        });
      } else {
        await prisma.eventPlayer.create({
          data: { eventId, playerId: pid, classId: defaultClassId, status: "registered", signupPreferences: prefs },
        });
      }
      // Mirror to linked social event — bulk roster adds default to
      // intent=playing so all qualify when a social side exists.
      await syncPlayerToSocial(eventId, pid, "registered", prefs);
      added++;
    }
    return NextResponse.json({ ok: true, added });
  }

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

  // Sanitize preferences: only known categories, valid levels, trimmed
  // notes. Plus an `_intent` sentinel ("social" | "attending") for the
  // tri-state-without-categories flows; the rest of the app reads it
  // alongside the per-category map.
  const validCatIds = new Set(event.round.league.categories.filter((c) => c.status !== "draft").map((c) => c.id));
  const cleanPrefs: Record<string, { level: "prefer" | "ok" | "no"; note?: string } | string> = {};
  if (rawPrefs && typeof rawPrefs === "object") {
    for (const [key, val] of Object.entries(rawPrefs as Record<string, unknown>)) {
      if (key === "_intent") {
        if (typeof val === "string" && (val === "social" || val === "attending" || val === "playing")) {
          cleanPrefs._intent = val;
        }
        continue;
      }
      if (!validCatIds.has(key)) continue;
      if (!val || typeof val !== "object") continue;
      const v = val as { level?: unknown; note?: unknown };
      if (v.level !== "prefer" && v.level !== "ok" && v.level !== "no") continue;
      const note = typeof v.note === "string" ? v.note.trim() : undefined;
      cleanPrefs[key] = { level: v.level, ...(note ? { note } : {}) };
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
  // Mirror to linked social event — auto-add/remove based on the
  // sentinel + status. Skip on guest-team-tagged rows that the
  // bulk-guest path already handled separately.
  await syncPlayerToSocial(eventId, targetId, status, cleanPrefs as Record<string, unknown>);
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
  // Mirror the unavailable flip to the linked social event (deletes the
  // social EventPlayer row since unavailable doesn't qualify).
  await syncPlayerToSocial(eventId, user.id, "unavailable", null);
  return NextResponse.json({ ok: true });
}
