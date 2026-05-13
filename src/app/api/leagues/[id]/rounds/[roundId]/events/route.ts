import { prisma } from "@/lib/db";
import { requireLeagueManager, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

// POST: add a single league-attached event (match-day) to a round.
// Body: { teamIds: string[], hostTeamId?: string, date?: string }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; roundId: string }> }
) {
  const { id, roundId } = await params;
  let user;
  try { user = await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }

  // Verify round belongs to this league
  const round = await prisma.leagueRound.findUnique({
    where: { id: roundId },
    select: {
      leagueId: true, name: true, roundNumber: true, startDate: true,
      categoriesOverride: true,
      league: {
        select: {
          name: true,
          categories: { orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });
  if (!round) return NextResponse.json({ error: "Round not found" }, { status: 404 });
  if (round.leagueId !== id) {
    return NextResponse.json({ error: "Round does not belong to this league" }, { status: 403 });
  }

  // Resolve effective categories: round override (subset + per-row overrides)
  // merged onto league defaults. The overrides snapshot only stores fields the
  // user changed; missing fields fall back to league.categories[id].
  type CatRow = (typeof round.league.categories)[number];
  type OverrideRow = { id?: string; name?: string; format?: string; gender?: string; ageGroup?: string;
    skillMin?: number | null; skillMax?: number | null; scoringFormat?: string; winBy?: string; maxPerEvent?: number | null };
  // Effective categories. Each has either:
  //   - { id: leagueCategoryId, ... } — references LeagueCategory (FK target
  //     for LeagueGame), with optional field overrides merged in
  //   - { id: null, ... } — round-only "virtual" category. EventClass mirror
  //     gets created but no LeagueGame (no FK target — these don't count
  //     toward standings).
  type EffectiveCat = CatRow & { _hasFK: boolean };
  let effectiveCats: EffectiveCat[];
  if (Array.isArray(round.categoriesOverride)) {
    const byId = new Map(round.league.categories.map((c) => [c.id, c]));
    effectiveCats = (round.categoriesOverride as unknown as OverrideRow[])
      .map((o): EffectiveCat | null => {
        if (o.id) {
          const base = byId.get(o.id);
          if (!base) return null;
          return {
            ...base,
            ...Object.fromEntries(Object.entries(o).filter(([k, v]) => k !== "id" && v !== undefined && v !== null)),
            _hasFK: true,
          } as EffectiveCat;
        }
        // Round-only category. No FK target, no LeagueGame later.
        return {
          id: "", // not used; _hasFK=false skips LeagueGame
          leagueId: round.leagueId,
          name: o.name ?? "Custom",
          format: o.format ?? "doubles",
          gender: o.gender ?? "open",
          ageGroup: o.ageGroup ?? "open",
          skillMin: o.skillMin ?? null,
          skillMax: o.skillMax ?? null,
          scoringFormat: o.scoringFormat ?? "3x11",
          winBy: o.winBy ?? "2",
          status: "active",
          sortOrder: 999,
          maxPerEvent: o.maxPerEvent ?? null,
          _hasFK: false,
        } as unknown as EffectiveCat;
      })
      .filter((c): c is EffectiveCat => c !== null);
  } else {
    effectiveCats = round.league.categories.map((c) => ({ ...c, _hasFK: true }));
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const teamIds: string[] = Array.isArray(body.teamIds) ? body.teamIds.filter((t: unknown): t is string => typeof t === "string") : [];
  if (teamIds.length < 1 || teamIds.length > 2) {
    return NextResponse.json({ error: "Provide 1 or 2 teamIds" }, { status: 400 });
  }
  const hostTeamId: string | null = typeof body.hostTeamId === "string" ? body.hostTeamId : (teamIds[0] ?? null);
  const date: Date = body.date ? new Date(body.date) : (round.startDate ?? new Date());

  // Resolve clubId for the host team
  const hostTeam = hostTeamId
    ? await prisma.leagueTeam.findUnique({ where: { id: hostTeamId }, include: { club: { select: { id: true } } } })
    : null;

  const teams = await prisma.leagueTeam.findMany({
    where: { id: { in: teamIds } },
    select: { id: true, name: true },
  });
  const teamNames = teamIds.map((tid) => teams.find((t) => t.id === tid)?.name).filter(Boolean).join(" vs ");
  const eventName = `${round.league.name}: ${teamNames || "match-day"} — ${round.name || `R${round.roundNumber}`}`;

  const event = await prisma.event.create({
    data: {
      name: eventName,
      date,
      numCourts: 2,
      status: "setup",
      createdById: user.id,
      clubId: hostTeam?.club?.id ?? null,
      roundId,
      hostTeamId,
      classes: {
        create: effectiveCats.map((cat, i) => ({
          name: cat.name,
          format: cat.format,
          gender: cat.gender,
          scoringFormat: cat.scoringFormat,
          winBy: cat.winBy,
          isDefault: i === 0,
        })),
      },
      leagueTeams: {
        create: teamIds.map((teamId) => ({ teamId })),
      },
    },
  });

  // Pre-create LeagueGame rows when 2 teams play. Skip round-only custom
  // categories (no FK target, doesn't count toward standings).
  //
  // team1Id/team2Id MUST be in alphabetical order — matches the canonical
  // pair the games endpoint derives via `loadEventContext` (which sorts
  // the event's leagueTeams by id). Without this, toggle_slot would write
  // wants flags to the wrong side. Existing legacy rows with non-sorted
  // order are handled by toggle_slot reading the row's own team1Id when
  // updating.
  if (teamIds.length === 2 && effectiveCats.length > 0) {
    const [t1Id, t2Id] = [...teamIds].sort((a, b) => a.localeCompare(b));
    for (const cat of effectiveCats) {
      if (!cat._hasFK) continue;
      await prisma.leagueGame.create({
        data: { eventId: event.id, categoryId: cat.id, team1Id: t1Id, team2Id: t2Id, createdById: user.id },
      });
    }
  }

  return NextResponse.json({ ok: true, eventId: event.id });
}

// DELETE: remove a single event from a round.
// Body: { eventId: string }
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; roundId: string }> }
) {
  const { id, roundId } = await params;
  try { await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }

  const body = await req.json().catch(() => null);
  const eventId = typeof body?.eventId === "string" ? body.eventId : null;
  if (!eventId) return NextResponse.json({ error: "eventId required" }, { status: 400 });

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { roundId: true, round: { select: { leagueId: true } } },
  });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (event.roundId !== roundId || event.round?.leagueId !== id) {
    return NextResponse.json({ error: "Event does not belong to this round" }, { status: 403 });
  }

  await prisma.event.delete({ where: { id: eventId } });
  return NextResponse.json({ ok: true });
}
