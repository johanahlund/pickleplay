import { prisma } from "@/lib/db";
import { requireAuth, authErrorResponse } from "@/lib/auth";
import { revealAndGenerate, validateLineup, type LeagueConfig, type CategoryRules, type PlayerLite, type LineupSlotInput } from "@/lib/league-lineups";
import { NextResponse } from "next/server";

async function requireLineupEditor(leagueId: string, teamId: string) {
  const user = await requireAuth();
  if (user.role === "admin") return { user, isOrganizer: true };
  const [league, team] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { createdById: true, deputyId: true } }),
    prisma.leagueTeam.findUnique({ where: { id: teamId }, select: { captainId: true, viceCaptainId: true, leagueId: true } }),
  ]);
  if (!league || !team || team.leagueId !== leagueId) throw new Error("NotFound");
  const isOrganizer = league.createdById === user.id || league.deputyId === user.id;
  const isTeamLeader = team.captainId === user.id || team.viceCaptainId === user.id;
  if (!isOrganizer && !isTeamLeader) throw new Error("Forbidden");
  return { user, isOrganizer };
}

// POST: lock this team's lineup. If the other team is already submitted,
// the server reveals both lineups and generates LeagueGame rows.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; eventId: string; teamId: string }> }
) {
  const { id, eventId, teamId } = await params;
  let auth;
  try { auth = await requireLineupEditor(id, teamId); } catch (e) { return authErrorResponse(e); }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      round: {
        include: {
          league: {
            include: {
              categories: true,
              teams: {
                where: { id: teamId },
                include: {
                  players: { include: { player: { select: { id: true, gender: true, duprRating: true } } } },
                },
              },
            },
          },
        },
      },
      leagueLineups: { include: { slots: true } },
    },
  });
  if (!event || event.round?.leagueId !== id) {
    return NextResponse.json({ error: "Event not found in league" }, { status: 404 });
  }
  const myLineup = event.leagueLineups.find((l) => l.teamId === teamId);
  if (!myLineup) return NextResponse.json({ error: "No lineup to submit — save a draft first" }, { status: 400 });
  if (myLineup.slots.length === 0) return NextResponse.json({ error: "Lineup is empty" }, { status: 400 });

  // Re-validate at submit (rules might have changed since draft was saved)
  const team = event.round.league.teams[0];
  const categoriesById = new Map<string, CategoryRules>(
    event.round.league.categories.map((c) => [c.id, {
      id: c.id, format: c.format, gender: c.gender, ageGroup: c.ageGroup,
      skillMin: c.skillMin, skillMax: c.skillMax, maxPerEvent: c.maxPerEvent, sortOrder: c.sortOrder,
    }]),
  );
  const rosterById = new Map<string, PlayerLite>(
    team.players.map((tp) => [tp.player.id, { id: tp.player.id, gender: tp.player.gender, duprRating: tp.player.duprRating }]),
  );
  const config = (event.round.league.config as LeagueConfig | null) || {};
  const slotsAsInput: LineupSlotInput[] = myLineup.slots.map((s) => ({
    categoryId: s.categoryId, slotNumber: s.slotNumber, player1Id: s.player1Id, player2Id: s.player2Id,
  }));
  const err = validateLineup(slotsAsInput, categoriesById, rosterById, config, !auth.isOrganizer);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  await prisma.leagueLineup.update({
    where: { id: myLineup.id },
    data: { status: "submitted", submittedAt: new Date(), submittedById: auth.user.id },
  });

  // If the other team is also submitted (or revealed), trigger reveal + generation.
  const otherLineup = event.leagueLineups.find((l) => l.teamId !== teamId);
  const allSubmitted = !!otherLineup && (otherLineup.status === "submitted" || otherLineup.status === "revealed");
  if (allSubmitted) {
    await revealAndGenerate(eventId);
    return NextResponse.json({ ok: true, revealed: true });
  }
  return NextResponse.json({ ok: true, revealed: false });
}
