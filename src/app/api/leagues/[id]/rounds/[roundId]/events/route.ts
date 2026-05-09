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
  type OverrideRow = { id: string; name?: string; format?: string; gender?: string; ageGroup?: string;
    skillMin?: number | null; skillMax?: number | null; scoringFormat?: string; winBy?: string; maxPerEvent?: number | null };
  let effectiveCats: CatRow[];
  if (Array.isArray(round.categoriesOverride)) {
    const byId = new Map(round.league.categories.map((c) => [c.id, c]));
    effectiveCats = (round.categoriesOverride as unknown as OverrideRow[])
      .map((o) => {
        const base = byId.get(o.id);
        if (!base) return null;
        return { ...base, ...Object.fromEntries(Object.entries(o).filter(([k, v]) => k !== "id" && v !== undefined && v !== null)) } as CatRow;
      })
      .filter((c): c is CatRow => c !== null);
  } else {
    effectiveCats = round.league.categories;
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

  // Pre-create LeagueGame rows when 2 teams play. Reference the real
  // LeagueCategory.id (FK), even if the round overrode some display fields.
  if (teamIds.length === 2 && effectiveCats.length > 0) {
    const [t1Id, t2Id] = teamIds;
    for (const cat of effectiveCats) {
      await prisma.leagueGame.create({
        data: { eventId: event.id, categoryId: cat.id, team1Id: t1Id, team2Id: t2Id },
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
