import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// POST: add a round (jornada) with match days
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const { roundNumber, name, suggestedDate, matchDays } = await req.json();
  if (!roundNumber) return NextResponse.json({ error: "roundNumber required" }, { status: 400 });

  const round = await prisma.leagueRound.create({
    data: {
      leagueId: id,
      roundNumber,
      name: name || `Round ${roundNumber}`,
      suggestedDate: suggestedDate ? new Date(suggestedDate) : null,
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

// DELETE: remove a round
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await params;
  try { await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const { roundId } = await req.json();
  await prisma.leagueRound.delete({ where: { id: roundId } });
  return NextResponse.json({ ok: true });
}
