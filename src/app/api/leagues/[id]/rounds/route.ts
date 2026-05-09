import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireLeagueManager, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

// POST: add a round (jornada). Optionally seed initial league-attached
// Events (each event = a match-day between two teams) via the `events` array.
// Body shape:
//   { roundNumber, name?, startDate?, endDate?, configOverride?,
//     categoriesOverride?, events?: { teamIds: string[]; hostTeamId?: string; date?: string }[] }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let user;
  try { user = await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }

  const body = await req.json();
  const {
    roundNumber, name, startDate, endDate,
    configOverride, categoriesOverride,
    events, matchDays, // matchDays kept as alias for backwards compat
  } = body;
  if (!roundNumber) return NextResponse.json({ error: "roundNumber required" }, { status: 400 });

  const seedEvents: { teamIds: string[]; hostTeamId?: string; date?: string }[] =
    events ?? matchDays ?? [];

  // Create the round first (no nested Event create — we need extra context).
  const round = await prisma.leagueRound.create({
    data: {
      leagueId: id,
      roundNumber,
      name: name || `Round ${roundNumber}`,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      configOverride: configOverride ?? undefined,
      categoriesOverride: categoriesOverride ?? undefined,
    },
  });

  // Seed events if provided. Each event is a league match-day:
  //  - one Event row, attached to the round
  //  - LeagueEventTeam rows for each team
  //  - Auto-creates EventClass rows mirroring the league's categories so the
  //    standalone-event UI has classes to schedule under.
  if (seedEvents.length > 0) {
    const league = await prisma.league.findUnique({
      where: { id },
      include: { categories: { orderBy: { sortOrder: "asc" } } },
    });
    const categories = league?.categories ?? [];

    // Resolve clubId for the host team (first team if hostTeamId not given)
    const allTeamIds = Array.from(new Set(seedEvents.flatMap((e) => [...(e.teamIds || []), e.hostTeamId || ""].filter(Boolean))));
    const teams = await prisma.leagueTeam.findMany({
      where: { id: { in: allTeamIds } },
      include: { club: { select: { id: true, name: true } } },
    });
    const teamById = new Map(teams.map((t) => [t.id, t]));

    for (const seed of seedEvents) {
      const hostTeamId = seed.hostTeamId || seed.teamIds?.[0] || null;
      const hostClubId = hostTeamId ? teamById.get(hostTeamId)?.club?.id ?? null : null;
      const teamNames = (seed.teamIds || []).map((tid) => teamById.get(tid)?.name).filter(Boolean).join(" vs ");
      const eventName = `${league?.name ?? "League"}: ${teamNames || "match-day"} — ${round.name || `R${round.roundNumber}`}`;

      const event = await prisma.event.create({
        data: {
          name: eventName,
          date: seed.date ? new Date(seed.date) : (round.startDate ?? new Date()),
          numCourts: 2,
          status: "setup",
          createdById: user.id,
          clubId: hostClubId,
          roundId: round.id,
          hostTeamId,
          classes: {
            create: categories.map((cat, i) => ({
              name: cat.name,
              format: cat.format,
              gender: cat.gender,
              scoringFormat: cat.scoringFormat,
              winBy: cat.winBy,
              isDefault: i === 0,
            })),
          },
          leagueTeams: {
            create: (seed.teamIds || []).map((teamId) => ({ teamId })),
          },
        },
      });

      // LeagueGame rows are NOT pre-created. They're lazy-created when a
      // captain ticks "we want to play this slot" via the lineup builder
      // (see /api/leagues/[id]/events/[eventId]/games slot-toggle endpoint).
      void event; void categories;
    }
  }

  // Return the round with its events for client convenience.
  const enriched = await prisma.leagueRound.findUnique({
    where: { id: round.id },
    include: {
      events: {
        include: {
          leagueTeams: { include: { team: { select: { id: true, name: true } } } },
        },
      },
    },
  });
  return NextResponse.json(enriched);
}

// PATCH: update round fields (dates, name, overrides)
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { roundId, name, startDate, endDate, configOverride, categoriesOverride, status } = body;
  if (!roundId) return NextResponse.json({ error: "roundId required" }, { status: 400 });

  const existing = await prisma.leagueRound.findUnique({ where: { id: roundId }, select: { leagueId: true } });
  if (!existing) return NextResponse.json({ error: "Round not found" }, { status: 404 });
  if (existing.leagueId !== id) return NextResponse.json({ error: "Round does not belong to this league" }, { status: 403 });

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name?.trim() || null;
  if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
  if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;
  // Prisma needs Prisma.DbNull (not plain null) to clear an optional Json
  // column to SQL NULL. Plain null would write a JSON `null` literal that
  // doesn't match `null` checks afterwards.
  if (configOverride !== undefined) data.configOverride = configOverride === null ? Prisma.DbNull : configOverride;
  if (categoriesOverride !== undefined) data.categoriesOverride = categoriesOverride === null ? Prisma.DbNull : categoriesOverride;
  if (status !== undefined && ["setup", "active"].includes(status)) data.status = status;

  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const round = await prisma.leagueRound.update({ where: { id: roundId }, data });
  return NextResponse.json(round);
}

// DELETE: remove a round
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }

  const { roundId } = await req.json();
  if (!roundId || typeof roundId !== "string") {
    return NextResponse.json({ error: "roundId required" }, { status: 400 });
  }

  const round = await prisma.leagueRound.findUnique({
    where: { id: roundId },
    select: { leagueId: true },
  });
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });
  if (round.leagueId !== id) {
    return NextResponse.json({ error: "Round does not belong to this league" }, { status: 403 });
  }

  await prisma.leagueRound.delete({ where: { id: roundId } });
  return NextResponse.json({ ok: true });
}
