import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET: all matches from league events (login required)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const { id } = await params;

  // Find all events linked to this league's match days
  const matchDays = await prisma.leagueMatchDay.findMany({
    where: { round: { leagueId: id } },
    select: {
      id: true,
      date: true,
      round: { select: { id: true, roundNumber: true, name: true } },
      teams: { select: { team: { select: { id: true, name: true } } } },
      event: {
        select: {
          id: true,
          name: true,
          date: true,
          matches: {
            include: {
              players: {
                include: {
                  player: { select: { id: true, name: true, emoji: true, photoUrl: true } },
                },
              },
            },
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  });

  // Flatten matches with round/team context
  const matches = matchDays.flatMap((md) => {
    if (!md.event) return [];
    return md.event.matches.map((m) => ({
      ...m,
      roundNumber: md.round.roundNumber,
      roundName: md.round.name || `Round ${md.round.roundNumber}`,
      matchDayId: md.id,
      matchDayDate: md.date,
      teams: md.teams.map((t) => t.team),
      event: { id: md.event!.id, name: md.event!.name, date: md.event!.date },
    }));
  });

  return NextResponse.json(matches);
}
