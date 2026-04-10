import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// PATCH: update match day (date, status, create event)
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; matchDayId: string }> }
) {
  const { id, matchDayId } = await params;
  try { await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const body = await req.json();

  // Create event from match day
  if (body.action === "create_event") {
    const matchDay = await prisma.leagueMatchDay.findUnique({
      where: { id: matchDayId },
      include: {
        round: { include: { league: { include: { categories: { orderBy: { sortOrder: "asc" } } } } } },
        teams: { include: { team: { include: { club: { select: { id: true } } } } } },
      },
    });
    if (!matchDay) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (matchDay.eventId) return NextResponse.json({ error: "Event already created" }, { status: 400 });

    const league = matchDay.round.league;
    const teamNames = matchDay.teams.map((t) => t.team.name).join(" vs ");
    const hostClubId = matchDay.teams.find((t) => t.teamId === matchDay.hostTeamId)?.team.club?.id;

    // Create event
    const event = await prisma.event.create({
      data: {
        name: `${league.name}: ${teamNames} — ${matchDay.round.name || `R${matchDay.round.roundNumber}`}`,
        date: matchDay.date || new Date(),
        numCourts: 2,
        status: "draft",
        createdById: (await requireAuth()).id,
        clubId: hostClubId || null,
        classes: {
          create: league.categories.map((cat, i) => ({
            name: cat.name,
            format: cat.format,
            gender: cat.gender,
            scoringFormat: cat.scoringFormat,
            winBy: cat.winBy,
            isDefault: i === 0,
          })),
        },
      },
    });

    // Link event to match day
    await prisma.leagueMatchDay.update({ where: { id: matchDayId }, data: { eventId: event.id } });

    // Create LeagueGame entries for each category × team pair
    if (matchDay.teams.length === 2) {
      const [t1, t2] = matchDay.teams;
      const eventClasses = await prisma.eventClass.findMany({ where: { eventId: event.id }, orderBy: { id: "asc" } });

      for (let i = 0; i < league.categories.length; i++) {
        await prisma.leagueGame.create({
          data: {
            matchDayId,
            categoryId: league.categories[i].id,
            team1Id: t1.teamId,
            team2Id: t2.teamId,
          },
        });
      }
    }

    return NextResponse.json({ ok: true, eventId: event.id });
  }

  // Regular updates
  const data: Record<string, unknown> = {};
  if (body.date !== undefined) data.date = body.date ? new Date(body.date) : null;
  if (body.status !== undefined) data.status = body.status;
  if (body.hostTeamId !== undefined) data.hostTeamId = body.hostTeamId;

  if (Object.keys(data).length > 0) {
    await prisma.leagueMatchDay.update({ where: { id: matchDayId }, data });
  }

  return NextResponse.json({ ok: true });
}
