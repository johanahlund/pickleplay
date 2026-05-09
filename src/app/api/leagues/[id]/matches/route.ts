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

  // Find all league-attached events for this league
  const events = await prisma.event.findMany({
    where: { round: { leagueId: id } },
    select: {
      id: true,
      name: true,
      date: true,
      round: { select: { id: true, roundNumber: true, name: true } },
      leagueTeams: { select: { team: { select: { id: true, name: true } } } },
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
  });

  // Flatten matches with round/team context
  const matches = events.flatMap((ev) => {
    return ev.matches.map((m) => ({
      ...m,
      roundNumber: ev.round!.roundNumber,
      roundName: ev.round!.name || `Round ${ev.round!.roundNumber}`,
      eventId: ev.id,
      matchDayDate: ev.date,
      teams: ev.leagueTeams.map((t) => t.team),
      event: { id: ev.id, name: ev.name, date: ev.date },
    }));
  });

  return NextResponse.json(matches);
}
