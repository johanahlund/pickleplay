import { prisma } from "@/lib/db";
import { requireAuth, authErrorResponse } from "@/lib/auth";
import { validateLineup, type LeagueConfig, type CategoryRules, type PlayerLite, type LineupSlotInput } from "@/lib/league-lineups";
import { NextResponse } from "next/server";

// Caller must be team captain/vice OR league director/deputy OR app admin.
async function requireLineupEditor(leagueId: string, teamId: string) {
  const user = await requireAuth();
  if (user.role === "admin") return { user, isOrganizer: true };
  const [league, team] = await Promise.all([
    prisma.league.findUnique({
      where: { id: leagueId },
      select: { createdById: true, deputyId: true },
    }),
    prisma.leagueTeam.findUnique({
      where: { id: teamId },
      select: { captainId: true, viceCaptainId: true, leagueId: true },
    }),
  ]);
  if (!league || !team || team.leagueId !== leagueId) throw new Error("NotFound");
  const isOrganizer = league.createdById === user.id || league.deputyId === user.id;
  const isTeamLeader = team.captainId === user.id || team.viceCaptainId === user.id;
  if (!isOrganizer && !isTeamLeader) throw new Error("Forbidden");
  return { user, isOrganizer };
}

// PUT: replace this team's lineup slots (resets status to draft).
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; eventId: string; teamId: string }> }
) {
  const { id, eventId, teamId } = await params;
  let auth;
  try { auth = await requireLineupEditor(id, teamId); } catch (e) { return authErrorResponse(e); }

  const body = await req.json().catch(() => null);
  const slots: LineupSlotInput[] = Array.isArray(body?.slots) ? body.slots : [];

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
                  players: {
                    include: { player: { select: { id: true, gender: true, duprRating: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!event || event.round?.leagueId !== id) {
    return NextResponse.json({ error: "Event not found in league" }, { status: 404 });
  }
  const team = event.round.league.teams[0];
  if (!team) return NextResponse.json({ error: "Team not in league" }, { status: 404 });

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
  const err = validateLineup(slots, categoriesById, rosterById, config, !auth.isOrganizer);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  // Upsert lineup, replace all slots
  const existing = await prisma.leagueLineup.findUnique({
    where: { eventId_teamId: { eventId, teamId } },
  });
  await prisma.$transaction(async (tx) => {
    let lineupId: string;
    if (existing) {
      lineupId = existing.id;
      await tx.leagueLineupSlot.deleteMany({ where: { lineupId } });
      await tx.leagueLineup.update({
        where: { id: lineupId },
        data: { status: "draft", submittedAt: null, submittedById: null, unlockRequestedById: null },
      });
    } else {
      const created = await tx.leagueLineup.create({
        data: { eventId, teamId, status: "draft" },
      });
      lineupId = created.id;
    }
    for (const s of slots) {
      await tx.leagueLineupSlot.create({
        data: {
          lineupId,
          categoryId: s.categoryId,
          slotNumber: s.slotNumber,
          player1Id: s.player1Id,
          player2Id: s.player2Id || null,
        },
      });
    }
    // If there were prior auto-generated games, blow them away — lineup
    // changed, so any pairings are stale. We delete only games without a
    // recorded winner (don't lose actual scores).
    await tx.leagueGame.deleteMany({
      where: { eventId, lineupGenerated: true, winnerId: null },
    });
  });

  return NextResponse.json({ ok: true });
}

// DELETE: clear this team's lineup entirely.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; eventId: string; teamId: string }> }
) {
  const { id, eventId, teamId } = await params;
  try { await requireLineupEditor(id, teamId); } catch (e) { return authErrorResponse(e); }
  await prisma.$transaction(async (tx) => {
    await tx.leagueLineup.deleteMany({ where: { eventId, teamId } });
    await tx.leagueGame.deleteMany({
      where: { eventId, lineupGenerated: true, winnerId: null },
    });
  });
  return NextResponse.json({ ok: true });
}
