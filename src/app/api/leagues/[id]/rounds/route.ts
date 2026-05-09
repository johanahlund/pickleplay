import { prisma } from "@/lib/db";
import { requireLeagueManager, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

// POST: add a round (jornada) with match days
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }

  const { roundNumber, name, startDate, endDate, configOverride, categoriesOverride, matchDays } = await req.json();
  if (!roundNumber) return NextResponse.json({ error: "roundNumber required" }, { status: 400 });

  const round = await prisma.leagueRound.create({
    data: {
      leagueId: id,
      roundNumber,
      name: name || `Round ${roundNumber}`,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      configOverride: configOverride ?? undefined,
      categoriesOverride: categoriesOverride ?? undefined,
      ...(matchDays?.length ? {
        matchDays: {
          create: matchDays.map((md: { teamIds: string[]; hostTeamId?: string; date?: string }) => ({
            date: md.date ? new Date(md.date) : null,
            hostTeamId: md.hostTeamId || md.teamIds?.[0] || null,
            teams: {
              create: md.teamIds.map((teamId: string) => ({ teamId })),
            },
          })),
        },
      } : {}),
    },
    include: {
      matchDays: { include: { teams: { include: { team: { select: { id: true, name: true } } } } } },
    },
  });

  return NextResponse.json(round);
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
  if (configOverride !== undefined) data.configOverride = configOverride;
  if (categoriesOverride !== undefined) data.categoriesOverride = categoriesOverride;
  if (status !== undefined && ["scheduled", "in_progress", "completed"].includes(status)) data.status = status;

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
